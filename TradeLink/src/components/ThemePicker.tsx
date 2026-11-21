import { THEMES, useTheme } from "../lib/siteTheme";

/** Colour theme picker for the dashboards: Comfort, Calm, Light, Dark. Remembered on this device. */
export default function ThemePicker() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="app-theme" role="group" aria-label="Colour theme">
      {THEMES.map(t => (
        <button key={t.id} type="button" className={theme === t.id ? "on" : ""} aria-pressed={theme === t.id} aria-label={t.label} title={t.label} onClick={() => setTheme(t.id)} style={{ background: t.swatch }} />
      ))}
    </div>
  );
}
