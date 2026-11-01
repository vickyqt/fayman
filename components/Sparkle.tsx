"use client";
import { useId } from "react";

/**
 * Four-point "sparkle" star with concave sides (Gemini-style), the symbol for
 * reimagining content. The one deliberate exception to the 5-color palette:
 * a blue → violet → rose gradient so the action is recognisable at a glance.
 */
export function Sparkle({ size = 18, className, mono = false }: { size?: number; className?: string; mono?: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      {!mono && (
        <defs>
          <linearGradient id={`sp-${id}`} x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--blue)" />
            <stop offset="0.55" stopColor="#9b72cb" />
            <stop offset="1" stopColor="#d96570" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M12 1.6c.55 5.6 4.8 9.85 10.4 10.4-5.6.55-9.85 4.8-10.4 10.4C11.45 16.8 7.2 12.55 1.6 12 7.2 11.45 11.45 7.2 12 1.6Z"
        fill={mono ? "currentColor" : `url(#sp-${id})`}
      />
    </svg>
  );
}
