import { useCallback, useEffect, useState } from "react";

export type ThemeId = "comfort" | "calm" | "light" | "dark";
export const THEMES: { id: ThemeId; label: string; swatch: string }[] = [
  { id: "comfort", label: "Comfort (warm, easy on the eyes)", swatch: "#f3ecd9" },
  { id: "calm", label: "Calm (soft green)", swatch: "#e3ede4" },
  { id: "light", label: "Light", swatch: "#ffffff" },
  { id: "dark", label: "Night mode", swatch: "#1d252b" },
];
/** The public website has no dark theme; dashboards offer all four. */
export const PUBLIC_THEMES = THEMES.filter(t => t.id !== "dark");
/** Dashboards offer Light (original) and Night only. */
export const APP_THEMES = THEMES.filter(t => t.id === "light" || t.id === "dark");
const KEY = "tl-theme";
const ids = THEMES.map(t => t.id) as string[];

export function readTheme(): ThemeId {
  try { const v = localStorage.getItem(KEY); if (v && ids.includes(v)) return v as ThemeId; } catch { /* storage blocked */ }
  return "light";
}
export function applyTheme(t: ThemeId) { document.documentElement.dataset.theme = t; }

/** Website theme. Light is the default; the choice is remembered on this device. */
export function useTheme() {
  const [theme, set] = useState<ThemeId>(readTheme);
  useEffect(() => { applyTheme(theme); }, [theme]);
  const setTheme = useCallback((t: ThemeId) => { set(t); try { localStorage.setItem(KEY, t); } catch { /* ignore */ } }, []);
  return { theme, setTheme };
}
