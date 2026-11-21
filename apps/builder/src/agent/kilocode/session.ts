/**
 * Ported from kilo-org/kilocode (MIT License):
 * - packages/opencode/src/session/processor.ts (DOOM_LOOP_THRESHOLD = 3)
 * - packages/opencode/src/session/retry.ts (exponential backoff + jitter + retryable classification)
 * - packages/opencode/src/tool/truncate.ts (MAX_LINES = 2000, MAX_BYTES = 50 KB)
 * - packages/opencode/src/session/todo.ts & compaction.ts
 * Plus browser localStorage persistence under the `ladestack.` prefix.
 */

import type { StreamError } from "../../providers/stream";
import type { CustomModePermissions, KiloAgentMode, PermissionPreset } from "./permission";

/** Exact threshold from Kilo Code session/processor.ts */
export const DOOM_LOOP_THRESHOLD = 3;

/** Exact retry constants from Kilo Code session/retry.ts */
export const RETRY_INITIAL_DELAY = 2000;
export const RETRY_BACKOFF_FACTOR = 2;
export const RETRY_JITTER_FACTOR = 0.25;
export const RETRY_MAX_DELAY_NO_HEADERS = 30_000;
export const RETRY_MAX_RETRIES = 5;

/** Exact truncation limits from Kilo Code tool/truncate.ts */
export const TRUNCATE_MAX_LINES = 2000;
export const TRUNCATE_MAX_BYTES = 50 * 1024;

/** Context compaction trigger threshold (estimated tokens) */
export const COMPACTION_TOKEN_THRESHOLD = 48_000;

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type TodoPriority = "high" | "medium" | "low";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
}

export interface ToolCallSignature {
  name: string;
  argsJson: string;
}

export function normalizeArgsJson(args: unknown): string {
  try {
    return JSON.stringify(args ?? {});
  } catch {
    return String(args);
  }
}

/**
 * Mirrors Kilo Code's processor.ts doom-loop check:
 * Returns true if the last `threshold` tool calls are identical to the incoming call
 * (i.e. executing this call would be the (threshold + 1)-th consecutive identical invocation,
 * or when checking `recentCalls` including the current call of length >= threshold).
 */
export function isDoomLoop(
  recentCalls: readonly ToolCallSignature[],
  incoming: ToolCallSignature,
  threshold = DOOM_LOOP_THRESHOLD,
): boolean {
  if (recentCalls.length < threshold) return false;
  const tail = recentCalls.slice(-threshold);
  return tail.every((c) => c.name === incoming.name && c.argsJson === incoming.argsJson);
}

/**
 * Mirrors Kilo Code's retry.ts transient error classification mapped to LadeStack's StreamError.
 */
export function isRetryableStreamError(code: StreamError): boolean {
  return (
    code === "rate-limit" ||
    code === "unavailable" ||
    code === "network" ||
    code === "timeout" ||
    code === "interrupted"
  );
}

/**
 * Mirrors Kilo Code's retry.ts exponential backoff with 25% jitter.
 */
export function retryDelayMs(attempt: number, random = Math.random()): number {
  const base = RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, Math.max(0, attempt - 1));
  const jittered = Math.ceil(base + base * RETRY_JITTER_FACTOR * random);
  return Math.min(jittered, RETRY_MAX_DELAY_NO_HEADERS);
}

export function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Mirrors Kilo Code's tool/truncate.ts output limiter.
 */
export function truncateOutput(
  text: string,
  options: { maxLines?: number; maxBytes?: number; direction?: "head" | "tail" } = {},
): { content: string; truncated: boolean } {
  const maxLines = options.maxLines ?? TRUNCATE_MAX_LINES;
  const maxBytes = options.maxBytes ?? TRUNCATE_MAX_BYTES;
  const direction = options.direction ?? "head";
  const encoder = new TextEncoder();
  const lines = text.split("\n");
  const totalBytes = encoder.encode(text).length;

  if (lines.length <= maxLines && totalBytes <= maxBytes) {
    return { content: text, truncated: false };
  }

  const out: string[] = [];
  let bytes = 0;
  let hitBytes = false;

  if (direction === "head") {
    for (let i = 0; i < lines.length && i < maxLines; i++) {
      const size = encoder.encode(lines[i]!).length + (i > 0 ? 1 : 0);
      if (bytes + size > maxBytes) {
        hitBytes = true;
        break;
      }
      out.push(lines[i]!);
      bytes += size;
    }
  } else {
    for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
      const size = encoder.encode(lines[i]!).length + (out.length > 0 ? 1 : 0);
      if (bytes + size > maxBytes) {
        hitBytes = true;
        break;
      }
      out.unshift(lines[i]!);
      bytes += size;
    }
  }

  const removed = hitBytes ? totalBytes - bytes : lines.length - out.length;
  const unit = hitBytes ? "bytes" : "lines";
  const note = `\n\n[Output truncated: ${removed} ${unit} omitted to stay within context budget. Narrow your query or use read_file with offset/limit.]`;
  return { content: `${out.join("\n")}${note}`, truncated: true };
}

/** Rough token estimator (~4 chars per token) matching Kilo Code's Token.estimate(). */
export function estimateTokens(text: string): number {
  return Math.max(0, Math.ceil(text.length / 4));
}

export function shouldCompact(
  estimatedTokens: number,
  threshold = COMPACTION_TOKEN_THRESHOLD,
): boolean {
  return estimatedTokens >= threshold;
}

export interface PersistedTurn {
  role: "user" | "assistant";
  content: string;
  at: string;
}

export interface CustomModeConfig {
  name: string;
  instructions: string;
  permissions: CustomModePermissions;
}

export interface PersistedAgentSession {
  version: 1;
  projectId: string;
  mode: KiloAgentMode;
  preset: PermissionPreset;
  turns: PersistedTurn[];
  todos: TodoItem[];
  compactedSummary?: string;
  updatedAt: string;
}

const SESSION_PREFIX = "ladestack.agent.session.v1.";
const CUSTOM_MODE_KEY = "ladestack.agent.customMode.v1";
const MAX_STORED_TURNS = 40;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function getStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function defaultCustomModeConfig(): CustomModeConfig {
  return {
    name: "Custom",
    instructions:
      "You are a focused specialist agent. Read files carefully, explain trade-offs concisely, and make clean minimal edits.",
    permissions: {
      allowWrites: true,
      allowDeletes: false,
      allowPreview: true,
      allowSubagents: true,
    },
  };
}

export function loadCustomModeConfig(storage?: StorageLike): CustomModeConfig {
  const s = getStorage(storage);
  if (!s) return defaultCustomModeConfig();
  try {
    const raw = s.getItem(CUSTOM_MODE_KEY);
    if (!raw) return defaultCustomModeConfig();
    const parsed = JSON.parse(raw) as Partial<CustomModeConfig>;
    const def = defaultCustomModeConfig();
    return {
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : def.name,
      instructions:
        typeof parsed.instructions === "string" ? parsed.instructions : def.instructions,
      permissions: {
        allowWrites: parsed.permissions?.allowWrites ?? def.permissions.allowWrites,
        allowDeletes: parsed.permissions?.allowDeletes ?? def.permissions.allowDeletes,
        allowPreview: parsed.permissions?.allowPreview ?? def.permissions.allowPreview,
        allowSubagents: parsed.permissions?.allowSubagents ?? def.permissions.allowSubagents,
      },
    };
  } catch {
    return defaultCustomModeConfig();
  }
}

export function saveCustomModeConfig(config: CustomModeConfig, storage?: StorageLike): void {
  const s = getStorage(storage);
  if (!s) return;
  try {
    s.setItem(CUSTOM_MODE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadAgentSession(
  projectId: string,
  storage?: StorageLike,
): PersistedAgentSession | null {
  const s = getStorage(storage);
  if (!s || !projectId) return null;
  try {
    const raw = s.getItem(SESSION_PREFIX + projectId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedAgentSession>;
    if (parsed.version !== 1 || parsed.projectId !== projectId) return null;
    return {
      version: 1,
      projectId,
      mode: parsed.mode ?? "code",
      preset: parsed.preset ?? "balanced",
      turns: Array.isArray(parsed.turns) ? parsed.turns.slice(-MAX_STORED_TURNS) : [],
      todos: Array.isArray(parsed.todos) ? parsed.todos : [],
      compactedSummary:
        typeof parsed.compactedSummary === "string" ? parsed.compactedSummary : undefined,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveAgentSession(
  session: Omit<PersistedAgentSession, "version" | "updatedAt">,
  storage?: StorageLike,
): void {
  const s = getStorage(storage);
  if (!s || !session.projectId) return;
  try {
    const payload: PersistedAgentSession = {
      ...session,
      version: 1,
      turns: session.turns.slice(-MAX_STORED_TURNS),
      updatedAt: new Date().toISOString(),
    };
    s.setItem(SESSION_PREFIX + session.projectId, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearAgentSession(projectId: string, storage?: StorageLike): void {
  const s = getStorage(storage);
  if (!s || !projectId) return;
  try {
    s.removeItem(SESSION_PREFIX + projectId);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Deterministic fallback compaction summary when compacting locally without an extra LLM call.
 */
export function buildLocalCompactionSummary(
  turns: readonly PersistedTurn[],
  todos: readonly TodoItem[],
): string {
  const userGoals = turns
    .filter((t) => t.role === "user")
    .slice(-5)
    .map((t) => `- ${t.content.replace(/\s+/g, " ").slice(0, 180)}`);
  const assistantNotes = turns
    .filter((t) => t.role === "assistant")
    .slice(-4)
    .map((t) => `- ${t.content.replace(/\s+/g, " ").slice(0, 220)}`);
  const openTodos = todos
    .filter((t) => t.status === "pending" || t.status === "in_progress")
    .map((t) => `- [${t.status}] (${t.priority}) ${t.content}`);

  return [
    "## Compacted Session Context",
    userGoals.length ? `### Recent User Requests\n${userGoals.join("\n")}` : "",
    assistantNotes.length ? `### Recent Agent Findings & Actions\n${assistantNotes.join("\n")}` : "",
    openTodos.length ? `### Open Todos\n${openTodos.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
