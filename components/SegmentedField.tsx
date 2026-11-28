/**
 * A segmented choice that submits with a plain form.
 *
 * Real radio inputs, uncontrolled (defaultChecked), and no "use client": it
 * renders on the server inside a GET form, so filtering keeps working with
 * JavaScript off and every filtered view stays a URL. The theme switch uses
 * the same .segmented styles but is controlled, because it acts immediately.
 *
 * The legend is visible and doubles as the group's label, so a screen reader
 * announces "Part, Part 2, radio button, selected, 3 of 4".
 */
type Option = { value: string; label: string };

export default function SegmentedField({
  name,
  legend,
  options,
  value,
}: {
  name: string;
  legend: string;
  options: readonly Option[];
  /** The currently applied value; "" for none. */
  value: string;
}) {
  return (
    <fieldset className="segmented">
      <legend className="field__label">{legend}</legend>
      <div className="segmented__track">
        {options.map((option) => {
          const id = `${name}-${option.value || "all"}`;
          return (
            <label key={option.value} className="segmented__option" htmlFor={id}>
              <input
                id={id}
                type="radio"
                name={name}
                value={option.value}
                defaultChecked={value === option.value}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
