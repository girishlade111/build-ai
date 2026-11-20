import { describe, expect, it } from "vitest";
import { storagePrefixes } from "../storage/erase";
import {
  AUTOSAVE_INTERVAL_MS,
  AUTOSAVE_KEY_PREFIX,
  autosaveStorageKey,
  estimateChangedLines,
  formatSavedClock,
  loadWorkspaceAutoSave,
  recordFileChange,
  saveWorkspaceAutoSave,
  type WorkspaceAutoSaveSnapshot,
} from "./autosave";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  failOnceOnLarge = false;

  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    if (this.failOnceOnLarge && value.length > 500) {
      this.failOnceOnLarge = false;
      throw new Error("QuotaExceededError");
    }
    this.map.set(key, value);
  }
}

function makeSnapshot(overrides: Partial<WorkspaceAutoSaveSnapshot> = {}): WorkspaceAutoSaveSnapshot {
  return {
    version: 1,
    projectId: "proj-1",
    projectName: "Starter App",
    savedAt: "2026-11-20T15:30:05.000Z",
    view: "overview",
    activeFilePath: "src/App.tsx",
    followEdits: true,
    openDraft: {
      path: "src/App.tsx",
      revision: "2",
      content: "export default function App() { return null; }\n",
      dirty: true,
    },
    fileRevisions: {
      "src/App.tsx": { revision: "2", size: 47, contentHash: "abc" },
    },
    authorship: {},
    changeHistory: [],
    ...overrides,
  };
}

describe("workspace autosave", () => {
  it("uses a 30-second interval and a key prefix cleared by eraseLocalData", () => {
    expect(AUTOSAVE_INTERVAL_MS).toBe(30_000);
    expect(storagePrefixes.some((p) => AUTOSAVE_KEY_PREFIX.startsWith(p))).toBe(true);
    expect(autosaveStorageKey("p1")).toBe("ladestack.autosave.v1.p1");
  });

  it("saves and restores a snapshot cleanly", () => {
    const storage = new MemoryStorage();
    const snapshot = makeSnapshot();
    const res = saveWorkspaceAutoSave(storage, snapshot);
    expect(res).toEqual({ ok: true, savedAt: snapshot.savedAt });

    const loaded = loadWorkspaceAutoSave(storage, "proj-1");
    expect(loaded).toEqual(snapshot);
  });

  it("recovers from QuotaExceededError by saving a compact snapshot without draft body", () => {
    const storage = new MemoryStorage();
    storage.failOnceOnLarge = true;
    const largeDraft = "x".repeat(2000);
    const snapshot = makeSnapshot({
      openDraft: { path: "src/App.tsx", revision: "1", content: largeDraft, dirty: true },
    });

    const res = saveWorkspaceAutoSave(storage, snapshot);
    expect(res.ok).toBe(true);
    const loaded = loadWorkspaceAutoSave(storage, "proj-1");
    expect(loaded?.openDraft).toBeNull();
    expect(loaded?.projectId).toBe("proj-1");
  });

  it("returns null for corrupt or mismatched project data", () => {
    const storage = new MemoryStorage();
    storage.setItem(autosaveStorageKey("proj-1"), "{not-json");
    expect(loadWorkspaceAutoSave(storage, "proj-1")).toBeNull();

    storage.setItem(
      autosaveStorageKey("proj-1"),
      JSON.stringify(makeSnapshot({ projectId: "other" })),
    );
    expect(loadWorkspaceAutoSave(storage, "proj-1")).toBeNull();
  });

  it("tracks manual and AI code authorship transitions per file", () => {
    const s1 = recordFileChange(
      { authorship: {}, changeHistory: [] },
      {
        path: "src/Widget.tsx",
        author: "ai",
        totalLines: 40,
        linesChanged: 40,
        at: "2026-11-20T15:00:00.000Z",
      },
    );
    expect(s1.authorship["src/Widget.tsx"]).toMatchObject({
      aiLines: 40,
      manualLines: 0,
      aiEdits: 1,
      manualEdits: 0,
      lastAuthor: "ai",
    });

    const s2 = recordFileChange(s1, {
      path: "src/Widget.tsx",
      author: "manual",
      totalLines: 50,
      linesChanged: 15,
      at: "2026-11-20T15:05:00.000Z",
    });
    expect(s2.authorship["src/Widget.tsx"]).toMatchObject({
      aiLines: 35,
      manualLines: 15,
      aiEdits: 1,
      manualEdits: 1,
      lastAuthor: "manual",
    });
    expect(s2.changeHistory).toHaveLength(2);
  });

  it("estimates changed lines and formats clock timestamps", () => {
    expect(estimateChangedLines("a\nb\nc", "a\nB\nc\nd")).toBe(2);
    expect(estimateChangedLines(undefined, "a\nb")).toBe(2);
    expect(formatSavedClock("2026-11-20T15:30:05.000Z", "en")).not.toBe("");
    expect(formatSavedClock("not-a-date", "en")).toBe("");
  });
});
