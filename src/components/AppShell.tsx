import type { PropsWithChildren } from "react";
import type { AppSettings } from "../types";

export type ViewName = "overview" | "log" | "calculator" | "sessions" | "analytics" | "community" | "goals" | "settings";

const nav: { id: ViewName; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "log", label: "Log Run" },
  { id: "calculator", label: "Calculator" },
  { id: "sessions", label: "Sessions" },
  { id: "analytics", label: "Analytics" },
  { id: "community", label: "Community" },
  { id: "goals", label: "Goals" }
];

export function AppShell({
  view, onNavigate, settings, onSettings, children
}: PropsWithChildren<{
  view: ViewName;
  onNavigate: (v: ViewName) => void;
  settings: AppSettings;
  onSettings: (s: AppSettings) => void;
}>) {
  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => onNavigate("overview")}>
        <span className="brand-symbol"><i/></span>
        <span><b>ONEBLOCK</b><small>ANALYTICS</small></span>
      </button>
      <nav className="side-nav">
        {nav.map(item => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => onNavigate(item.id)}>{item.label}</button>)}
      </nav>
      <div className="side-bottom">
        <button className={view === "settings" ? "active" : ""} onClick={() => onNavigate("settings")}>Settings</button>
        <button className="theme-toggle" onClick={() => onSettings({ ...settings, theme: settings.theme === "light" ? "dark" : "light" })}>
          {settings.theme === "light" ? "Dark mode" : "Light mode"}
        </button>
      </div>
    </aside>
    <header className="mobile-head">
      <button className="brand compact" onClick={() => onNavigate("overview")}><span className="brand-symbol"><i/></span><b>ONEBLOCK</b></button>
      <select value={view} onChange={e => onNavigate(e.target.value as ViewName)}>
        {[...nav, {id:"settings" as ViewName,label:"Settings"}].map(n=><option value={n.id} key={n.id}>{n.label}</option>)}
      </select>
    </header>
    <main className="main">{children}</main>
  </div>
}
