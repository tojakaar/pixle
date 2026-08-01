import { useEffect, useRef } from "react";
import {
  applyEdits,
  isIdentityEdit,
  type EditParameters,
} from "../engine";
import { perfTime } from "../engine/perf";

interface ImageViewportProps {
  /**
   * Prepared working buffer for edits. Held by the parent; not cloned here.
   * Null while the async preview is still preparing.
   */
  source: ImageData | null;
  /** Object-URL of the original File for an immediate placeholder preview. */
  placeholderUrl: string | null;
  /** True while decode/prepare is still running. */
  preparing?: boolean;
  params: EditParameters;
  /** Opens the JPEG/PNG file picker from the empty state. */
  onOpenImage: () => void;
  /** True while the user is peeking at the untouched original. */
  comparing?: boolean;
}

/**
 * Centres the photo and draws a non-destructive preview.
 *
 * Shows an immediate `<img>` placeholder from the File object URL, then
 * swaps to the editable canvas once the working buffer is ready.
 * Slider updates are coalesced to animation frames; stale jobs are dropped.
 */
export function ImageViewport({
  source,
  placeholderUrl,
  preparing = false,
  params,
  onOpenImage,
  comparing = false,
}: ImageViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<ImageData | null>(source);
  const paramsRef = useRef(params);
  const renderGenRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const outputRef = useRef<ImageData | null>(null);

  sourceRef.current = source;
  paramsRef.current = params;

  useEffect(() => {
    const canvas = canvasRef.current;
    const src = sourceRef.current;
    if (!canvas || !src) return;

    const schedule = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      const gen = ++renderGenRef.current;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (gen !== renderGenRef.current) return;

        const current = sourceRef.current;
        const currentParams = paramsRef.current;
        if (!current) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        if (canvas.width !== current.width || canvas.height !== current.height) {
          canvas.width = current.width;
          canvas.height = current.height;
          outputRef.current = null;
        }

        const end = perfTime("viewport applyEdits+putImageData");
        const frame = isIdentityEdit(currentParams)
          ? current
          : applyEdits(current, currentParams);

        // Reuse output buffer reference only for bookkeeping; putImageData needs ImageData.
        outputRef.current = frame;
        if (gen !== renderGenRef.current) return;
        ctx.putImageData(frame, 0, 0);
        end();
      });
    };

    schedule();

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      // Invalidate in-flight frame so it cannot paint after unmount / new source.
      renderGenRef.current += 1;
    };
  }, [source, params]);

  if (!source && !placeholderUrl) {
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

  const showPlaceholder = Boolean(placeholderUrl) && !source;

  return (
    <div
      className={
        comparing
          ? "viewport viewport--comparing"
          : preparing
            ? "viewport viewport--preparing"
            : "viewport"
      }
    >
      {showPlaceholder ? (
        <img
          className="viewport__placeholder"
          src={placeholderUrl!}
          alt="Selected photo"
          draggable={false}
        />
      ) : (
        <canvas
          ref={canvasRef}
          className="viewport__canvas"
          aria-label={comparing ? "Original photo" : "Edited photo preview"}
        />
      )}
      {preparing ? (
        <div className="viewport__preparing" aria-live="polite">
          Preparing editor…
        </div>
      ) : null}
    </div>
  );
}
