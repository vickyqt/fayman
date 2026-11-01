"use client";
import { useEffect, useState } from "react";
import { getThemeChoice, setThemeChoice, type ThemeChoice } from "@/lib/client/theme";

const NEXT: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<ThemeChoice, string> = { system: "Auto", light: "Light", dark: "Dark" };

function Icon({ t }: { t: ThemeChoice }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, "aria-hidden": true } as const;
  if (t === "light")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4.5" />
        <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1" />
      </svg>
    );
  if (t === "dark")
    return (
      <svg {...common}>
        <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" />
    </svg>
  );
}

/** Cycles Auto → Light → Dark. */
export function ThemeToggle() {
  const [t, setT] = useState<ThemeChoice>("system");
  useEffect(() => setT(getThemeChoice()), []);
  return (
    <button
      className="btn sm theme-toggle"
      onClick={() => {
        const n = NEXT[t];
        setThemeChoice(n);
        setT(n);
      }}
      title={`Theme: ${LABEL[t]} (click for ${LABEL[NEXT[t]]})`}
      aria-label={`Theme: ${LABEL[t]}. Switch to ${LABEL[NEXT[t]]}`}
    >
      <Icon t={t} />
      <span className="theme-label">{LABEL[t]}</span>
    </button>
  );
}
