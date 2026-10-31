import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { formatClock, parseClock } from '../lib/time';

interface ClockInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onUseCurrentTime?: () => void;
  disabled?: boolean;
  hint?: string;
}

export function ClockInput({
  label,
  value,
  onChange,
  onUseCurrentTime,
  disabled,
  hint,
}: ClockInputProps) {
  const [text, setText] = useState(formatClock(value, true));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(formatClock(value, true));
    setInvalid(false);
  }, [value]);

  const commit = () => {
    const parsed = parseClock(text);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(parsed);
    setText(formatClock(parsed, true));
  };

  return (
    <label className={`field clock-field ${invalid ? 'is-invalid' : ''}`}>
      <span className="field-label">{label}</span>
      <span className="clock-input-row">
        <input
          className="input mono"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
          }}
          inputMode="decimal"
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={hint ? `${label}-hint` : undefined}
        />
        {onUseCurrentTime ? (
          <button
            type="button"
            className="icon-button icon-button-small"
            onClick={onUseCurrentTime}
            title="Use current video time"
            aria-label={`Use current video time for ${label}`}
            disabled={disabled}
          >
            <Timer size={15} />
          </button>
        ) : null}
      </span>
      {invalid ? <span className="field-error">Use m:ss or seconds.</span> : null}
      {!invalid && hint ? (
        <span className="field-hint" id={`${label}-hint`}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}
