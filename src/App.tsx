import { useDeferredValue, useEffect, useRef, useState } from "react";
import { AiEditorPanel } from "./components/AiEditorPanel";
import { ImageToolbar } from "./components/ImageToolbar";
import { ImageViewport } from "./components/ImageViewport";
import { RightSidebar } from "./components/RightSidebar";
import {
  chooseExportDestination,
  writeExport,
} from "./exportFile";
import {
  BUILTIN_LOOKS,
  DEFAULT_EDIT_PARAMETERS,
  analyzeImage,
  analyzeImageSync,
  canRedo,
  canUndo,
  cloneEditParameters,
  commitEdit,
  createEditHistory,
  decodeImageFile,
  diffParameters,
  lerpParameters,
  parametersEqual,
  redoEdit,
  resetEdit,
  undoEdit,
  yieldToUi,
  type EditHistoryState,
  type EditParameters,
  type ImageAnalysis,
  type Look,
  type PreviewSizeHint,
} from "./engine";
import { perfLog, perfTime } from "./engine/perf";
import { loadSavedLooks, saveLook } from "./looksStorage";
import "./App.css";

/** Tracks the most recent AI or look apply for intensity + changes. */
interface LastEditSession {
  before: EditParameters;
  after: EditParameters;
  intensity: number;
}

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewportShellRef = useRef<HTMLDivElement>(null);
  const openGenerationRef = useRef(0);
  const exportingRef = useRef(false);
  const holdingBeforeRef = useRef(false);
  const placeholderUrlRef = useRef<string | null>(null);
  const presentRef = useRef<EditParameters>(
    cloneEditParameters(DEFAULT_EDIT_PARAMETERS),
  );
  /** Working preview buffer — set once per open; not recopied on slider moves. */
  const [source, setSource] = useState<ImageData | null>(null);
  /** Immediate object-URL preview of the selected File. */
  const [placeholderUrl, setPlaceholderUrl] = useState<string | null>(null);
  /** Original file kept for full-resolution export (never mutated). */
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [imageAnalysis, setImageAnalysis] = useState<ImageAnalysis | null>(
    null,
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exportTone, setExportTone] = useState<"ok" | "error">("ok");
  const [history, setHistory] = useState<EditHistoryState>(() =>
    createEditHistory(),
  );
  const [showingBefore, setShowingBefore] = useState(false);
  const [, setBeforeLatched] = useState(false);
  const [lastEdit, setLastEdit] = useState<LastEditSession | null>(null);
  const [customLooks, setCustomLooks] = useState<Look[]>(() =>
    loadSavedLooks(),
  );
  /** Bumps after export/reset so in-flight AI panels drop stale busy state. */
  const [editorSessionKey, setEditorSessionKey] = useState(0);

  const params = history.present;
  presentRef.current = params;
  const previewParams = useDeferredValue(params);
  const displayParams = showingBefore
    ? DEFAULT_EDIT_PARAMETERS
    : previewParams;

  const changes = lastEdit
    ? diffParameters(lastEdit.before, lastEdit.after)
    : [];

  function revokePlaceholderUrl() {
    if (placeholderUrlRef.current) {
      URL.revokeObjectURL(placeholderUrlRef.current);
      placeholderUrlRef.current = null;
    }
    setPlaceholderUrl(null);
  }

  useEffect(() => {
    return () => {
      if (placeholderUrlRef.current) {
        URL.revokeObjectURL(placeholderUrlRef.current);
        placeholderUrlRef.current = null;
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

  async function handleFileChange(fileList: FileList | null) {
    const file = fileList?.[0];
    // Allow replacing an image while prepare is running; only block during export.
    if (!file || exportingRef.current) return;

    const accepted =
      file.type === "image/jpeg" ||
      file.type === "image/png" ||
      /\.(jpe?g|png)$/i.test(file.name);

    if (!accepted) {
      window.alert("Please choose a JPEG or PNG image.");
      return;
    }

    const generation = ++openGenerationRef.current;
    const endOpen = perfTime("open image pipeline");

    // —— Immediate placeholder (no decode wait) ——
    revokePlaceholderUrl();
    const objectUrl = URL.createObjectURL(file);
    placeholderUrlRef.current = objectUrl;
    setPlaceholderUrl(objectUrl);
    setSource(null);
    setSourceFile(file);
    setFileName(file.name);
    setImageAnalysis(null);
    setHistory(createEditHistory());
    setLastEdit(null);
    setExportStatus(null);
    setShowingBefore(false);
    setBeforeLatched(false);
    holdingBeforeRef.current = false;
    setEditorSessionKey((key) => key + 1);
    setPreparing(true);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    // Let the placeholder paint before heavy decode work.
    await yieldToUi();
    if (generation !== openGenerationRef.current) return;

    try {
      const hint = measurePreviewHint();
      perfLog("preview hint", hint);
      const decoded = await decodeImageFile(file, hint);
      if (generation !== openGenerationRef.current) return;

      const quickAnalysis = analyzeImageSync(decoded.working, {
        width: decoded.originalWidth,
        height: decoded.originalHeight,
      });

      setSource(decoded.working);
      setImageAnalysis(quickAnalysis);
      setPreparing(false);
      endOpen();

      // Drop the object URL once the editable canvas owns the view.
      requestAnimationFrame(() => {
        if (generation !== openGenerationRef.current) return;
        if (placeholderUrlRef.current === objectUrl) {
          URL.revokeObjectURL(objectUrl);
          placeholderUrlRef.current = null;
          setPlaceholderUrl(null);
        }
      });

      await yieldToUi();
      if (generation !== openGenerationRef.current) return;

      try {
        const analysis = await analyzeImage(decoded.working, {
          width: decoded.originalWidth,
          height: decoded.originalHeight,
        });
        if (generation !== openGenerationRef.current) return;
        setImageAnalysis(analysis);
      } catch {
        // Keep quickAnalysis already applied.
      }
    } catch (error) {
      perfLog("open image failed", error);
      if (generation === openGenerationRef.current) {
        revokePlaceholderUrl();
        setSource(null);
        setSourceFile(null);
        setFileName(null);
        setImageAnalysis(null);
        setPreparing(false);
        window.alert("Could not open that image.");
      }
    } finally {
      if (generation === openGenerationRef.current) {
        setPreparing(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    }
  }

  function openImagePicker() {
    if (exportingRef.current) return;
    fileInputRef.current?.click();
  }

  /** Commit a new present state and bind intensity/changes to that edit. */
  function applyCommittedEdit(next: EditParameters) {
    const before = presentRef.current;
    if (parametersEqual(before, next)) return;

    setLastEdit({
      before: cloneEditParameters(before),
      after: cloneEditParameters(next),
      intensity: 100,
    });
    setHistory((prev) => commitEdit(prev, next));
  }

  /**
   * Live parameter updates without a history step.
   * Manual Adjust drags clear the last-edit session so Intensity/Changes
   * stay tied only to the most recent AI or look apply.
   */
  function setParamsLive(
    next: EditParameters,
    options?: { preserveLastEdit?: boolean },
  ) {
    setHistory((prev) => ({
      ...prev,
      present: cloneEditParameters(next),
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

  async function handleExport() {
    // Use a ref so a second click before re-render cannot start another export.
    if (!sourceFile || exportingRef.current || preparing || !source) return;

    const exportOptions = {
      sourceFile,
      params: cloneEditParameters(presentRef.current),
      originalFileName: fileName,
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
      return;
    }

    if (destination.status === "cancelled") {
      setExportStatus(null);
      return;
    }

    exportingRef.current = true;
    setExporting(true);

    try {
      const result = await writeExport(exportOptions, destination);

      if (result.status === "cancelled") {
        setExportStatus(null);
        return;
      }

      setExportTone("ok");
      const shortName = result.path.split(/[/\\]/).pop() ?? result.path;
      setExportStatus(`Saved ${shortName}`);
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : "Could not save the image.";
      setExportTone("error");
      setExportStatus(message);
    } finally {
      exportingRef.current = false;
      setExporting(false);
      // Ensure Ask pixle is remounted interactive after the export path.
      setEditorSessionKey((key) => key + 1);
    }
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
  const controlsDisabled = !source || preparing || exporting;
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
            disabled={exporting}
            onClick={openImagePicker}
          >
            Open Image
          </button>
          {fileName ? (
            <span className="toolbar__filename" title={fileName}>
              {fileName}
            </span>
          ) : null}
          {preparing ? (
            <span className="toolbar__prepare-status">Preparing editor…</span>
          ) : null}
          {exportStatus ? (
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
            disabled={!imageReady || exporting}
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
              disabled={!imageReady || exporting}
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
              preparing={preparing && hasDocument}
              params={displayParams}
              onOpenImage={openImagePicker}
              comparing={showingBefore}
            />
          </div>
          <AiEditorPanel
            key={editorSessionKey}
            params={params}
            imageAnalysis={imageAnalysis}
            disabled={controlsDisabled}
            onApply={applyCommittedEdit}
          />
        </div>
        <RightSidebar
          params={params}
          disabled={controlsDisabled}
          onChange={setParamsLive}
          onReset={handleReset}
          intensity={lastEdit ? lastEdit.intensity : null}
          onIntensityChange={handleIntensityChange}
          changes={changes}
          builtinLooks={BUILTIN_LOOKS}
          customLooks={customLooks}
          canSaveLook={canSaveLook}
          onSaveLook={handleSaveLook}
          onApplyLook={handleApplyLook}
        />
      </div>
    </div>
  );
}

export default App;
