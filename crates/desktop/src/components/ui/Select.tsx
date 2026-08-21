import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import "./ui.css";

export interface SelectOption {
  value: string;
  label: ReactNode;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
}

export function Select({ value, options, onChange, ariaLabel }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  useEffect(() => {
    setHighlight(Math.max(0, options.findIndex((o) => o.value === value)));
  }, [open, options, value]);

  const selected = options.find((o) => o.value === value);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!open) {
      if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp") {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      setHighlight((h) => Math.min(h + 1, options.length - 1));
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      setHighlight((h) => Math.max(h - 1, 0));
      e.preventDefault();
    } else if (e.key === "Enter") {
      const option = options[highlight];
      if (option) {
        onChange(option.value);
        setOpen(false);
      }
      e.preventDefault();
    }
  }

  return (
    <div ref={rootRef} className="select" onKeyDown={onKeyDown}>
      <button
        type="button"
        className="select-field"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="select-item-label">{selected?.label}</span>
        <svg
          className="select-chevron"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="select-menu" role="listbox">
          {options.map((option, i) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`select-item${i === highlight ? " highlighted" : ""}`}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span className="select-check">
                {option.value === value && (
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    width="12"
                    height="12"
                  >
                    <path d="m3.5 8.5 3 3 6-7" />
                  </svg>
                )}
              </span>
              <span className="select-item-label">{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}