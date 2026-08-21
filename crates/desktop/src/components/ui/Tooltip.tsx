import { useRef, useState, type ReactNode } from "react";
import "./ui.css";

interface TooltipProps {
  label: string;
  children: ReactNode;
  /** Delay before the tooltip appears. */
  delay?: number;
  placement?: "top" | "bottom" | "right";
}

export function Tooltip({ label, children, delay = 500, placement = "bottom" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(true), delay);
  };

  const hide = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setVisible(false);
  };

  return (
    <span
      className="tooltip-wrap"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <span className={`tooltip tooltip-${placement}`} role="tooltip">
          {label}
        </span>
      )}
    </span>
  );
}