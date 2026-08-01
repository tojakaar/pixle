import { useEffect, useRef, useState } from "react";
import type { EditParameters } from "../engine";
import type { ParameterChange } from "../engine/editDiff";
import type { Look } from "../engine/looks";
import { IntensityControl } from "./IntensityControl";
import { ChangesTab } from "./sidebar/ChangesTab";
import { ColourTab } from "./sidebar/ColourTab";
import { EditTab } from "./sidebar/EditTab";
import { EffectsTab } from "./sidebar/EffectsTab";
import { LooksTab } from "./sidebar/LooksTab";

export type SidebarTabId = "edit" | "colour" | "effects" | "looks" | "changes";

interface RightSidebarProps {
  params: EditParameters;
  disabled: boolean;
  onChange: (params: EditParameters) => void;
  onReset?: () => void;
  intensity: number | null;
  onIntensityChange: (value: number) => void;
  changes: ParameterChange[];
  builtinLooks: Look[];
  customLooks: Look[];
  canSaveLook: boolean;
  onSaveLook: () => void;
  onApplyLook: (look: Look) => void;
}

const TABS: { id: SidebarTabId; label: string }[] = [
  { id: "edit", label: "Edit" },
  { id: "colour", label: "Colour" },
  { id: "effects", label: "Effects" },
  { id: "looks", label: "Looks" },
  { id: "changes", label: "Changes" },
];

function changesSignature(changes: ParameterChange[]): string {
  return changes.map((c) => `${c.key}:${c.formatted}`).join("|");
}

/**
 * Tabbed right sidebar. All tabs read/write the same EditParameters object —
 * switching tabs never mutates image state.
 */
export function RightSidebar({
  params,
  disabled,
  onChange,
  onReset,
  intensity,
  onIntensityChange,
  changes,
  builtinLooks,
  customLooks,
  canSaveLook,
  onSaveLook,
  onApplyLook,
}: RightSidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTabId>("edit");
  const [changesBadge, setChangesBadge] = useState(false);
  const seenSignatureRef = useRef("");

  useEffect(() => {
    const signature = changesSignature(changes);
    if (!signature) {
      setChangesBadge(false);
      seenSignatureRef.current = "";
      return;
    }
    if (signature === seenSignatureRef.current) return;
    if (activeTab === "changes") {
      seenSignatureRef.current = signature;
      setChangesBadge(false);
      return;
    }
    // New AI/look deltas arrived while on another tab — nudge, don't auto-switch.
    setChangesBadge(true);
  }, [changes, activeTab]);

  function selectTab(id: SidebarTabId) {
    setActiveTab(id);
    if (id === "changes") {
      seenSignatureRef.current = changesSignature(changes);
      setChangesBadge(false);
    }
  }

  return (
    <aside className="right-sidebar" aria-label="Edit controls">
      {intensity !== null ? (
        <div className="right-sidebar__intensity">
          <IntensityControl
            value={intensity}
            disabled={disabled}
            onChange={onIntensityChange}
          />
        </div>
      ) : null}

      <div className="sidebar-tabs" role="tablist" aria-label="Sidebar sections">
        {TABS.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={
                selected
                  ? "sidebar-tabs__tab sidebar-tabs__tab--active"
                  : "sidebar-tabs__tab"
              }
              onClick={() => selectTab(tab.id)}
            >
              <span>{tab.label}</span>
              {tab.id === "changes" && changesBadge ? (
                <span className="sidebar-tabs__badge" aria-label="New changes" />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="right-sidebar__body" role="tabpanel">
        {activeTab === "edit" ? (
          <EditTab
            params={params}
            disabled={disabled}
            onChange={onChange}
            onReset={onReset}
          />
        ) : null}
        {activeTab === "colour" ? (
          <ColourTab
            params={params}
            disabled={disabled}
            onChange={onChange}
          />
        ) : null}
        {activeTab === "effects" ? (
          <EffectsTab
            params={params}
            disabled={disabled}
            onChange={onChange}
          />
        ) : null}
        {activeTab === "looks" ? (
          <LooksTab
            builtinLooks={builtinLooks}
            customLooks={customLooks}
            disabled={disabled}
            canSave={canSaveLook}
            onApply={onApplyLook}
            onSave={onSaveLook}
          />
        ) : null}
        {activeTab === "changes" ? <ChangesTab changes={changes} /> : null}
      </div>
    </aside>
  );
}
