interface UnsavedChangesModalProps {
  open: boolean;
  busy?: boolean;
  error?: string | null;
  onSave: () => void;
  onDontSave: () => void;
  onCancel: () => void;
}

/**
 * Document-style unsaved-changes dialog shown before replacing the open image.
 * Not a browser confirm() — stays in-app so Cancel leaves the editor untouched.
 */
export function UnsavedChangesModal({
  open,
  busy = false,
  error = null,
  onSave,
  onDontSave,
  onCancel,
}: UnsavedChangesModalProps) {
  if (!open) return null;

  return (
    <div
      className="unsaved-modal"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onCancel();
        }
      }}
    >
      <div
        className="unsaved-modal__dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-modal-title"
        aria-describedby="unsaved-modal-desc"
      >
        <h2 id="unsaved-modal-title" className="unsaved-modal__title">
          Save changes?
        </h2>
        <p id="unsaved-modal-desc" className="unsaved-modal__body">
          This image has unsaved edits. Save before opening another image?
        </p>
        {error ? (
          <p className="unsaved-modal__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="unsaved-modal__actions">
          <button
            type="button"
            className="unsaved-modal__button unsaved-modal__button--ghost"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="unsaved-modal__button unsaved-modal__button--ghost"
            disabled={busy}
            onClick={onDontSave}
          >
            Don&apos;t Save
          </button>
          <button
            type="button"
            className="unsaved-modal__button unsaved-modal__button--primary"
            disabled={busy}
            onClick={onSave}
          >
            {busy ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
