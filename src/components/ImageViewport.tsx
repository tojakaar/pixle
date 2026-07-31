import { useEffect, useRef } from "react";
import {
  applyEdits,
  isIdentityEdit,
  type EditParameters,
} from "../engine";

interface ImageViewportProps {
  /** Original, unmodified pixel buffer. Never written to. */
  source: ImageData | null;
  params: EditParameters;
  /** Opens the JPEG/PNG file picker from the empty state. */
  onOpenImage: () => void;
  /** True while the user is peeking at the untouched original. */
  comparing?: boolean;
}

/**
 * Centres the photo in the available space and draws a non-destructive preview
 * produced by the rendering engine.
 */
export function ImageViewport({
  source,
  params,
  onOpenImage,
  comparing = false,
}: ImageViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = source.width;
    canvas.height = source.height;

    const frame = isIdentityEdit(params)
      ? source
      : applyEdits(source, params);

    ctx.putImageData(frame, 0, 0);
  }, [source, params]);

  if (!source) {
    return (
      <div className="viewport viewport--empty">
        <div className="viewport__empty-card">
          <p className="viewport__hint">Open a JPEG or PNG to begin editing</p>
          <button
            type="button"
            className="viewport__open"
            onClick={onOpenImage}
          >
            Open Image
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={comparing ? "viewport viewport--comparing" : "viewport"}>
      <canvas
        ref={canvasRef}
        className="viewport__canvas"
        aria-label={comparing ? "Original photo" : "Edited photo preview"}
      />
    </div>
  );
}
