import { useEffect, useMemo, useState } from "react";
import type { AppSettings, Goal, MiningSession } from "./types";
import { storage, exportPayload } from "./lib/storage";
import { deleteCommunityRun, submitCommunityRun } from "./lib/api";
import { AppShell, type ViewName } from "./components/AppShell";
import { Overview } from "./views/Overview";
import { LogRun } from "./views/LogRun";
import { Calculator } from "./views/Calculator";
import { Sessions } from "./views/Sessions";
import { Analytics } from "./views/Analytics";
import { Community } from "./views/Community";
import { Goals } from "./views/Goals";
import { Settings } from "./views/Settings";
import { LiveExtension } from "./views/LiveExtension";

const DEFAULT_SETTINGS: AppSettings = { theme: "light", defaultCommunityOptIn: false };

function isExtensionRuntime() {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
}

export default function App() {
  const [view, setView] = useState<ViewName>(() => isExtensionRuntime() ? "live" : "overview");
  const [sessions, setSessions] = useState<MiningSession[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([storage.sessions(), storage.goals(), storage.settings()]).then(([s, g, st]) => {
      setSessions(s);
      setGoals(g);
      setSettings(st);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  async function saveSession(session: MiningSession) {
    const next = [session, ...sessions.filter(s => s.id !== session.id)];
    setSessions(next);
    await storage.saveSession(session);

    if (session.communityOptIn) {
      try {
        await submitCommunityRun(session);
        const synced = { ...session, cloudStatus: "synced" as const };
        setSessions(prev => prev.map(s => s.id === session.id ? synced : s));
        await storage.saveSession(synced);
      } catch {
        const failed = { ...session, cloudStatus: "failed" as const };
        setSessions(prev => prev.map(s => s.id === session.id ? failed : s));
        await storage.saveSession(failed);
      }
    }
  }

  async function deleteSession(id: string) {
    const session = sessions.find(s => s.id === id);
    if (!session) return;
    if (session.communityOptIn && session.cloudStatus === "synced") {
      await deleteCommunityRun(id);
    }
    await storage.deleteSession(id);
    setSessions(prev => prev.filter(s => s.id !== id));
  }

  async function saveGoal(goal: Goal) {
    setGoals(prev => [goal, ...prev.filter(g => g.id !== goal.id)]);
    await storage.saveGoal(goal);
  }

  async function deleteGoal(id: string) {
    setGoals(prev => prev.filter(g => g.id !== id));
    await storage.deleteGoal(id);
  }

  async function updateSettings(next: AppSettings) {
    setSettings(next);
    await storage.saveSettings(next);
  }

  const content = useMemo(() => {
    const shared = { sessions, settings };
    switch (view) {
      case "live": return isExtensionRuntime() ? <LiveExtension appSettings={settings} onSave={saveSession} /> : <Overview sessions={sessions} goals={goals} onNavigate={setView} />;
      case "log": return <LogRun {...shared} onSave={saveSession} />;
      case "calculator": return <Calculator {...shared} />;
      case "sessions": return <Sessions sessions={sessions} onDelete={deleteSession} />;
      case "analytics": return <Analytics sessions={sessions} />;
      case "community": return <Community sessions={sessions} />;
      case "goals": return <Goals sessions={sessions} goals={goals} onSave={saveGoal} onDelete={deleteGoal} />;
      case "settings": return <Settings sessions={sessions} goals={goals} settings={settings} onSettings={updateSettings} onImported={async () => {
        setSessions(await storage.sessions());
        setGoals(await storage.goals());
        setSettings(await storage.settings());
      }} exportPayload={() => exportPayload(sessions, goals, settings)} />;
      default: return <Overview sessions={sessions} goals={goals} onNavigate={setView} />;
    }
  }, [view, sessions, goals, settings]);

  if (!ready) return <div className="boot"><div className="brand-mark"/><span>Loading local data…</span></div>;

  return <AppShell view={view} onNavigate={setView} settings={settings} onSettings={updateSettings}>{content}</AppShell>;
}
