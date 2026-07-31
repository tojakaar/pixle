interface IntensityControlProps {
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}

/**
 * Live intensity for the most recent AI/look edit.
 * Interpolates parameter state — never triggers a Gemini request.
 */
export function IntensityControl({
  value,
  disabled,
  onChange,
}: IntensityControlProps) {
  return (
    <section className="intensity-control" aria-label="Edit intensity">
      <div className="intensity-control__meta">
        <label className="intensity-control__label" htmlFor="edit-intensity">
          Intensity
        </label>
        <span className="intensity-control__value">{Math.round(value)}%</span>
      </div>
      <input
        id="edit-intensity"
        type="range"
        className="slider__input intensity-control__slider"
        min={0}
        max={100}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
    </section>
  );
}
