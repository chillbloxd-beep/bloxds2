import type { AppSettings, Goal, MiningSession } from "../types";

const DB_NAME = "oneblock-analytics";
const DB_VERSION = 1;
const SESSION_STORE = "sessions";
const GOAL_STORE = "goals";
const SETTINGS_STORE = "settings";

const defaultSettings: AppSettings = {
  theme: "light",
  defaultCommunityOptIn: false
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        const store = db.createObjectStore(SESSION_STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains(GOAL_STORE)) {
        db.createObjectStore(GOAL_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function put<T>(storeName: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function remove(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const storage = {
  async sessions(): Promise<MiningSession[]> {
    return (await getAll<MiningSession>(SESSION_STORE))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  saveSession(session: MiningSession) {
    return put(SESSION_STORE, session);
  },
  deleteSession(id: string) {
    return remove(SESSION_STORE, id);
  },
  async goals(): Promise<Goal[]> {
    return getAll<Goal>(GOAL_STORE);
  },
  saveGoal(goal: Goal) {
    return put(GOAL_STORE, goal);
  },
  deleteGoal(id: string) {
    return remove(GOAL_STORE, id);
  },
  async settings(): Promise<AppSettings> {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(SETTINGS_STORE, "readonly");
      const req = tx.objectStore(SETTINGS_STORE).get("app");
      req.onsuccess = () => resolve({ ...defaultSettings, ...(req.result?.value ?? {}) });
      req.onerror = () => resolve(defaultSettings);
    });
  },
  saveSettings(settings: AppSettings) {
    return put(SETTINGS_STORE, { key: "app", value: settings });
  },
  async clearAll(): Promise<void> {
    const db = await openDb();
    await Promise.all([SESSION_STORE, GOAL_STORE, SETTINGS_STORE].map(storeName =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
    ));
  }
};

export function exportPayload(sessions: MiningSession[], goals: Goal[], settings: AppSettings) {
  return {
    format: "oneblock-analytics-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    sessions,
    goals,
    settings
  };
}
