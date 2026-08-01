import { useRef } from "react";

interface ImageToolbarProps {
  disabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  showingBefore: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onBeforePointerDown: () => void;
  onBeforePointerUp: (durationMs: number) => void;
  onToggleBefore: () => void;
}

/**
 * Compact controls beside the preview: Before/After, Undo, Redo, Reset.
 */
export function ImageToolbar({
  disabled,
  canUndo,
  canRedo,
  showingBefore,
  onUndo,
  onRedo,
  onReset,
  onBeforePointerDown,
  onBeforePointerUp,
  onToggleBefore,
}: ImageToolbarProps) {
  const pressStartedRef = useRef<number | null>(null);
  const captureIdRef = useRef<number | null>(null);

  function releaseBeforeCapture(target: HTMLButtonElement) {
    const pointerId = captureIdRef.current;
    captureIdRef.current = null;
    if (pointerId === null) return;
    try {
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
    } catch {
      // Capture may already be released by the browser.
    }
  }

  function finishBeforePress(target: HTMLButtonElement, durationMs: number) {
    pressStartedRef.current = null;
    releaseBeforeCapture(target);
    onBeforePointerUp(durationMs);
  }

  return (
    <div className="image-toolbar" role="toolbar" aria-label="Image edit controls">
      <button
        type="button"
        className={
          showingBefore
            ? "image-toolbar__btn image-toolbar__btn--active"
            : "image-toolbar__btn"
        }
        disabled={disabled}
        aria-pressed={showingBefore}
        title="Hold to peek at the original, or click to toggle"
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return;
          const target = e.currentTarget;
          pressStartedRef.current = performance.now();
          captureIdRef.current = e.pointerId;
          try {
            target.setPointerCapture(e.pointerId);
          } catch {
            captureIdRef.current = null;
          }
          onBeforePointerDown();
        }}
        onPointerUp={(e) => {
          if (e.button !== 0) return;
          const started = pressStartedRef.current;
          if (started === null) return;
          finishBeforePress(e.currentTarget, performance.now() - started);
        }}
        onPointerCancel={(e) => {
          if (pressStartedRef.current === null) return;
          finishBeforePress(e.currentTarget, 0);
        }}
        onLostPointerCapture={() => {
          // If capture is lost while a press is active (e.g. button became
          // disabled during a native dialog), still clear before/after state
          // so pointer events are not swallowed by a dead capture target.
          if (pressStartedRef.current === null) return;
          pressStartedRef.current = null;
          captureIdRef.current = null;
          onBeforePointerUp(0);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onToggleBefore();
          }
        }}
        onClick={(e) => {
          e.preventDefault();
        }}
      >
        Before / After
      </button>
      <button
        type="button"
        className="image-toolbar__btn"
        disabled={disabled || !canUndo}
        title="Undo (⌘Z / Ctrl+Z)"
        onClick={onUndo}
      >
        Undo
      </button>
      <button
        type="button"
        className="image-toolbar__btn"
        disabled={disabled || !canRedo}
        title="Redo (⌘⇧Z / Ctrl+Y)"
        onClick={onRedo}
      >
        Redo
      </button>
      <button
        type="button"
        className="image-toolbar__btn"
        disabled={disabled}
        title="Reset to the original unedited image"
        onClick={onReset}
      >
        Reset
      </button>
    </div>
  );
}
