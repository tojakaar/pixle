import { useState } from "react";
import {
  DEFAULT_EDIT_PARAMETERS,
  EDIT_SLIDER_CONFIG,
  cloneEditParameters,
  type EditParameters,
  type ScalarEditParameterKey,
} from "../../engine";
import { ParamSlider } from "../ParamSlider";

interface EditTabProps {
  params: EditParameters;
  disabled: boolean;
  onChange: (params: EditParameters) => void;
  onReset?: () => void;
}

const TONE_KEYS: ScalarEditParameterKey[] = [
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

const DETAIL_KEYS: ScalarEditParameterKey[] = [
  "clarity",
  "sharpening",
  "luminanceNoiseReduction",
  "chromaNoiseReduction",
];

export function EditTab({
  params,
  disabled,
  onChange,
  onReset,
}: EditTabProps) {
  const [detailOpen, setDetailOpen] = useState(false);

  function update(key: ScalarEditParameterKey, value: number) {
    onChange({ ...params, hsl: params.hsl, [key]: value });
  }

  return (
    <div className="sidebar-tab" aria-label="Edit">
      <header className="sidebar-tab__header">
        <h2 className="sidebar-tab__title">Tone & colour</h2>
        <button
          type="button"
          className="sidebar-tab__reset"
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

      <div className="sidebar-tab__sliders">
        {TONE_KEYS.map((key) => {
          const config = EDIT_SLIDER_CONFIG[key];
          return (
            <ParamSlider
              key={key}
              id={`edit-${key}`}
              label={config.label}
              value={params[key]}
              min={config.min}
              max={config.max}
              step={config.step}
              disabled={disabled}
              onChange={(value) => update(key, value)}
            />
          );
        })}
      </div>

      <details
        className="sidebar-disclosure"
        open={detailOpen}
        onToggle={(e) => setDetailOpen(e.currentTarget.open)}
      >
        <summary className="sidebar-disclosure__summary">Detail</summary>
        <div className="sidebar-tab__sliders sidebar-disclosure__body">
          {DETAIL_KEYS.map((key) => {
            const config = EDIT_SLIDER_CONFIG[key];
            return (
              <ParamSlider
                key={key}
                id={`edit-${key}`}
                label={config.label}
                value={params[key]}
                min={config.min}
                max={config.max}
                step={config.step}
                disabled={disabled}
                onChange={(value) => update(key, value)}
              />
            );
          })}
        </div>
      </details>
    </div>
  );
}
