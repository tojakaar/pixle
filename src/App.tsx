import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { editFromPrompt, type EditFromPromptResult } from "./aiEditor";
import {
  AiEditorPanel,
  type AiPromptResult,
} from "./components/AiEditorPanel";
import { ImageToolbar } from "./components/ImageToolbar";
import { ImageViewport } from "./components/ImageViewport";
import { RightSidebar } from "./components/RightSidebar";
import { UnsavedChangesModal } from "./components/UnsavedChangesModal";
import {
  chooseExportDestination,
  writeExport,
} from "./exportFile";
import {
  BUILTIN_LOOKS,
  DEFAULT_EDIT_PARAMETERS,
  actionIntensitySession,
  analyzeImage,
  analyzeImageSync,
  appendEditAction,
  buildSessionContext,
  canRedo,
  canUndo,
  clampScalarParam,
  cloneEditDocument,
  cloneEditParameters,
  commitEdit,
  conversationalRedo,
  conversationalUndo,
  createDefaultSegmenter,
  createEditAction,
  createEditHistory,
  createEditSession,
  createGlobalEditDocument,
  createLocalEditDocument,
  createMaskProvider,
  decodeImageFile,
  documentGlobalParameters,
  editDocumentsEqual,
  getActiveAction,
  groupActionsForHistory,
  isMaskDebugEnabled,
  lerpParameters,
  looksLikeFollowUp,
  parametersEqual,
  redoEdit,
  resetEdit,
  resolveSemanticLabel,
  scaleActionParameters,
  selectEditAction,
  shortenEditSummary,
  toggleMaskDebugEnabled,
  tryResolveFollowUp,
  undoEdit,
  yieldToUi,
  type ApplyEditsOptions,
  type EditDocument,
  type EditHistoryState,
  type EditParameters,
  type EditSession,
  type ImageAnalysis,
  type Look,
  type Mask,
  type MaskCollection,
  type PreviewSizeHint,
} from "./engine";
import { isAbortError, openLog } from "./engine/openLog";
import { perfLog, perfTime } from "./engine/perf";
import { loadSavedLooks, saveLook } from "./looksStorage";
import "./App.css";

/** Intensity binding for the active EditAction. */
interface LastEditSession {
  before: EditParameters;
  after: EditParameters;
  intensity: number;
}

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewportShellRef = useRef<HTMLDivElement>(null);
  /** Monotonic open request id — newest open always wins. */
  const openRequestIdRef = useRef(0);
  const openAbortRef = useRef<AbortController | null>(null);
  const exportingRef = useRef(false);
  const holdingBeforeRef = useRef(false);
  /** Object URL currently shown (or pending canvas swap). */
  const placeholderUrlRef = useRef<string | null>(null);
  /** URLs waiting to be revoked after React commits a newer placeholder. */
  const urlsPendingRevokeRef = useRef<string[]>([]);
  const presentRef = useRef<EditDocument>(createGlobalEditDocument());
  /** Document snapshot last marked clean (open / successful export). */
  const cleanDocRef = useRef<EditDocument>(createGlobalEditDocument());
  /** File waiting on the unsaved-changes dialog. */
  const pendingOpenFileRef = useRef<File | null>(null);
  /** Swappable segmentation backend — renderer never depends on this. */
  const maskProviderRef = useRef(createMaskProvider(createDefaultSegmenter()));
  /** Cancels in-flight background segmentation when opening another image. */
  const segmentAbortRef = useRef<AbortController | null>(null);

  /** Working preview buffer — set once per open; not recopied on slider moves. */
  const [source, setSource] = useState<ImageData | null>(null);
  /** Immediate object-URL preview of the selected File. */
  const [placeholderUrl, setPlaceholderUrl] = useState<string | null>(null);
  /** Exposed to the viewport so paints invalidate on every new open. */
  const [openRequestId, setOpenRequestId] = useState(0);
  /** Original file kept for full-resolution export (never mutated). */
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [imageAnalysis, setImageAnalysis] = useState<ImageAnalysis | null>(
    null,
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exportTone, setExportTone] = useState<"ok" | "error">("ok");
  const [history, setHistory] = useState<EditHistoryState>(() =>
    createEditHistory(),
  );
  const [showingBefore, setShowingBefore] = useState(false);
  const [, setBeforeLatched] = useState(false);
  const [lastEdit, setLastEdit] = useState<LastEditSession | null>(null);
  /** Conversational edit session for the current image only. */
  const [editSession, setEditSession] = useState<EditSession>(() =>
    createEditSession(0),
  );
  const editSessionRef = useRef(editSession);
  editSessionRef.current = editSession;
  const [customLooks, setCustomLooks] = useState<Look[]>(() =>
    loadSavedLooks(),
  );
  /** Resolved soft mask for the active semantic target (working-buffer res). */
  const [activeMask, setActiveMask] = useState<Mask | null>(null);
  /** Tracks async mask lookup so preview never flashes a wrong global grade. */
  const [maskStatus, setMaskStatus] = useState<
    "none" | "loading" | "ready" | "missing"
  >("none");
  /** Full cached MaskCollection for debug overlay (never sent to export). */
  const [cachedMasks, setCachedMasks] = useState<MaskCollection | null>(null);
  /** Dev overlay toggle — localStorage / Ctrl+Shift+M / ?debugMasks=1 */
  const [maskDebugOn, setMaskDebugOn] = useState(() => isMaskDebugEnabled());
  /** Quiet status for background segmentation (does not block editing). */
  const [segmentStatus, setSegmentStatus] = useState<string | null>(null);
  /** Bumps after export/reset so in-flight AI panels drop stale busy state. */
  const [editorSessionKey, setEditorSessionKey] = useState(0);
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [unsavedBusy, setUnsavedBusy] = useState(false);
  const [unsavedError, setUnsavedError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const editDoc = history.present;
  const params = editDoc.parameters;
  presentRef.current = editDoc;
  const previewParams = useDeferredValue(params);
  // While a semantic mask is resolving, show the outside baseline so under-mask
  // parameters are not briefly painted across the whole image.
  const displayParams = showingBefore
    ? DEFAULT_EDIT_PARAMETERS
    : editDoc.maskTarget && maskStatus === "loading"
      ? (editDoc.baseParameters ?? DEFAULT_EDIT_PARAMETERS)
      : previewParams;

  const previewApplyOptions = useMemo<ApplyEditsOptions | undefined>(() => {
    if (showingBefore || !activeMask || !editDoc.maskTarget) {
      return undefined;
    }
    if (maskStatus !== "ready") return undefined;
    return {
      mask: activeMask,
      baseParameters: editDoc.baseParameters ?? DEFAULT_EDIT_PARAMETERS,
    };
  }, [
    showingBefore,
    activeMask,
    maskStatus,
    editDoc.maskTarget,
    editDoc.baseParameters,
  ]);

  const actionGroups = useMemo(
    () => groupActionsForHistory(editSession.actions),
    [editSession.actions],
  );

  function isCurrentOpen(requestId: number): boolean {
    return requestId === openRequestIdRef.current;
  }

  function markClean(snapshot: EditDocument = presentRef.current): void {
    cleanDocRef.current = cloneEditDocument(snapshot);
    setIsDirty(false);
  }

  function queueRevoke(url: string | null | undefined, requestId: number): void {
    if (!url) return;
    urlsPendingRevokeRef.current.push(url);
    openLog(requestId, "queued placeholder revoke", url.slice(-18));
  }

  // Keep dirty flag in sync with present vs last clean snapshot.
  useEffect(() => {
    setIsDirty(!editDocumentsEqual(editDoc, cleanDocRef.current));
  }, [editDoc]);

  // Resolve / refresh the working-buffer mask whenever the semantic target changes.
  // Prefer the session cache (no re-inference). Failure → global fallback.
  useEffect(() => {
    const target = editDoc.maskTarget;
    if (!target || !source) {
      setActiveMask(null);
      setMaskStatus("none");
      return;
    }

    let cancelled = false;
    const cached = maskProviderRef.current.getCachedLabel(target);
    if (cached) {
      setActiveMask(cached);
      setMaskStatus("ready");
      return;
    }

    setMaskStatus("loading");
    void maskProviderRef.current
      .findLabel(source, target)
      .then((mask) => {
        if (cancelled) return;
        setActiveMask(mask);
        setMaskStatus(mask ? "ready" : "missing");
        setCachedMasks(maskProviderRef.current.getCachedCollection());
      })
      .catch((error) => {
        console.warn("[pixle mask] preview mask resolve failed", error);
        if (cancelled) return;
        setActiveMask(null);
        setMaskStatus("missing");
      });

    return () => {
      cancelled = true;
    };
  }, [editDoc.maskTarget, source, openRequestId]);

  // Keyboard toggle for the mask debug overlay (does not affect export).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== "m") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
        return;
      }
      event.preventDefault();
      const enabled = toggleMaskDebugEnabled();
      setMaskDebugOn(enabled);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Revoke superseded object URLs only after React commits the new placeholder.
  // This effect runs post-commit, so the visible <img> already uses the new URL.
  // Never revoke the live placeholderUrlRef value.
  useEffect(() => {
    const pending = urlsPendingRevokeRef.current.splice(0);
    if (pending.length === 0) return;
    const live = placeholderUrlRef.current;
    for (const url of pending) {
      if (url === live) {
        urlsPendingRevokeRef.current.push(url);
        openLog(openRequestIdRef.current, "defer revoke; still current", url.slice(-18));
        continue;
      }
      try {
        URL.revokeObjectURL(url);
        openLog(openRequestIdRef.current, "revoked obsolete placeholder", url.slice(-18));
      } catch (error) {
        openLog(openRequestIdRef.current, "revoke failed", error);
      }
    }
  }, [placeholderUrl, openRequestId]);

  useEffect(() => {
    return () => {
      openAbortRef.current?.abort();
      openAbortRef.current = null;
      const urls = [
        ...urlsPendingRevokeRef.current,
        placeholderUrlRef.current,
      ].filter((u): u is string => Boolean(u));
      urlsPendingRevokeRef.current = [];
      placeholderUrlRef.current = null;
      for (const url of new Set(urls)) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
    };
  }, []);

  function measurePreviewHint(): PreviewSizeHint {
    const el = viewportShellRef.current;
    const rect = el?.getBoundingClientRect();
    return {
      viewportWidth: Math.max(1, rect?.width ?? window.innerWidth * 0.65),
      viewportHeight: Math.max(1, rect?.height ?? window.innerHeight * 0.6),
      devicePixelRatio: window.devicePixelRatio || 1,
    };
  }

  function handleCanvasReady(requestId: number): void {
    if (!isCurrentOpen(requestId)) {
      openLog(requestId, "stale canvas ready; ignore");
      return;
    }
    setPreparing(false);
    setPrepareError(null);
    openLog(requestId, "preparing=false after canvas ready");
    perfLog(`open #${requestId} handoff complete`);
  }

  function handlePlaceholderRetired(requestId: number): void {
    if (!isCurrentOpen(requestId)) {
      openLog(requestId, "stale placeholder retire; ignore");
      return;
    }
    const url = placeholderUrlRef.current;
    if (!url) return;
    // Only retire the URL that belonged to this completed handoff.
    placeholderUrlRef.current = null;
    setPlaceholderUrl(null);
    queueRevoke(url, requestId);
    openLog(requestId, "placeholder cleared after fade");
  }

  /**
   * Open a file into the editor. Callers must already have handled dirty-state
   * confirmation — this always replaces the current document.
   */
  async function openImageFile(file: File): Promise<void> {
    // —— Invalidate the previous open immediately ——
    const previousAbort = openAbortRef.current;
    previousAbort?.abort();
    const abortController = new AbortController();
    openAbortRef.current = abortController;

    const requestId = ++openRequestIdRef.current;
    setOpenRequestId(requestId);
    const endOpen = perfTime(`open image pipeline #${requestId}`);
    const endPlaceholder = perfTime(`placeholder create #${requestId}`);
    openLog(requestId, "open start", { name: file.name, size: file.size });

    // Create the new placeholder BEFORE clearing the old canvas source.
    // Never revoke the previous URL synchronously while an <img> may still use it.
    const previousUrl = placeholderUrlRef.current;
    const objectUrl = URL.createObjectURL(file);
    placeholderUrlRef.current = objectUrl;
    if (previousUrl && previousUrl !== objectUrl) {
      queueRevoke(previousUrl, requestId);
    }

    setPlaceholderUrl(objectUrl);
    setSource(null);
    setSourceFile(file);
    setFileName(file.name);
    setImageAnalysis(null);
    setHistory(createEditHistory());
    setLastEdit(null);
    setEditSession(createEditSession(requestId));
    setActiveMask(null);
    setMaskStatus("none");
    setCachedMasks(null);
    setSegmentStatus(null);
    segmentAbortRef.current?.abort();
    segmentAbortRef.current = new AbortController();
    maskProviderRef.current.clearCache();
    setExportStatus(null);
    setPrepareError(null);
    setShowingBefore(false);
    setBeforeLatched(false);
    holdingBeforeRef.current = false;
    setEditorSessionKey((key) => key + 1);
    setPreparing(true);
    markClean(createGlobalEditDocument());
    endPlaceholder();
    openLog(requestId, "placeholder ready; preparing=true");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    // Let the newest placeholder paint before heavy decode work.
    await yieldToUi();
    if (!isCurrentOpen(requestId) || abortController.signal.aborted) {
      openLog(requestId, "stale after yield; ignore");
      return;
    }

    try {
      const hint = measurePreviewHint();
      openLog(requestId, "decode requested", hint);
      const endDecode = perfTime(`decodeImageFile #${requestId}`);
      const decoded = await decodeImageFile(file, {
        hint,
        signal: abortController.signal,
        requestId,
      });
      endDecode();

      if (!isCurrentOpen(requestId) || abortController.signal.aborted) {
        openLog(requestId, "stale after decode; discard ImageData");
        return;
      }

      const endAnalysis = perfTime(`quickAnalysis #${requestId}`);
      const quickAnalysis = analyzeImageSync(decoded.working, {
        width: decoded.originalWidth,
        height: decoded.originalHeight,
      });
      endAnalysis();

      if (!isCurrentOpen(requestId)) {
        openLog(requestId, "stale before setSource; ignore");
        return;
      }

      // Keep preparing=true until ImageViewport reports the first canvas paint.
      // Clearing it here unmounted the placeholder before putImageData → black flash.
      setSource(decoded.working);
      setImageAnalysis(quickAnalysis);
      openLog(requestId, "working buffer ready; awaiting canvas paint", {
        w: decoded.working.width,
        h: decoded.working.height,
      });
      endOpen();

      // Background segmentation — never blocks the open path or global editing.
      const segSignal = segmentAbortRef.current?.signal;
      setSegmentStatus("Segmenting…");
      void maskProviderRef.current
        .prefetch(decoded.working, segSignal)
        .then((collection) => {
          if (!isCurrentOpen(requestId) || segSignal?.aborted) return;
          setCachedMasks(collection);
          const target = presentRef.current.maskTarget;
          if (target) {
            const mask = maskProviderRef.current.getCachedLabel(target);
            setActiveMask(mask);
            setMaskStatus(mask ? "ready" : "missing");
          }
          if (collection.masks.length > 0) {
            setSegmentStatus(`Masks ready · ${collection.masks.length}`);
            window.setTimeout(() => {
              if (isCurrentOpen(requestId)) setSegmentStatus(null);
            }, 2200);
          } else {
            setSegmentStatus(null);
          }
          openLog(requestId, "segmentation cached", {
            count: collection.masks.length,
            labels: collection.masks.map((m) => m.label),
          });
        })
        .catch((error) => {
          if (!isCurrentOpen(requestId) || segSignal?.aborted) return;
          console.warn("[pixle mask] background segmentation failed", error);
          setSegmentStatus(null);
          setCachedMasks(null);
        });

      await yieldToUi();
      if (!isCurrentOpen(requestId) || abortController.signal.aborted) {
        openLog(requestId, "stale before analysis; ignore");
        return;
      }

      try {
        const analysis = await analyzeImage(decoded.working, {
          width: decoded.originalWidth,
          height: decoded.originalHeight,
        });
        if (!isCurrentOpen(requestId)) {
          openLog(requestId, "stale after analysis; ignore");
          return;
        }
        setImageAnalysis(analysis);
      } catch {
        // Keep quickAnalysis already applied.
      }
    } catch (error) {
      if (isAbortError(error) || !isCurrentOpen(requestId)) {
        openLog(requestId, "open cancelled/stale", error);
        return;
      }
      openLog(requestId, "open failed", error);
      // Keep the placeholder visible and the app usable — do not blank the viewport.
      setSource(null);
      setPreparing(false);
      setPrepareError("Could not prepare that image.");
      setExportTone("error");
      setExportStatus("Could not prepare that image.");
    } finally {
      // Active request: only clear preparing on failure/abort paths that never
      // reach canvas-ready. Success clears preparing in handleCanvasReady.
      if (isCurrentOpen(requestId) && abortController.signal.aborted) {
        setPreparing(false);
      }
      if (isCurrentOpen(requestId)) {
        openLog(requestId, "loading finally");
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      } else {
        openLog(requestId, "loading finally ignored (not current)");
      }
    }
  }

  function requestOpenFile(file: File): void {
    const accepted =
      file.type === "image/jpeg" ||
      file.type === "image/png" ||
      /\.(jpe?g|png)$/i.test(file.name);

    if (!accepted) {
      window.alert("Please choose a JPEG or PNG image.");
      return;
    }

    // Dirty document → confirm before replacing.
    if (isDirty && sourceFile) {
      pendingOpenFileRef.current = file;
      setUnsavedError(null);
      setUnsavedDialogOpen(true);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    void openImageFile(file);
  }

  function handleFileChange(fileList: FileList | null) {
    const file = fileList?.[0];
    // Allow replacing an image while prepare is running; only block during export.
    if (!file || exportingRef.current) return;
    requestOpenFile(file);
  }

  function openImagePicker() {
    if (exportingRef.current || unsavedBusy) return;
    fileInputRef.current?.click();
  }

  function handleUnsavedCancel() {
    if (unsavedBusy) return;
    pendingOpenFileRef.current = null;
    setUnsavedDialogOpen(false);
    setUnsavedError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleUnsavedDontSave() {
    if (unsavedBusy) return;
    const pending = pendingOpenFileRef.current;
    pendingOpenFileRef.current = null;
    setUnsavedDialogOpen(false);
    setUnsavedError(null);
    if (pending) {
      void openImageFile(pending);
    }
  }

  async function handleUnsavedSave() {
    if (unsavedBusy) return;
    const pending = pendingOpenFileRef.current;
    if (!pending) {
      setUnsavedDialogOpen(false);
      return;
    }

    setUnsavedBusy(true);
    setUnsavedError(null);
    try {
      const result = await runExport();
      if (result.status === "cancelled") {
        // Export dialog cancelled — remain on the current image.
        return;
      }
      if (result.status === "error") {
        setUnsavedError(result.message);
        return;
      }
      pendingOpenFileRef.current = null;
      setUnsavedDialogOpen(false);
      await openImageFile(pending);
    } finally {
      setUnsavedBusy(false);
    }
  }

  function bindIntensityFromAction(action: {
    beforeParameters: EditParameters;
    parameters: EditParameters;
  }): void {
    setLastEdit(actionIntensitySession({
      id: "",
      target: null,
      targetLabel: "",
      parameters: action.parameters,
      baseParameters: null,
      beforeParameters: action.beforeParameters,
      maskLabel: null,
      mask: null,
      timestamp: 0,
      summary: "",
      prompt: "",
    }));
  }

  function recordSessionAction(input: {
    target: string | null;
    parameters: EditParameters;
    baseParameters: EditParameters | null;
    beforeParameters: EditParameters;
    mask: Mask | null;
    summary: string;
    prompt: string;
  }): void {
    const action = createEditAction(input);
    setEditSession((prev) => appendEditAction(prev, action));
    bindIntensityFromAction(action);
  }

  /** Commit a global (whole-image) edit and bind intensity + session action. */
  function applyCommittedEdit(
    next: EditParameters,
    meta?: { summary?: string; prompt?: string },
  ) {
    const beforeDoc = presentRef.current;
    const beforeParams = beforeDoc.parameters;
    if (
      !beforeDoc.maskTarget &&
      parametersEqual(beforeParams, next)
    ) {
      return;
    }

    setHistory((prev) =>
      commitEdit(prev, createGlobalEditDocument(next)),
    );
    recordSessionAction({
      target: null,
      parameters: next,
      baseParameters: null,
      beforeParameters: beforeParams,
      mask: null,
      summary: meta?.summary || "Global edit",
      prompt: meta?.prompt || "",
    });
  }

  /**
   * Apply parameters for a semantic target using the cached Segmenter mask.
   * Falls back to global when no mask is available.
   */
  async function applyTargetedEdit(input: {
    target: string;
    parameters: EditParameters;
    summary: string;
    prompt: string;
  }): Promise<"local" | "global"> {
    const beforeDoc = presentRef.current;
    const resolved = resolveSemanticLabel(input.target);
    const nextParams = input.parameters;

    if (source) {
      try {
        let mask = maskProviderRef.current.getCachedLabel(resolved);
        if (!mask) {
          mask = await maskProviderRef.current.findLabel(source, resolved);
          setCachedMasks(maskProviderRef.current.getCachedCollection());
        }
        if (mask) {
          const baseParameters =
            beforeDoc.maskTarget === resolved && beforeDoc.baseParameters
              ? beforeDoc.baseParameters
              : documentGlobalParameters(beforeDoc);
          const intensityBefore =
            beforeDoc.maskTarget === resolved
              ? beforeDoc.parameters
              : baseParameters;

          if (
            beforeDoc.maskTarget === resolved &&
            parametersEqual(beforeDoc.parameters, nextParams) &&
            beforeDoc.baseParameters &&
            parametersEqual(beforeDoc.baseParameters, baseParameters)
          ) {
            return "local";
          }

          setActiveMask(mask);
          setHistory((prev) =>
            commitEdit(
              prev,
              createLocalEditDocument(nextParams, resolved, baseParameters),
            ),
          );
          recordSessionAction({
            target: resolved,
            parameters: nextParams,
            baseParameters,
            beforeParameters: intensityBefore,
            mask,
            summary: input.summary,
            prompt: input.prompt,
          });
          return "local";
        }
      } catch (error) {
        console.warn(
          "[pixle mask] local edit fell back to global — segmenter error",
          error,
        );
      }
    }

    applyCommittedEdit(nextParams, {
      summary: input.summary,
      prompt: input.prompt,
    });
    return "global";
  }

  async function applyAiEditResult(
    result: EditFromPromptResult,
    prompt: string,
  ): Promise<AiPromptResult> {
    const intent = result.intent || "edit";

    if (intent === "clarify") {
      return {
        message: result.clarification || "Which edit did you mean?",
        tone: "clarify",
      };
    }

    if (intent === "undo_previous") {
      return applyConversationalUndo();
    }
    if (intent === "redo_previous") {
      return applyConversationalRedo();
    }

    if (intent === "adjust_previous") {
      const session = editSessionRef.current;
      let action = getActiveAction(session);
      if (result.referenceTarget) {
        const resolved = resolveSemanticLabel(result.referenceTarget);
        action =
          [...session.actions]
            .reverse()
            .find((a) => a.target === resolved) ?? action;
      }
      if (!action) {
        return {
          message: "Which edit should I adjust?",
          tone: "clarify",
        };
      }

      const factor = result.adjustFactor;
      // When Gemini supplies a relative factor, scale only that action's delta.
      // Otherwise apply the absolute grade it returned for the same target.
      const nextParams =
        factor != null
          ? scaleActionParameters(
              action.beforeParameters,
              action.parameters,
              factor,
            )
          : result.parameters;
      const summary =
        shortenEditSummary(result.editSummary) ||
        (factor != null
          ? factor >= 1
            ? `Stronger ${action.targetLabel}`
            : `Softer ${action.targetLabel}`
          : `Adjusted ${action.targetLabel}`);

      if (action.target) {
        await applyTargetedEdit({
          target: action.target,
          parameters: nextParams,
          summary,
          prompt,
        });
      } else {
        applyCommittedEdit(nextParams, { summary, prompt });
      }
      return { message: summary, tone: "ok" };
    }

    // Default: new edit
    const summary =
      shortenEditSummary(result.editSummary) ||
      (result.target ? `${result.target} edit` : "Edit applied");
    if (result.target) {
      const mode = await applyTargetedEdit({
        target: result.target,
        parameters: result.parameters,
        summary,
        prompt,
      });
      return {
        message: mode === "local" ? `${summary} · ${result.target}` : summary,
        tone: "ok",
      };
    }
    applyCommittedEdit(result.parameters, { summary, prompt });
    return { message: summary, tone: "ok" };
  }

  function applyConversationalUndo(): AiPromptResult {
    const { session, undone } = conversationalUndo(editSessionRef.current);
    if (!undone) {
      return { message: "Nothing to undo", tone: "error" };
    }
    setEditSession(session);
    // Restore document to the pre-action grade (document undo stack also advances).
    setHistory((prev) =>
      commitEdit(
        prev,
        undone.target && undone.baseParameters
          ? createLocalEditDocument(
              undone.beforeParameters,
              undone.target,
              undone.baseParameters,
            )
          : createGlobalEditDocument(undone.beforeParameters),
      ),
    );
    if (undone.mask && undone.target) {
      setActiveMask(undone.mask);
    } else if (!undone.target) {
      setActiveMask(null);
    }
    const active = getActiveAction(session);
    if (active) {
      bindIntensityFromAction(active);
    } else {
      setLastEdit(null);
    }
    return { message: `Undid ${undone.summary}`, tone: "ok" };
  }

  function applyConversationalRedo(): AiPromptResult {
    const { session, redone } = conversationalRedo(editSessionRef.current);
    if (!redone) {
      return { message: "Nothing to redo", tone: "error" };
    }
    setEditSession(session);
    setHistory((prev) =>
      commitEdit(
        prev,
        redone.target && redone.baseParameters
          ? createLocalEditDocument(
              redone.parameters,
              redone.target,
              redone.baseParameters,
            )
          : createGlobalEditDocument(redone.parameters),
      ),
    );
    if (redone.mask) setActiveMask(redone.mask);
    bindIntensityFromAction(redone);
    return { message: `Redid ${redone.summary}`, tone: "ok" };
  }

  /**
   * Full conversational prompt path: local follow-ups first, then Gemini with
   * EditSession context. Never blocks editing on ambiguity — asks instead.
   */
  async function handleAiPrompt(prompt: string): Promise<AiPromptResult> {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return { message: "Prompt must not be empty.", tone: "error" };
    }
    if (!imageAnalysis) {
      return { message: "Image analysis is still preparing…", tone: "error" };
    }

    const session = editSessionRef.current;

    // 1) Deterministic follow-ups against the active EditAction.
    const local = tryResolveFollowUp(trimmed, session);
    if (local) {
      if (local.kind === "undo") return applyConversationalUndo();
      if (local.kind === "redo") return applyConversationalRedo();

      const action = local.action;
      if (local.kind === "amplify" || local.kind === "reduce") {
        const factor = local.factor ?? 1;
        const next = scaleActionParameters(
          action.beforeParameters,
          action.parameters,
          factor,
        );
        const summary =
          factor >= 1
            ? `A little more · ${action.targetLabel}`
            : `Not that much · ${action.targetLabel}`;
        if (action.target) {
          await applyTargetedEdit({
            target: action.target,
            parameters: next,
            summary,
            prompt: trimmed,
          });
        } else {
          applyCommittedEdit(next, { summary, prompt: trimmed });
        }
        return { message: summary, tone: "ok" };
      }

      if (local.kind === "warmer" || local.kind === "cooler") {
        const next = cloneEditParameters(action.parameters);
        next.temperature = clampScalarParam(
          "temperature",
          next.temperature + (local.temperatureDelta ?? 0),
        );
        const summary =
          local.kind === "warmer"
            ? `Warmer · ${action.targetLabel}`
            : `Cooler · ${action.targetLabel}`;
        if (action.target) {
          await applyTargetedEdit({
            target: action.target,
            parameters: next,
            summary,
            prompt: trimmed,
          });
        } else {
          applyCommittedEdit(next, { summary, prompt: trimmed });
        }
        return { message: summary, tone: "ok" };
      }
    }

    // 2) Follow-up wording with no actionable session → ask, never guess.
    if (looksLikeFollowUp(trimmed) && session.actions.length === 0) {
      return {
        message: "Which edit should I adjust? Try a first edit first.",
        tone: "clarify",
      };
    }

    // 3) Gemini with compact EditSession context.
    const result = await editFromPrompt(
      trimmed,
      presentRef.current.parameters,
      imageAnalysis,
      buildSessionContext(session),
    );
    return applyAiEditResult(result, trimmed);
  }

  function handleSelectAction(actionId: string) {
    const chosen = editSessionRef.current.actions.find(
      (action) => action.id === actionId,
    );
    if (!chosen) return;
    setEditSession((prev) => selectEditAction(prev, actionId));
    bindIntensityFromAction(chosen);
    if (chosen.mask) setActiveMask(chosen.mask);
  }

  /**
   * Live parameter updates without a history step.
   * Manual Adjust drags clear the last-edit session so Intensity/Changes
   * stay tied only to the most recent AI or look apply.
   * Keeps an active semantic mask target so under-mask sliders still work.
   */
  function setParamsLive(
    next: EditParameters,
    options?: { preserveLastEdit?: boolean },
  ) {
    setHistory((prev) => ({
      ...prev,
      present: {
        ...prev.present,
        parameters: cloneEditParameters(next),
      },
      // Live slider changes discard redo — present has diverged.
      future: [],
    }));
    if (!options?.preserveLastEdit) {
      setLastEdit(null);
    }
  }

  function handleIntensityChange(value: number) {
    if (!lastEdit) return;
    const intensity = Math.min(100, Math.max(0, value));
    const blended = lerpParameters(
      lastEdit.before,
      lastEdit.after,
      intensity / 100,
    );
    setLastEdit({ ...lastEdit, intensity });
    setParamsLive(blended, { preserveLastEdit: true });
  }

  function handleUndo() {
    setHistory((prev) => undoEdit(prev));
    setLastEdit(null);
  }

  function handleRedo() {
    setHistory((prev) => redoEdit(prev));
    setLastEdit(null);
  }

  function handleReset() {
    setHistory((prev) => resetEdit(prev));
    setLastEdit(null);
    setEditSession(createEditSession(openRequestIdRef.current));
    setActiveMask(null);
    setMaskStatus("none");
    setShowingBefore(false);
    setBeforeLatched(false);
    holdingBeforeRef.current = false;
    setExportStatus(null);
    // Drop any in-flight AI busy/error UI tied to the previous edit session.
    setEditorSessionKey((key) => key + 1);
  }

  function handleBeforePointerDown() {
    holdingBeforeRef.current = true;
    setShowingBefore(true);
  }

  function handleBeforePointerUp(durationMs: number) {
    holdingBeforeRef.current = false;
    // Short press = click toggle; longer press = hold-to-peek.
    if (durationMs > 0 && durationMs < 280) {
      setBeforeLatched((latched) => {
        const next = !latched;
        setShowingBefore(next);
        return next;
      });
      return;
    }
    setBeforeLatched((latched) => {
      setShowingBefore(latched);
      return latched;
    });
  }

  function handleToggleBefore() {
    setBeforeLatched((latched) => {
      const next = !latched;
      setShowingBefore(next);
      return next;
    });
  }

  function handleApplyLook(look: Look) {
    applyCommittedEdit(cloneEditParameters(look.parameters));
  }

  function handleSaveLook() {
    if (!source) return;
    const name = window.prompt("Name this look");
    if (name === null) return;
    const saved = saveLook(name, params);
    if (!saved) {
      window.alert("Please enter a name for the look.");
      return;
    }
    setCustomLooks(loadSavedLooks());
  }

  type ExportRunResult =
    | { status: "saved" }
    | { status: "cancelled" }
    | { status: "error"; message: string };

  /**
   * Run the export flow. Success marks the document clean.
   * Cancel / failure leave the document dirty.
   */
  async function runExport(): Promise<ExportRunResult> {
    if (!sourceFile || exportingRef.current || preparing || !source) {
      return { status: "cancelled" };
    }

    const present = presentRef.current;
    const exportOptions = {
      sourceFile,
      params: cloneEditParameters(present.parameters),
      originalFileName: fileName,
      maskTarget: present.maskTarget,
      baseParameters: present.baseParameters
        ? cloneEditParameters(present.baseParameters)
        : null,
      maskProvider: maskProviderRef.current,
      mask: activeMask,
    };

    setExportStatus(null);

    let destination;
    try {
      // Keep the UI interactive while the native save dialog is open. Disabling
      // controls for the dialog itself left the app unclickable after cancel /
      // save on some Tauri webviews (stuck disabled + lost focus/pointer).
      destination = await chooseExportDestination(exportOptions);
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : "Could not open the save dialog.";
      setExportTone("error");
      setExportStatus(message);
      return { status: "error", message };
    }

    if (destination.status === "cancelled") {
      setExportStatus(null);
      return { status: "cancelled" };
    }

    exportingRef.current = true;
    setExporting(true);

    try {
      const result = await writeExport(exportOptions, destination);

      if (result.status === "cancelled") {
        setExportStatus(null);
        return { status: "cancelled" };
      }

      setExportTone("ok");
      const shortName = result.path.split(/[/\\]/).pop() ?? result.path;
      setExportStatus(`Saved ${shortName}`);
      markClean(presentRef.current);
      return { status: "saved" };
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : "Could not save the image.";
      setExportTone("error");
      setExportStatus(message);
      return { status: "error", message };
    } finally {
      exportingRef.current = false;
      setExporting(false);
      // Ensure Ask pixle is remounted interactive after the export path.
      setEditorSessionKey((key) => key + 1);
    }
  }

  async function handleExport() {
    await runExport();
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        target?.isContentEditable
      ) {
        return;
      }

      const mod = event.metaKey || event.ctrlKey;
      if (!mod || !source) return;

      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
        return;
      }
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        handleRedo();
        return;
      }
      if (key === "y" && !event.metaKey) {
        // Ctrl+Y redo on Windows/Linux; ignore Cmd+Y on macOS.
        event.preventDefault();
        handleRedo();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [source]);

  const imageReady = Boolean(source) && !preparing;
  const hasDocument = Boolean(sourceFile);
  const controlsDisabled = !source || preparing || exporting || unsavedBusy;
  const canSaveLook =
    imageReady && !parametersEqual(params, DEFAULT_EDIT_PARAMETERS);

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar__brand">pixle</div>
        <div className="toolbar__actions">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,.jpg,.jpeg,.png"
            className="toolbar__file-input"
            onChange={(e) => handleFileChange(e.currentTarget.files)}
          />
          <button
            type="button"
            className="toolbar__open"
            disabled={exporting || unsavedBusy}
            onClick={openImagePicker}
          >
            Open Image
          </button>
          {fileName ? (
            <span className="toolbar__filename" title={fileName}>
              {fileName}
              {isDirty ? " •" : ""}
            </span>
          ) : null}
          {preparing ? (
            <span className="toolbar__prepare-status">Preparing editor…</span>
          ) : null}
          {segmentStatus && !preparing ? (
            <span className="toolbar__prepare-status" title="Background segmentation">
              {segmentStatus}
            </span>
          ) : null}
          {maskDebugOn ? (
            <span className="toolbar__prepare-status" title="Ctrl/Cmd+Shift+M to toggle">
              Mask debug
            </span>
          ) : null}
          {prepareError && !preparing ? (
            <span
              className="toolbar__export-status toolbar__export-status--error"
              title={prepareError}
            >
              {prepareError}
            </span>
          ) : null}
          {exportStatus && !prepareError ? (
            <span
              className={
                exportTone === "error"
                  ? "toolbar__export-status toolbar__export-status--error"
                  : "toolbar__export-status"
              }
              title={exportStatus}
            >
              {exportStatus}
            </span>
          ) : null}
          <button
            type="button"
            className="toolbar__export"
            disabled={!imageReady || exporting || unsavedBusy}
            onClick={handleExport}
          >
            {exporting ? "Exporting…" : "Export"}
          </button>
        </div>
      </header>

      <div className="workspace">
        <div className="workspace__main">
          {imageReady ? (
            <ImageToolbar
              disabled={!imageReady || exporting || unsavedBusy}
              canUndo={canUndo(history)}
              canRedo={canRedo(history)}
              showingBefore={showingBefore}
              onUndo={handleUndo}
              onRedo={handleRedo}
              onReset={handleReset}
              onBeforePointerDown={handleBeforePointerDown}
              onBeforePointerUp={handleBeforePointerUp}
              onToggleBefore={handleToggleBefore}
            />
          ) : null}
          <div className="workspace__viewport" ref={viewportShellRef}>
            <ImageViewport
              source={source}
              placeholderUrl={placeholderUrl}
              openRequestId={openRequestId}
              preparing={preparing && hasDocument}
              params={displayParams}
              applyOptions={previewApplyOptions}
              debugMasks={maskDebugOn ? cachedMasks : null}
              onOpenImage={openImagePicker}
              comparing={showingBefore}
              onCanvasReady={handleCanvasReady}
              onPlaceholderRetired={handlePlaceholderRetired}
            />
          </div>
          <AiEditorPanel
            key={editorSessionKey}
            analysisReady={Boolean(imageAnalysis)}
            disabled={controlsDisabled}
            onSubmitPrompt={handleAiPrompt}
          />
        </div>
        <RightSidebar
          params={params}
          disabled={controlsDisabled}
          onChange={setParamsLive}
          onReset={handleReset}
          intensity={lastEdit ? lastEdit.intensity : null}
          onIntensityChange={handleIntensityChange}
          actionGroups={actionGroups}
          activeActionId={editSession.activeActionId}
          onSelectAction={handleSelectAction}
          builtinLooks={BUILTIN_LOOKS}
          customLooks={customLooks}
          canSaveLook={canSaveLook}
          onSaveLook={handleSaveLook}
          onApplyLook={handleApplyLook}
        />
      </div>

      <UnsavedChangesModal
        open={unsavedDialogOpen}
        busy={unsavedBusy}
        error={unsavedError}
        onSave={() => {
          void handleUnsavedSave();
        }}
        onDontSave={handleUnsavedDontSave}
        onCancel={handleUnsavedCancel}
      />
    </div>
  );
}

export default App;
