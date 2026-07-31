import {
  DEFAULT_EDIT_PARAMETERS,
  EDIT_SLIDER_CONFIG,
  type EditParameterKey,
  type EditParameters,
} from "../engine";

interface EditPanelProps {
  params: EditParameters;
  disabled: boolean;
  onChange: (params: EditParameters) => void;
}

const SLIDER_ORDER: EditParameterKey[] = [
  "exposure",
  "contrast",
  "highlights",
  "shadows",
  "temperature",
  "tint",
  "saturation",
];

function formatValue(key: EditParameterKey, value: number): string {
  if (key === "exposure") {
    return value.toFixed(2);
  }
  return String(Math.round(value));
}

export function EditPanel({ params, disabled, onChange }: EditPanelProps) {
  function update(key: EditParameterKey, value: number) {
    onChange({ ...params, [key]: value });
  }

  return (
    <aside className="edit-panel" aria-label="Edit controls">
      <header className="edit-panel__header">
        <h2 className="edit-panel__title">Adjust</h2>
        <button
          type="button"
          className="edit-panel__reset"
          disabled={disabled}
          onClick={() => onChange({ ...DEFAULT_EDIT_PARAMETERS })}
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
