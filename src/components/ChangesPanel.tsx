import type { ParameterChange } from "../engine/editDiff";

interface ChangesPanelProps {
  changes: ParameterChange[];
}

/**
 * Compact list of parameter deltas from the most recent edit.
 * Final numbers only — no model reasoning.
 */
export function ChangesPanel({ changes }: ChangesPanelProps) {
  if (changes.length === 0) return null;

  return (
    <section className="changes-panel" aria-label="Changes">
      <h3 className="changes-panel__title">Changes</h3>
      <ul className="changes-panel__list">
        {changes.map((change) => (
          <li key={change.key} className="changes-panel__row">
            <span className="changes-panel__label">{change.label}</span>
            <span className="changes-panel__value">{change.formatted}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
