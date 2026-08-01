import type { Look } from "../../engine/looks";

interface LooksTabProps {
  builtinLooks: Look[];
  customLooks: Look[];
  disabled: boolean;
  canSave: boolean;
  onApply: (look: Look) => void;
  onSave: () => void;
}

export function LooksTab({
  builtinLooks,
  customLooks,
  disabled,
  canSave,
  onApply,
  onSave,
}: LooksTabProps) {
  return (
    <div className="sidebar-tab" aria-label="Looks">
      <header className="sidebar-tab__header">
        <h2 className="sidebar-tab__title">Looks</h2>
        <button
          type="button"
          className="sidebar-tab__action"
          disabled={!canSave || disabled}
          onClick={onSave}
        >
          Save Look
        </button>
      </header>

      <div className="looks-panel__group">
        <p className="looks-panel__group-label">Built-in</p>
        <ul className="looks-panel__list">
          {builtinLooks.map((look) => (
            <li key={look.id}>
              <button
                type="button"
                className="looks-panel__look"
                disabled={disabled}
                onClick={() => onApply(look)}
              >
                {look.name}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {customLooks.length > 0 ? (
        <div className="looks-panel__group">
          <p className="looks-panel__group-label">Saved</p>
          <ul className="looks-panel__list">
            {customLooks.map((look) => (
              <li key={look.id}>
                <button
                  type="button"
                  className="looks-panel__look"
                  disabled={disabled}
                  onClick={() => onApply(look)}
                >
                  {look.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="looks-panel__empty">No saved looks yet</p>
      )}
    </div>
  );
}
