import { APP_THEMES, useTheme } from "../lib/siteTheme";

/** Theme picker for the dashboards: Light or Night. Remembered on this device. */
export default function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const active = theme === "dark" ? "dark" : "light";
  return (
    <div className="app-theme" role="group" aria-label="Colour theme">
      {APP_THEMES.map(t => (
        <button key={t.id} type="button" className={active === t.id ? "on" : ""} aria-pressed={active === t.id} aria-label={t.label} title={t.label} onClick={() => setTheme(t.id)} style={{ background: t.swatch }} />
      ))}
    </div>
  );
}
