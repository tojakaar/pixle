import {
  DEFAULT_EDIT_PARAMETERS,
  EDIT_SLIDER_CONFIG,
  cloneEditParameters,
  type EditParameters,
  type ScalarEditParameterKey,
} from "../engine";
import type { ParameterChange } from "../engine/editDiff";
import type { Look } from "../engine/looks";
import { ChangesPanel } from "./ChangesPanel";
import { IntensityControl } from "./IntensityControl";
import { LooksPanel } from "./LooksPanel";

interface EditPanelProps {
  params: EditParameters;
  disabled: boolean;
  onChange: (params: EditParameters) => void;
  /** History-aware reset; falls back to identity params when omitted. */
  onReset?: () => void;
  /** Most recent AI/look edit intensity (0–100), or null when none. */
  intensity: number | null;
  onIntensityChange: (value: number) => void;
  changes: ParameterChange[];
  builtinLooks: Look[];
  customLooks: Look[];
  canSaveLook: boolean;
  onSaveLook: () => void;
  onApplyLook: (look: Look) => void;
}

/**
 * Curated Adjust sliders — keep the panel light.
 * Grain, HSL, vignette, and detail arrive via Ask pixle / Looks.
 */
const SLIDER_ORDER: ScalarEditParameterKey[] = [
  "exposure",
  "contrast",
  "highlights",
  "shadows",
  "whites",
  "blacks",
  "fade",
  "temperature",
  "tint",
  "vibrance",
  "saturation",
];

function formatValue(key: ScalarEditParameterKey, value: number): string {
  if (key === "exposure") {
    return value.toFixed(2);
  }
  return String(Math.round(value));
}

export function EditPanel({
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
}: EditPanelProps) {
  function update(key: ScalarEditParameterKey, value: number) {
    onChange({ ...params, hsl: params.hsl, [key]: value });
  }

  return (
    <aside className="edit-panel" aria-label="Edit controls">
      {intensity !== null ? (
        <IntensityControl
          value={intensity}
          disabled={disabled}
          onChange={onIntensityChange}
        />
      ) : null}

      <ChangesPanel changes={changes} />

      <LooksPanel
        builtinLooks={builtinLooks}
        customLooks={customLooks}
        disabled={disabled}
        canSave={canSaveLook}
        onApply={onApplyLook}
        onSave={onSaveLook}
      />

      <header className="edit-panel__header">
        <h2 className="edit-panel__title">Adjust</h2>
        <button
          type="button"
          className="edit-panel__reset"
          disabled={disabled}
          onClick={() =>
            onReset
              ? onReset()
              : onChange(cloneEditParameters(DEFAULT_EDIT_PARAMETERS))
          }
        >
          Reset
        </button>
      </header>

      <div className="edit-panel__sliders">
        {SLIDER_ORDER.map((key) => {
          const config = EDIT_SLIDER_CONFIG[key];
          const value = params[key];

          return (
            <label key={key} className="slider">
              <span className="slider__meta">
                <span className="slider__label">{config.label}</span>
                <span className="slider__value">{formatValue(key, value)}</span>
              </span>
              <input
                type="range"
                className="slider__input"
                min={config.min}
                max={config.max}
                step={config.step}
                value={value}
                disabled={disabled}
                onChange={(e) => update(key, Number(e.currentTarget.value))}
              />
            </label>
          );
        })}
      </div>
    </aside>
  );
}
