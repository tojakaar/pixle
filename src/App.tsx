import { useDeferredValue, useEffect, useRef, useState } from "react";
import { AiEditorPanel } from "./components/AiEditorPanel";
import { EditPanel } from "./components/EditPanel";
import { ImageToolbar } from "./components/ImageToolbar";
import { ImageViewport } from "./components/ImageViewport";
import { exportEditedImage } from "./exportFile";
import {
  BUILTIN_LOOKS,
  DEFAULT_EDIT_PARAMETERS,
  analyzeImage,
  analyzeImageSync,
  canRedo,
  canUndo,
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
} from "./engine";
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
  const openGenerationRef = useRef(0);
  const holdingBeforeRef = useRef(false);
  const presentRef = useRef<EditParameters>({ ...DEFAULT_EDIT_PARAMETERS });
  const [source, setSource] = useState<ImageData | null>(null);
  /** Original file kept for full-resolution export (never mutated). */
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [imageAnalysis, setImageAnalysis] = useState<ImageAnalysis | null>(
    null,
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
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

  const params = history.present;
  presentRef.current = params;
  const previewParams = useDeferredValue(params);
  const displayParams = showingBefore
    ? DEFAULT_EDIT_PARAMETERS
    : previewParams;

  const changes = lastEdit
    ? diffParameters(lastEdit.before, lastEdit.after)
    : [];

  async function handleFileChange(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file || opening) return;

    const accepted =
      file.type === "image/jpeg" ||
      file.type === "image/png" ||
      /\.(jpe?g|png)$/i.test(file.name);

    if (!accepted) {
      window.alert("Please choose a JPEG or PNG image.");
      return;
    }

    const generation = ++openGenerationRef.current;
    setOpening(true);
    setExportStatus(null);
    setShowingBefore(false);
    setBeforeLatched(false);
    holdingBeforeRef.current = false;
    setLastEdit(null);

    try {
      const decoded = await decodeImageFile(file);
      if (generation !== openGenerationRef.current) return;

      // Sync analysis is cheap on the working buffer — enable Ask pixle immediately.
      const quickAnalysis = analyzeImageSync(decoded.working, {
        width: decoded.originalWidth,
        height: decoded.originalHeight,
      });

      setSource(decoded.working);
      setSourceFile(file);
      setImageAnalysis(quickAnalysis);
      setFileName(file.name);
      setHistory(createEditHistory());
      setOpening(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      await yieldToUi();
      if (generation !== openGenerationRef.current) return;

      // Optional face enrichment; never clears the quick analysis on failure.
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
    } catch {
      if (generation === openGenerationRef.current) {
        window.alert("Could not open that image.");
        setOpening(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    }
  }

  function openImagePicker() {
    if (opening) return;
    fileInputRef.current?.click();
  }

  /** Commit a new present state and bind intensity/changes to that edit. */
  function applyCommittedEdit(next: EditParameters) {
    const before = presentRef.current;
    if (parametersEqual(before, next)) return;

    setLastEdit({
      before: { ...before },
      after: { ...next },
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
      present: { ...next },
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
    applyCommittedEdit({ ...look.parameters });
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
    if (!sourceFile || exporting || opening) return;

    setExporting(true);
    setExportStatus(null);

    try {
      const result = await exportEditedImage({
        sourceFile,
        params,
        originalFileName: fileName,
      });

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
      setExporting(false);
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

  const imageReady = Boolean(source) && !opening;
  const controlsDisabled = !source || opening || exporting;
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
            disabled={opening || exporting}
            onClick={openImagePicker}
          >
            {opening ? "Opening…" : "Open Image"}
          </button>
          {fileName ? (
            <span className="toolbar__filename" title={fileName}>
              {fileName}
            </span>
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
          <ImageViewport
            source={source}
            params={displayParams}
            onOpenImage={openImagePicker}
            comparing={showingBefore}
          />
          <AiEditorPanel
            params={params}
            imageAnalysis={imageAnalysis}
            disabled={controlsDisabled}
            onApply={applyCommittedEdit}
          />
        </div>
        <EditPanel
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
