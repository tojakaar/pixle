import { useDeferredValue, useRef, useState } from "react";
import { AiEditorPanel } from "./components/AiEditorPanel";
import { EditPanel } from "./components/EditPanel";
import { ImageViewport } from "./components/ImageViewport";
import {
  DEFAULT_EDIT_PARAMETERS,
  analyzeImage,
  analyzeImageSync,
  decodeImageFile,
  yieldToUi,
  type EditParameters,
  type ImageAnalysis,
} from "./engine";
import "./App.css";

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openGenerationRef = useRef(0);
  const [source, setSource] = useState<ImageData | null>(null);
  const [imageAnalysis, setImageAnalysis] = useState<ImageAnalysis | null>(
    null,
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [params, setParams] = useState<EditParameters>({
    ...DEFAULT_EDIT_PARAMETERS,
  });
  const previewParams = useDeferredValue(params);

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

    try {
      const decoded = await decodeImageFile(file);
      if (generation !== openGenerationRef.current) return;

      // Sync analysis is cheap on the working buffer — enable Ask pixle immediately.
      const quickAnalysis = analyzeImageSync(decoded.working, {
        width: decoded.originalWidth,
        height: decoded.originalHeight,
      });

      setSource(decoded.working);
      setImageAnalysis(quickAnalysis);
      setFileName(file.name);
      setParams({ ...DEFAULT_EDIT_PARAMETERS });
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
            disabled={opening}
            onClick={openImagePicker}
          >
            {opening ? "Opening…" : "Open Image"}
          </button>
          {fileName ? (
            <span className="toolbar__filename" title={fileName}>
              {fileName}
            </span>
          ) : null}
        </div>
      </header>

      <div className="workspace">
        <div className="workspace__main">
          <ImageViewport
            source={source}
            params={previewParams}
            onOpenImage={openImagePicker}
          />
          <AiEditorPanel
            params={params}
            imageAnalysis={imageAnalysis}
            disabled={!source || opening}
            onApply={setParams}
          />
        </div>
        <EditPanel
          params={params}
          disabled={!source || opening}
          onChange={setParams}
        />
      </div>
    </div>
  );
}

export default App;
