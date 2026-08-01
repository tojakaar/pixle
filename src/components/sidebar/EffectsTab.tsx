import {
  EDIT_SLIDER_CONFIG,
  type EditParameters,
  type ScalarEditParameterKey,
} from "../../engine";
import { ParamSlider } from "../ParamSlider";

interface EffectsTabProps {
  params: EditParameters;
  disabled: boolean;
  onChange: (params: EditParameters) => void;
}

const GRAIN_KEYS: ScalarEditParameterKey[] = [
  "grainAmount",
  "grainSize",
  "grainRoughness",
  "grainColor",
];

const VIGNETTE_KEYS: ScalarEditParameterKey[] = [
  "vignetteAmount",
  "vignetteMidpoint",
  "vignetteFeather",
];

const SHORT_LABELS: Partial<Record<ScalarEditParameterKey, string>> = {
  grainAmount: "Amount",
  grainSize: "Size",
  grainRoughness: "Roughness",
  grainColor: "Colour",
  vignetteAmount: "Amount",
  vignetteMidpoint: "Midpoint",
  vignetteFeather: "Feather",
};

export function EffectsTab({ params, disabled, onChange }: EffectsTabProps) {
  function update(key: ScalarEditParameterKey, value: number) {
    onChange({ ...params, hsl: params.hsl, [key]: value });
  }

  return (
    <div className="sidebar-tab" aria-label="Effects">
      <section className="sidebar-section">
        <h2 className="sidebar-tab__title">Grain</h2>
        <div className="sidebar-tab__sliders">
          {GRAIN_KEYS.map((key) => {
            const config = EDIT_SLIDER_CONFIG[key];
            return (
              <ParamSlider
                key={key}
                id={`fx-${key}`}
                label={SHORT_LABELS[key] ?? config.label}
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
      </section>

      <section className="sidebar-section">
        <h2 className="sidebar-tab__title">Vignette</h2>
        <div className="sidebar-tab__sliders">
          {VIGNETTE_KEYS.map((key) => {
            const config = EDIT_SLIDER_CONFIG[key];
            return (
              <ParamSlider
                key={key}
                id={`fx-${key}`}
                label={SHORT_LABELS[key] ?? config.label}
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
      </section>
    </div>
  );
}
