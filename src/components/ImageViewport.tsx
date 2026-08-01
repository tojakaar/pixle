import { useEffect, useRef } from "react";
import {
  applyEdits,
  isIdentityEdit,
  type EditParameters,
} from "../engine";
import { openLog } from "../engine/openLog";
import { perfTime } from "../engine/perf";

interface ImageViewportProps {
  /**
   * Prepared working buffer for edits. Held by the parent; not cloned here.
   * Null while the async preview is still preparing.
   */
  source: ImageData | null;
  /** Object-URL of the original File for an immediate placeholder preview. */
  placeholderUrl: string | null;
  /** Monotonic open request id — invalidates all pending paints when bumped. */
  openRequestId: number;
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
 * Slider updates are coalesced to animation frames; stale jobs are dropped
 * when `openRequestId` or source changes.
 */
export function ImageViewport({
  source,
  placeholderUrl,
  openRequestId,
  preparing = false,
  params,
  onOpenImage,
  comparing = false,
}: ImageViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<ImageData | null>(source);
  const paramsRef = useRef(params);
  const openIdRef = useRef(openRequestId);
  const renderGenRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  sourceRef.current = source;
  paramsRef.current = params;
  openIdRef.current = openRequestId;

  // Opening a new image must cancel any in-flight paint immediately.
  useEffect(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    renderGenRef.current += 1;
    openLog(openRequestId, "viewport invalidate renders");
  }, [openRequestId]);

  useEffect(() => {
    // Never paint an editable canvas while a newer open is still preparing,
    // or when there is no working buffer.
    if (!source || preparing) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      renderGenRef.current += 1;
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const boundOpenId = openRequestId;
    const gen = ++renderGenRef.current;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (gen !== renderGenRef.current) {
        openLog(boundOpenId, "skip stale RAF (gen)");
        return;
      }
      if (openIdRef.current !== boundOpenId) {
        openLog(boundOpenId, "skip stale RAF (openId)");
        return;
      }

      const current = sourceRef.current;
      const currentParams = paramsRef.current;
      if (!current) return;

      try {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        if (
          canvas.width !== current.width ||
          canvas.height !== current.height
        ) {
          canvas.width = current.width;
          canvas.height = current.height;
        }

        const end = perfTime("viewport applyEdits+putImageData");
        const frame = isIdentityEdit(currentParams)
          ? current
          : applyEdits(current, currentParams);

        if (gen !== renderGenRef.current || openIdRef.current !== boundOpenId) {
          openLog(boundOpenId, "skip stale putImageData");
          end();
          return;
        }

        ctx.putImageData(frame, 0, 0);
        openLog(boundOpenId, "canvas swap", {
          w: current.width,
          h: current.height,
        });
        end();
      } catch (error) {
        openLog(boundOpenId, "canvas paint failed", error);
      }
    });

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      renderGenRef.current += 1;
    };
  }, [source, params, openRequestId, preparing]);

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

  // Prefer the live placeholder whenever prepare is running or no working
  // buffer exists — never flash a blank/black canvas during transitions.
  const showPlaceholder =
    Boolean(placeholderUrl) && (preparing || !source);

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
          key={placeholderUrl ?? "placeholder"}
          className="viewport__placeholder"
          src={placeholderUrl!}
          alt="Selected photo"
          draggable={false}
        />
      ) : source ? (
        <canvas
          ref={canvasRef}
          className="viewport__canvas"
          aria-label={comparing ? "Original photo" : "Edited photo preview"}
        />
      ) : null}
      {preparing ? (
        <div className="viewport__preparing" aria-live="polite">
          Preparing editor…
        </div>
      ) : null}
    </div>
  );
}
