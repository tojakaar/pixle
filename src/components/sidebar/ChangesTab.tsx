import type { ActionHistoryGroup } from "../../engine/editSession";

interface ChangesTabProps {
  groups: ActionHistoryGroup[];
  activeActionId: string | null;
  onSelectAction: (actionId: string) => void;
}

/**
 * Visual EditSession history grouped by semantic target.
 * Click an action to focus follow-ups ("a little more") on that edit.
 */
export function ChangesTab({
  groups,
  activeActionId,
  onSelectAction,
}: ChangesTabProps) {
  if (groups.length === 0) {
    return (
      <div className="sidebar-tab" aria-label="Changes">
        <p className="changes-tab__empty">
          No edits yet. Ask pixle to adjust the photo — follow-ups like “a
          little more” will refine the selected action.
        </p>
      </div>
    );
  }

  return (
    <div className="sidebar-tab changes-tab" aria-label="Changes">
      {groups.map((group) => (
        <section
          key={group.target ?? "global"}
          className="changes-tab__group"
        >
          <h3 className="changes-tab__group-title">{group.targetLabel}</h3>
          <ul className="changes-tab__actions">
            {group.actions.map((action) => {
              const selected = action.id === activeActionId;
              return (
                <li key={action.id}>
                  <button
                    type="button"
                    className={
                      selected
                        ? "changes-tab__action changes-tab__action--active"
                        : "changes-tab__action"
                    }
                    onClick={() => onSelectAction(action.id)}
                    aria-pressed={selected}
                  >
                    <span className="changes-tab__action-summary">
                      {action.summary}
                    </span>
                    {action.changes.length === 0 ? (
                      <span className="changes-tab__action-empty">
                        No parameter delta
                      </span>
                    ) : (
                      <ul className="changes-tab__list">
                        {action.changes.map((change) => (
                          <li key={change.key} className="changes-tab__row">
                            <span className="changes-tab__label">
                              {change.label}
                            </span>
                            <span className="changes-tab__value">
                              {change.formatted}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
