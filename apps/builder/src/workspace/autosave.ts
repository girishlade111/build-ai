import type { ProjectFile } from "@ladestack/shared-types";

export const AUTOSAVE_INTERVAL_MS = 30_000;
export const AUTOSAVE_KEY_PREFIX = "ladestack.autosave.v1.";
const MAX_CHANGE_EVENTS = 80;

export type WorkspaceView = "code" | "preview" | "overview" | "dashboard";
export type CodeAuthor = "ai" | "manual";

export interface FileAuthorship {
  aiLines: number;
  manualLines: number;
  aiEdits: number;
  manualEdits: number;
  lastAuthor: CodeAuthor;
  updatedAt: string;
}

export interface FileChangeEvent {
  id: string;
  at: string;
  path: string;
  author: CodeAuthor;
  linesChanged: number;
  totalLines: number;
}

export interface WorkspaceAutoSaveDraft {
  path: string;
  revision: string;
  content: string;
  dirty: boolean;
}

export interface WorkspaceAutoSaveSnapshot {
  version: 1;
  projectId: string;
  projectName: string;
  savedAt: string;
  view: WorkspaceView;
  activeFilePath: string | null;
  followEdits: boolean;
  openDraft: WorkspaceAutoSaveDraft | null;
  fileRevisions: Record<string, { revision: string; size: number; contentHash: string }>;
  authorship: Record<string, FileAuthorship>;
  changeHistory: FileChangeEvent[];
}

export function autosaveStorageKey(projectId: string): string {
  return `${AUTOSAVE_KEY_PREFIX}${projectId}`;
}

function isWorkspaceView(v: unknown): v is WorkspaceView {
  return v === "code" || v === "preview" || v === "overview" || v === "dashboard";
}

function isCodeAuthor(v: unknown): v is CodeAuthor {
  return v === "ai" || v === "manual";
}

function sanitizeAuthorship(raw: unknown): Record<string, FileAuthorship> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, FileAuthorship> = {};
  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const item = value as Partial<FileAuthorship>;
    if (!isCodeAuthor(item.lastAuthor)) continue;
    out[path] = {
      aiLines: Math.max(0, Number(item.aiLines) || 0),
      manualLines: Math.max(0, Number(item.manualLines) || 0),
      aiEdits: Math.max(0, Number(item.aiEdits) || 0),
      manualEdits: Math.max(0, Number(item.manualEdits) || 0),
      lastAuthor: item.lastAuthor,
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
    };
  }
  return out;
}

function sanitizeChangeHistory(raw: unknown): FileChangeEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: FileChangeEvent[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Partial<FileChangeEvent>;
    if (
      typeof item.id !== "string" ||
      typeof item.at !== "string" ||
      typeof item.path !== "string" ||
      !isCodeAuthor(item.author)
    ) {
      continue;
    }
    out.push({
      id: item.id,
      at: item.at,
      path: item.path,
      author: item.author,
      linesChanged: Math.max(0, Number(item.linesChanged) || 0),
      totalLines: Math.max(0, Number(item.totalLines) || 0),
    });
  }
  return out.slice(-MAX_CHANGE_EVENTS);
}

export function loadWorkspaceAutoSave(
  storage: Storage | null | undefined,
  projectId: string,
): WorkspaceAutoSaveSnapshot | null {
  if (!storage || !projectId) return null;
  try {
    const raw = storage.getItem(autosaveStorageKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorkspaceAutoSaveSnapshot>;
    if (parsed.version !== 1 || parsed.projectId !== projectId || typeof parsed.savedAt !== "string") {
      return null;
    }
    const openDraft =
      parsed.openDraft &&
      typeof parsed.openDraft === "object" &&
      typeof parsed.openDraft.path === "string" &&
      typeof parsed.openDraft.revision === "string" &&
      typeof parsed.openDraft.content === "string"
        ? {
            path: parsed.openDraft.path,
            revision: parsed.openDraft.revision,
            content: parsed.openDraft.content,
            dirty: Boolean(parsed.openDraft.dirty),
          }
        : null;

    return {
      version: 1,
      projectId,
      projectName: typeof parsed.projectName === "string" ? parsed.projectName : "",
      savedAt: parsed.savedAt,
      view: isWorkspaceView(parsed.view) ? parsed.view : "code",
      activeFilePath: typeof parsed.activeFilePath === "string" ? parsed.activeFilePath : null,
      followEdits: typeof parsed.followEdits === "boolean" ? parsed.followEdits : true,
      openDraft,
      fileRevisions:
        parsed.fileRevisions && typeof parsed.fileRevisions === "object"
          ? parsed.fileRevisions
          : {},
      authorship: sanitizeAuthorship(parsed.authorship),
      changeHistory: sanitizeChangeHistory(parsed.changeHistory),
    };
  } catch {
    return null;
  }
}

export function buildFileRevisionMap(
  files: ProjectFile[],
): Record<string, { revision: string; size: number; contentHash: string }> {
  return Object.fromEntries(
    files.map((f) => [
      f.path,
      {
        revision: f.revision,
        size: f.size,
        contentHash: f.contentHash,
      },
    ]),
  );
}

export function saveWorkspaceAutoSave(
  storage: Storage | null | undefined,
  snapshot: WorkspaceAutoSaveSnapshot,
): { ok: true; savedAt: string } | { ok: false } {
  if (!storage || !snapshot.projectId) return { ok: false };
  const key = autosaveStorageKey(snapshot.projectId);
  const trimmed: WorkspaceAutoSaveSnapshot = {
    ...snapshot,
    changeHistory: snapshot.changeHistory.slice(-MAX_CHANGE_EVENTS),
  };
  try {
    storage.setItem(key, JSON.stringify(trimmed));
    return { ok: true, savedAt: trimmed.savedAt };
  } catch {
    // Quota fallback: omit draft body and keep recent metadata + authorship history.
    try {
      const compact: WorkspaceAutoSaveSnapshot = {
        ...trimmed,
        openDraft: null,
        changeHistory: trimmed.changeHistory.slice(-25),
      };
      storage.setItem(key, JSON.stringify(compact));
      return { ok: true, savedAt: compact.savedAt };
    } catch {
      return { ok: false };
    }
  }
}

export function estimateChangedLines(prevContent: string | undefined, nextContent: string): number {
  const nextLines = nextContent.length === 0 ? [] : nextContent.split("\n");
  if (prevContent === undefined) return Math.max(1, nextLines.length);
  const prevLines = prevContent.length === 0 ? [] : prevContent.split("\n");
  const maxLen = Math.max(prevLines.length, nextLines.length);
  let diff = 0;
  for (let i = 0; i < maxLen; i++) {
    if (prevLines[i] !== nextLines[i]) diff++;
  }
  return Math.max(1, diff);
}

export function recordFileChange(
  state: {
    authorship: Record<string, FileAuthorship>;
    changeHistory: FileChangeEvent[];
  },
  input: {
    path: string;
    author: CodeAuthor;
    totalLines: number;
    linesChanged: number;
    at: string;
    id?: string;
  },
): {
  authorship: Record<string, FileAuthorship>;
  changeHistory: FileChangeEvent[];
} {
  const prev = state.authorship[input.path];
  const totalLines = Math.max(0, input.totalLines);
  const delta = Math.max(1, Math.min(totalLines || 1, input.linesChanged));

  let aiLines = prev?.aiLines ?? 0;
  let manualLines = prev?.manualLines ?? (prev ? 0 : Math.max(0, totalLines - delta));

  if (input.author === "ai") {
    if (!prev) {
      aiLines = totalLines;
      manualLines = 0;
    } else {
      aiLines = Math.min(totalLines, aiLines + delta);
      manualLines = Math.max(0, totalLines - aiLines);
    }
  } else {
    if (!prev) {
      manualLines = totalLines;
      aiLines = 0;
    } else {
      manualLines = Math.min(totalLines, manualLines + delta);
      aiLines = Math.max(0, totalLines - manualLines);
    }
  }

  const nextAuthorship: FileAuthorship = {
    aiLines,
    manualLines,
    aiEdits: (prev?.aiEdits ?? 0) + (input.author === "ai" ? 1 : 0),
    manualEdits: (prev?.manualEdits ?? 0) + (input.author === "manual" ? 1 : 0),
    lastAuthor: input.author,
    updatedAt: input.at,
  };

  const event: FileChangeEvent = {
    id: input.id ?? `${input.at}:${input.path}:${state.changeHistory.length}`,
    at: input.at,
    path: input.path,
    author: input.author,
    linesChanged: delta,
    totalLines,
  };

  return {
    authorship: {
      ...state.authorship,
      [input.path]: nextAuthorship,
    },
    changeHistory: [...state.changeHistory, event].slice(-MAX_CHANGE_EVENTS),
  };
}

export function formatSavedClock(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(11, 19);
  }
}

export function formatSavedDateTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}
