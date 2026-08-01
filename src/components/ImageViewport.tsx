import { useEffect, useRef, useState } from "react";
import {
  applyEdits,
  isIdentityEdit,
  paintMaskDebugOverlay,
  type ApplyEditsOptions,
  type EditParameters,
  type MaskCollection,
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
  /** Optional semantic mask compositing (same engine as export). */
  applyOptions?: ApplyEditsOptions;
  /**
   * When non-null, paint a ~40% coloured mask overlay (debug only).
   * Never used for export. Overlay canvas is pointer-events: none.
   */
  debugMasks?: MaskCollection | null;
  /** Opens the JPEG/PNG file picker from the empty state. */
  onOpenImage: () => void;
  /** True while the user is peeking at the untouched original. */
  comparing?: boolean;
  /** Fired once the editable canvas has painted for the current open. */
  onCanvasReady?: (openRequestId: number) => void;
  /**
   * Fired after the placeholder has faded out and is no longer displayed.
   * Parent should only revoke the object URL after this.
   */
  onPlaceholderRetired?: (openRequestId: number) => void;
}

const PLACEHOLDER_FADE_MS = 180;

/**
 * Centres the photo and draws a non-destructive preview.
 *
 * Shows an immediate `<img>` placeholder from the File object URL, keeps it
 * visible over the canvas until the first paint, then fades it out so the
 * handoff never flashes an empty/black viewport.
 */
export function ImageViewport({
  source,
  placeholderUrl,
  openRequestId,
  preparing = false,
  params,
  applyOptions,
  debugMasks = null,
  onOpenImage,
  comparing = false,
  onCanvasReady,
  onPlaceholderRetired,
}: ImageViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<ImageData | null>(source);
  const paramsRef = useRef(params);
  const applyOptionsRef = useRef(applyOptions);
  const debugMasksRef = useRef(debugMasks);
  const openIdRef = useRef(openRequestId);
  const renderGenRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  /** Guards first-paint handoff so slider re-paints do not re-fade. */
  const handedOffOpenIdRef = useRef<number | null>(null);
  const onCanvasReadyRef = useRef(onCanvasReady);
  const onPlaceholderRetiredRef = useRef(onPlaceholderRetired);

  const [placeholderLayer, setPlaceholderLayer] = useState<string | null>(
    placeholderUrl,
  );
  const [placeholderFading, setPlaceholderFading] = useState(false);
  /** Open id for which putImageData has completed (drives spinner UI). */
  const [paintedOpenId, setPaintedOpenId] = useState<number | null>(null);

  sourceRef.current = source;
  paramsRef.current = params;
  applyOptionsRef.current = applyOptions;
  debugMasksRef.current = debugMasks;
  openIdRef.current = openRequestId;
  onCanvasReadyRef.current = onCanvasReady;
  onPlaceholderRetiredRef.current = onPlaceholderRetired;

  // New open invalidates the previous handoff. Do NOT reset paintedOpenId when
  // the parent clears placeholderUrl after a successful fade — that used to
  // bring the spinner back forever on an already-ready canvas.
  useEffect(() => {
    handedOffOpenIdRef.current = null;
    setPaintedOpenId(null);
    setPlaceholderFading(false);
    if (fadeTimerRef.current !== null) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    setPlaceholderLayer(placeholderUrl);
  }, [openRequestId]);

  // Keep the overlay in sync when a newer placeholder URL arrives for the
  // same open id (should be rare), without clearing the paint gate.
  useEffect(() => {
    if (!placeholderUrl) return;
    setPlaceholderLayer(placeholderUrl);
  }, [placeholderUrl]);

  useEffect(() => {
    return () => {
      if (fadeTimerRef.current !== null) {
        window.clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, []);

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
    // Paint as soon as a working buffer exists — even while the placeholder
    // still covers the canvas. Blocking on `preparing` caused a black flash
    // because the img unmounted before putImageData ran.
    if (!source) {
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
      const currentApplyOptions = applyOptionsRef.current;
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
        const frame =
          !currentApplyOptions?.mask && isIdentityEdit(currentParams)
            ? current
            : applyEdits(current, currentParams, currentApplyOptions);

        if (gen !== renderGenRef.current || openIdRef.current !== boundOpenId) {
          openLog(boundOpenId, "skip stale putImageData");
          end();
          return;
        }

        ctx.putImageData(frame, 0, 0);

        const overlay = overlayRef.current;
        const masks = debugMasksRef.current;
        if (overlay) {
          if (overlay.width !== current.width || overlay.height !== current.height) {
            overlay.width = current.width;
            overlay.height = current.height;
          }
          const octx = overlay.getContext("2d");
          if (octx) {
            octx.clearRect(0, 0, overlay.width, overlay.height);
            if (masks && masks.masks.length > 0) {
              paintMaskDebugOverlay(
                octx,
                current.width,
                current.height,
                masks.masks,
              );
            }
          }
        }

        openLog(boundOpenId, "canvas swap", {
          w: current.width,
          h: current.height,
        });
        end();

        setPaintedOpenId(boundOpenId);

        // First successful paint for this open → notify parent, fade placeholder.
        if (handedOffOpenIdRef.current !== boundOpenId) {
          handedOffOpenIdRef.current = boundOpenId;
          openLog(boundOpenId, "canvas ready; begin placeholder fade");
          onCanvasReadyRef.current?.(boundOpenId);
          setPlaceholderFading(true);
          if (fadeTimerRef.current !== null) {
            window.clearTimeout(fadeTimerRef.current);
          }
          fadeTimerRef.current = window.setTimeout(() => {
            fadeTimerRef.current = null;
            if (openIdRef.current !== boundOpenId) return;
            setPlaceholderLayer(null);
            setPlaceholderFading(false);
            openLog(boundOpenId, "placeholder retired after fade");
            onPlaceholderRetiredRef.current?.(boundOpenId);
          }, PLACEHOLDER_FADE_MS);
        }
      } catch (error) {
        openLog(boundOpenId, "canvas paint failed", error);
        // Still release the prepare gate so a paint failure cannot lock the UI.
        if (handedOffOpenIdRef.current !== boundOpenId) {
          handedOffOpenIdRef.current = boundOpenId;
          setPaintedOpenId(boundOpenId);
          onCanvasReadyRef.current?.(boundOpenId);
          setPlaceholderFading(true);
          if (fadeTimerRef.current !== null) {
            window.clearTimeout(fadeTimerRef.current);
          }
          fadeTimerRef.current = window.setTimeout(() => {
            fadeTimerRef.current = null;
            if (openIdRef.current !== boundOpenId) return;
            setPlaceholderLayer(null);
            setPlaceholderFading(false);
            onPlaceholderRetiredRef.current?.(boundOpenId);
          }, PLACEHOLDER_FADE_MS);
        }
      }
    });

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      renderGenRef.current += 1;
    };
  }, [source, params, applyOptions, debugMasks, openRequestId]);

  // Refresh overlay when debug masks arrive without a full re-edit.
  useEffect(() => {
    const overlay = overlayRef.current;
    const current = sourceRef.current;
    if (!overlay || !current) return;
    if (overlay.width !== current.width || overlay.height !== current.height) {
      overlay.width = current.width;
      overlay.height = current.height;
    }
    const octx = overlay.getContext("2d");
    if (!octx) return;
    octx.clearRect(0, 0, overlay.width, overlay.height);
    if (debugMasks && debugMasks.masks.length > 0) {
      paintMaskDebugOverlay(
        octx,
        current.width,
        current.height,
        debugMasks.masks,
      );
    }
  }, [debugMasks, source, openRequestId]);

  if (!source && !placeholderUrl && !placeholderLayer) {
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

  const waitingForCanvas =
    preparing || (Boolean(source) && paintedOpenId !== openRequestId);
  const showPlaceholder = Boolean(placeholderLayer);

  return (
    <div
      className={
        comparing
          ? "viewport viewport--comparing"
          : waitingForCanvas
            ? "viewport viewport--preparing"
            : "viewport"
      }
    >
      <div className="viewport__stage">
        {/* Canvas mounts under the placeholder as soon as the buffer exists. */}
        {source ? (
          <>
            <canvas
              ref={canvasRef}
              className={
                showPlaceholder && !placeholderFading
                  ? "viewport__canvas viewport__canvas--pending"
                  : "viewport__canvas"
              }
              aria-label={comparing ? "Original photo" : "Edited photo preview"}
            />
            <canvas
              ref={overlayRef}
              className="viewport__mask-overlay"
              aria-hidden="true"
            />
          </>
        ) : null}
        {showPlaceholder ? (
          <img
            key={placeholderLayer ?? "placeholder"}
            className={
              placeholderFading
                ? "viewport__placeholder viewport__placeholder--fade-out"
                : "viewport__placeholder"
            }
            src={placeholderLayer!}
            alt="Selected photo"
            draggable={false}
          />
        ) : null}
      </div>
      {waitingForCanvas ? (
        <div className="viewport__preparing" aria-live="polite">
          <span className="viewport__spinner" aria-hidden="true" />
          Preparing editor…
        </div>
      ) : null}
    </div>
  );
}
