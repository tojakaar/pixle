import type { Look } from "../engine/looks";

interface LooksPanelProps {
  builtinLooks: Look[];
  customLooks: Look[];
  disabled: boolean;
  canSave: boolean;
  onApply: (look: Look) => void;
  onSave: () => void;
}

export function LooksPanel({
  builtinLooks,
  customLooks,
  disabled,
  canSave,
  onApply,
  onSave,
}: LooksPanelProps) {
  return (
    <section className="looks-panel" aria-label="Looks">
      <header className="looks-panel__header">
        <h3 className="looks-panel__title">Looks</h3>
        <button
          type="button"
          className="looks-panel__save"
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
    </section>
  );
}
