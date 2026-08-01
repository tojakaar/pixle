import { groupParameterChanges } from "../../engine/changeGroups";
import type { ParameterChange } from "../../engine/editDiff";

interface ChangesTabProps {
  changes: ParameterChange[];
}

/**
 * Vertical, grouped deltas from the most recent AI/look edit.
 * Final numbers only — no model reasoning.
 */
export function ChangesTab({ changes }: ChangesTabProps) {
  if (changes.length === 0) {
    return (
      <div className="sidebar-tab" aria-label="Changes">
        <p className="changes-tab__empty">
          No changes yet. Apply an AI edit or a Look to see what moved.
        </p>
      </div>
    );
  }

  const groups = groupParameterChanges(changes);

  return (
    <div className="sidebar-tab changes-tab" aria-label="Changes">
      {groups.map((group) => (
        <section key={group.id} className="changes-tab__group">
          <h3 className="changes-tab__group-title">{group.title}</h3>
          <ul className="changes-tab__list">
            {group.changes.map((change) => (
              <li key={change.key} className="changes-tab__row">
                <span className="changes-tab__label">{change.label}</span>
                <span className="changes-tab__value">{change.formatted}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
