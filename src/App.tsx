import { useDeferredValue, useEffect, useRef, useState } from "react";
import { AiEditorPanel } from "./components/AiEditorPanel";
import { EditPanel } from "./components/EditPanel";
import { ImageToolbar } from "./components/ImageToolbar";
import { ImageViewport } from "./components/ImageViewport";
import { exportEditedImage } from "./exportFile";
import {
  DEFAULT_EDIT_PARAMETERS,
  analyzeImage,
  analyzeImageSync,
  canRedo,
  canUndo,
  commitEdit,
  createEditHistory,
  decodeImageFile,
  parametersEqual,
  redoEdit,
  resetEdit,
  undoEdit,
  yieldToUi,
  type EditHistoryState,
  type EditParameters,
  type ImageAnalysis,
} from "./engine";
import "./App.css";

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openGenerationRef = useRef(0);
  const holdingBeforeRef = useRef(false);
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

  const params = history.present;
  const previewParams = useDeferredValue(params);
  const displayParams = showingBefore
    ? DEFAULT_EDIT_PARAMETERS
    : previewParams;

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

  function applyParams(next: EditParameters) {
    setHistory((prev) => {
      if (parametersEqual(prev.present, next)) return prev;
      return commitEdit(prev, next);
    });
  }

  /** Slider drags update the present state without creating history steps. */
  function setParamsLive(next: EditParameters) {
    setHistory((prev) => ({
      ...prev,
      present: { ...next },
      // Live slider changes discard redo — present has diverged.
      future: [],
    }));
  }

  function handleUndo() {
    setHistory((prev) => undoEdit(prev));
  }

  function handleRedo() {
    setHistory((prev) => redoEdit(prev));
  }

  function handleReset() {
    setHistory((prev) => resetEdit(prev));
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
            disabled={!source || opening || exporting}
            onApply={applyParams}
          />
        </div>
        <EditPanel
          params={params}
          disabled={!source || opening || exporting}
          onChange={setParamsLive}
          onReset={handleReset}
        />
      </div>
    </div>
  );
}

export default App;
