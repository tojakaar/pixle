interface ParamSliderProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}

function defaultFormat(value: number, step: number): string {
  if (step < 1) return value.toFixed(2);
  return String(Math.round(value));
}

/** Shared compact range control used across sidebar tabs. */
export function ParamSlider({
  id,
  label,
  value,
  min,
  max,
  step,
  disabled,
  format,
  onChange,
}: ParamSliderProps) {
  const display = format ? format(value) : defaultFormat(value, step);

  return (
    <label className="slider" htmlFor={id}>
      <span className="slider__meta">
        <span className="slider__label">{label}</span>
        <span className="slider__value">{display}</span>
      </span>
      <input
        id={id}
        type="range"
        className="slider__input"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
    </label>
  );
}
