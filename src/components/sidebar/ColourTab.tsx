import { useState, type CSSProperties } from "react";
import {
  HSL_BAND_SLIDER_CONFIG,
  HSL_COLOR_NAMES,
  hslColorLabel,
  type EditParameters,
  type HslBand,
  type HslColorName,
} from "../../engine";
import { ParamSlider } from "../ParamSlider";

interface ColourTabProps {
  params: EditParameters;
  disabled: boolean;
  onChange: (params: EditParameters) => void;
}

const HSL_CHANNELS: (keyof HslBand)[] = ["hue", "saturation", "luminance"];

/** Approximate swatch hues for the colour chips. */
const SWATCH: Record<HslColorName, string> = {
  red: "#c44b4b",
  orange: "#d87a3a",
  yellow: "#c9a227",
  green: "#3f9b5c",
  aqua: "#2f9a9a",
  blue: "#3b6fb6",
  purple: "#7a4ea8",
  magenta: "#b04a8f",
};

export function ColourTab({ params, disabled, onChange }: ColourTabProps) {
  const [selected, setSelected] = useState<HslColorName>("orange");
  const band = params.hsl[selected];

  function updateChannel(channel: keyof HslBand, value: number) {
    onChange({
      ...params,
      hsl: {
        ...params.hsl,
        [selected]: {
          ...params.hsl[selected],
          [channel]: value,
        },
      },
    });
  }

  return (
    <div className="sidebar-tab" aria-label="Colour">
      <header className="sidebar-tab__header">
        <h2 className="sidebar-tab__title">
          {hslColorLabel(selected)} HSL
        </h2>
      </header>

      <div
        className="colour-chips"
        role="radiogroup"
        aria-label="Colour bands"
      >
        {HSL_COLOR_NAMES.map((color) => {
          const active = color === selected;
          return (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={active}
              className={
                active
                  ? "colour-chips__chip colour-chips__chip--active"
                  : "colour-chips__chip"
              }
              style={{ "--chip-color": SWATCH[color] } as CSSProperties}
              disabled={disabled}
              title={hslColorLabel(color)}
              onClick={() => setSelected(color)}
            >
              <span className="colour-chips__swatch" aria-hidden="true" />
              <span className="colour-chips__name">
                {hslColorLabel(color)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="sidebar-tab__sliders">
        {HSL_CHANNELS.map((channel) => {
          const config = HSL_BAND_SLIDER_CONFIG[channel];
          return (
            <ParamSlider
              key={channel}
              id={`hsl-${selected}-${channel}`}
              label={config.label}
              value={band[channel]}
              min={config.min}
              max={config.max}
              step={config.step}
              disabled={disabled}
              onChange={(value) => updateChannel(channel, value)}
            />
          );
        })}
      </div>
    </div>
  );
}
