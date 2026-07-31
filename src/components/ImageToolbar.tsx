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
          e.currentTarget.setPointerCapture(e.pointerId);
          (e.currentTarget as HTMLButtonElement).dataset.pressStarted =
            String(performance.now());
          onBeforePointerDown();
        }}
        onPointerUp={(e) => {
          if (e.button !== 0) return;
          const started = Number(
            (e.currentTarget as HTMLButtonElement).dataset.pressStarted ?? "0",
          );
          const durationMs = performance.now() - started;
          onBeforePointerUp(durationMs);
        }}
        onPointerCancel={() => onBeforePointerUp(0)}
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
