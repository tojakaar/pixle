import { useDeferredValue, useRef, useState } from "react";
import { EditPanel } from "./components/EditPanel";
import { ImageViewport } from "./components/ImageViewport";
import {
  DEFAULT_EDIT_PARAMETERS,
  type EditParameters,
} from "./engine";
import "./App.css";

async function decodeImageFile(file: File): Promise<ImageData> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Could not create canvas context");
  }
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return imageData;
}

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<ImageData | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [params, setParams] = useState<EditParameters>({
    ...DEFAULT_EDIT_PARAMETERS,
  });
  const previewParams = useDeferredValue(params);

  async function handleFileChange(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;

    const accepted =
      file.type === "image/jpeg" ||
      file.type === "image/png" ||
      /\.(jpe?g|png)$/i.test(file.name);

    if (!accepted) {
      window.alert("Please choose a JPEG or PNG image.");
      return;
    }

    try {
      const imageData = await decodeImageFile(file);
      setSource(imageData);
      setFileName(file.name);
      setParams({ ...DEFAULT_EDIT_PARAMETERS });
    } catch {
      window.alert("Could not open that image.");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
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
            onClick={() => fileInputRef.current?.click()}
          >
            Open image
          </button>
          {fileName ? (
            <span className="toolbar__filename" title={fileName}>
              {fileName}
            </span>
          ) : null}
        </div>
      </header>

      <div className="workspace">
        <ImageViewport source={source} params={previewParams} />
        <EditPanel
          params={params}
          disabled={!source}
          onChange={setParams}
        />
      </div>
    </div>
  );
}

export default App;
