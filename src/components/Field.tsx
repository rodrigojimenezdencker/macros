import { useEffect, useState, type ReactNode } from 'react';
import { numberText, parseNumber } from '../hooks';

/**
 * A numeric text field that accepts "1,5" and "1.5", keeps whatever the user
 * is typing, and reports a parsed number (or undefined when empty/invalid).
 */
export function NumberField({
  label,
  value,
  onChange,
  suffix,
  placeholder,
  decimals = 1,
  autoFocus,
  hint,
  id,
}: {
  label: ReactNode;
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  suffix?: string;
  placeholder?: string;
  decimals?: number;
  autoFocus?: boolean;
  hint?: ReactNode;
  id?: string;
}) {
  const [text, setText] = useState(() => numberText(value, decimals));

  // Follow outside changes (e.g. a calculator filling the form) without
  // clobbering an in-progress edit that parses to the same number.
  useEffect(() => {
    setText((t) => (parseNumber(t) === value ? t : numberText(value, decimals)));
  }, [value, decimals]);

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const t = e.target.value.replace(/[^\d.,]/g, '');
            setText(t);
            onChange(parseNumber(t));
          }}
        />
        {suffix && <span className="field-suffix">{suffix}</span>}
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: ReactNode;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />
      </span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'active' : ''}
          onClick={() => onChange(o.value)}
          type="button"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
