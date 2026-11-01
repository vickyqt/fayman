"use client";
/**
 * Light / dark / system theme. The choice lives in localStorage and is
 * applied as html[data-theme] (absent = follow the OS). lib/theme-script.ts
 * runs in <head> before first paint so there's no flash of the wrong theme.
 */
import { useEffect, useState } from "react";
import { THEME_KEY as KEY } from "@/lib/theme-script";

export type ThemeChoice = "system" | "light" | "dark";
export type Resolved = "light" | "dark";

/** Literal colors for libraries that can't read CSS variables (React Flow markers). Mirrors app/globals.css. */
export const PALETTE: Record<Resolved, { surface: string; ink: string; blue: string; green: string; red: string; line: string }> = {
  light: { surface: "#ffffff", ink: "#0a0a0a", blue: "#2563eb", green: "#16a34a", red: "#dc2626", line: "#e7e7e7" },
  dark: { surface: "#171a21", ink: "#e8e6e1", blue: "#74a3ff", green: "#3fcf80", red: "#ff6f6f", line: "#252a33" },
};

export function getThemeChoice(): ThemeChoice {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function setThemeChoice(t: ThemeChoice) {
  try {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    /* storage blocked: still apply for this page */
  }
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

function resolve(): Resolved {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The theme actually on screen; updates on toggle and on OS changes. */
export function useResolvedTheme(): Resolved {
  const [t, setT] = useState<Resolved>("light");
  useEffect(() => {
    const update = () => setT(resolve());
    update();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", update);
      mo.disconnect();
    };
  }, []);
  return t;
}
