import { isSafeProjectPath } from "../templates/validate";
import { replace, trimDiff } from "./kilocode/edit";
import {
  deriveNewContentsFromChunks,
  generateUnifiedDiff,
  joinBom,
  parsePatch,
} from "./kilocode/patch";
import {
  evaluate,
  matchWildcard,
  resolve,
  rulesetForMode,
  type CustomModePermissions,
  type KiloAgentMode,
  type PermissionPreset,
  type Ruleset,
  type SubagentType,
} from "./kilocode/permission";
import { truncateOutput, type TodoItem, type TodoPriority, type TodoStatus } from "./kilocode/session";

/** Tools the agent may call (Kilo Code 16-tool browser-native registry). */
export interface ToolSpec {
  name: ToolName;
  description: string;
  /** JSON Schema for the arguments; `null` when the tool takes none. */
  parameters: { type: "object"; properties: Record<string, unknown>; required: string[] } | null;
}

export const toolNames = [
  "list_files",
  "read_file",
  "write_file",
  "edit_file",
  "apply_patch",
  "delete_file",
  "grep_search",
  "glob_files",
  "repo_overview",
  "check_preview",
  "todowrite",
  "todoread",
  "question",
  "task",
  "plan_enter",
  "plan_exit",
] as const;
export type ToolName = (typeof toolNames)[number];

export const agentTools: ToolSpec[] = [
  {
    name: "list_files",
    description: "List every file in the project with its size in bytes.",
    parameters: null,
  },
  {
    name: "read_file",
    description:
      "Read a project file as UTF-8 text. Optionally pass 1-based offset and limit to read a line-numbered slice of a large file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path, e.g. src/App.tsx" },
        offset: { type: "number", description: "Optional 1-based starting line number." },
        limit: { type: "number", description: "Optional maximum number of lines to return." },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Create a file or replace its whole content. Always send the complete file, never a fragment or diff.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path, e.g. src/App.tsx" },
        content: { type: "string", description: "The complete new file content." },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description:
      "Perform a targeted search-and-replace edit in an existing file using Kilo Code's 9-strategy fuzzy matcher. Prefer this over write_file for focused modifications.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path to the existing file." },
        old_string: { type: "string", description: "The exact text snippet to replace." },
        new_string: { type: "string", description: "The replacement text." },
        replace_all: {
          type: "boolean",
          description: "Replace all occurrences instead of requiring a unique match.",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "apply_patch",
    description:
      "Apply a Kilo Code multi-file patch enclosed in '*** Begin Patch' and '*** End Patch' supporting '*** Add File:', '*** Update File:', '*** Move to:', and '*** Delete File:'.",
    parameters: {
      type: "object",
      properties: {
        patch_text: {
          type: "string",
          description: "Complete patch starting with '*** Begin Patch' and ending with '*** End Patch'.",
        },
      },
      required: ["patch_text"],
    },
  },
  {
    name: "delete_file",
    description:
      "Delete a project file. The user is asked to approve deletion unless auto-approved; if declined, do not retry.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Project-relative path to delete" } },
      required: ["path"],
    },
  },
  {
    name: "grep_search",
    description:
      "Search file contents across the project using a regular expression. Returns matching path:line: content entries.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regular expression pattern to search for." },
        include: {
          type: "string",
          description: "Optional glob filter for file paths, e.g. 'src/**/*.tsx' or '*.css'.",
        },
        case_sensitive: {
          type: "boolean",
          description: "Whether the regex is case-sensitive (default false).",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "glob_files",
    description: "Find project files whose paths match a glob pattern such as 'src/**/*.ts' or '*.json'.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern to match against project-relative paths." },
      },
      required: ["pattern"],
    },
  },
  {
    name: "repo_overview",
    description:
      "Summarize the project structure: file count, extension breakdown, key entry/config files, and line counts.",
    parameters: null,
  },
  {
    name: "check_preview",
    description:
      "Load the project's saved files in the live preview and return what the page's console reported after it settled: errors, warnings, logs and files that failed to load. Use it after writing files to check your work. Projects with package.json are bundled in the browser (packages from esm.sh) and build errors are reported too.",
    parameters: null,
  },
  {
    name: "todowrite",
    description:
      "Create or update the structured task checklist for this session. Keep at most one item in_progress at a time and mark items completed immediately.",
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "Complete updated list of todo items.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              content: { type: "string" },
              status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"] },
              priority: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["id", "content", "status", "priority"],
          },
        },
      },
      required: ["todos"],
    },
  },
  {
    name: "todoread",
    description: "Read the current session todo checklist.",
    parameters: null,
  },
  {
    name: "question",
    description:
      "Ask the user a structured clarifying question with selectable options before proceeding on an ambiguous requirement.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The clear question to ask the user." },
        options: {
          type: "array",
          description: "Optional 2-5 short selectable options.",
          items: { type: "string" },
        },
      },
      required: ["question"],
    },
  },
  {
    name: "task",
    description:
      "Delegate a focused subtask to a specialized Kilo Code subagent ('explore' for fast read-only search, 'scout' for architectural analysis, 'general' for scoped implementation).",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "Short 3-6 word summary of the subtask." },
        prompt: { type: "string", description: "Complete self-contained instructions for the subagent." },
        subagent_type: {
          type: "string",
          enum: ["explore", "scout", "general"],
          description: "Specialized subagent role.",
        },
      },
      required: ["description", "prompt", "subagent_type"],
    },
  },
  {
    name: "plan_enter",
    description: "Switch the active session into read-only Plan mode to design before making changes.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Optional reason for entering Plan mode." },
      },
      required: [],
    },
  },
  {
    name: "plan_exit",
    description: "Signal that planning is complete and offer to switch into Code mode to execute the plan.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Short summary of the approved plan." },
      },
      required: [],
    },
  },
];

/**
 * Full Kilo Code primary agent modes.
 */
export type AgentMode = KiloAgentMode;

const modeLabel: Record<AgentMode, string> = {
  code: "Code",
  plan: "Plan",
  debug: "Debug",
  ask: "Ask",
  orchestrator: "Orchestrator",
  custom: "Custom",
};

/** The tool specs a mode may offer the model (derived directly from Kilo Code's permission ruleset). */
export function toolsForMode(
  mode: AgentMode,
  preset: PermissionPreset = "balanced",
  customPerms?: CustomModePermissions,
): ToolSpec[] {
  const ruleset = rulesetForMode(mode, preset, customPerms);
  return agentTools.filter((t) => evaluate(t.name, "*", ruleset).action !== "deny");
}

/** Tool specs allowed for a hardened Kilo Code subagent. */
export function toolsForRuleset(ruleset: Ruleset): ToolSpec[] {
  return agentTools.filter((t) => evaluate(t.name, "*", ruleset).action !== "deny");
}

export type ApprovalDecision = boolean | { allow: boolean; always?: boolean };

/** An action that needs the user's explicit Allow once / Always allow / Deny decision. */
export interface ApprovalRequest {
  tool: ToolName | "doom_loop";
  path: string;
  detail?: string;
}

export interface QuestionRequest {
  question: string;
  options: string[];
}

export interface SubagentRequest {
  description: string;
  prompt: string;
  subagentType: SubagentType;
}

export interface ToolContext {
  /** Defaults to "code". Enforced in code by Kilo Code's permission engine. */
  mode?: AgentMode;
  /** Permission preset: balanced (default), manual (ask all writes), auto (allow all). */
  permissionPreset?: PermissionPreset;
  /** Optional explicit ruleset override (used by hardened subagents). */
  ruleset?: Ruleset;
  /** Custom mode permission toggles when mode === "custom". */
  customPermissions?: CustomModePermissions;
  /** Session-scoped "Always allow" overrides; never escalates a base "deny". */
  sessionRules?: Ruleset;
  /** Called when the user selects "Always allow" so caller can record the session rule. */
  onRememberAllow?: (tool: ToolName, pattern: string) => void;
  /** Resolves true / { allow: true } only on explicit allow. Missing, aborted or silent means denied. */
  approve?: (request: ApprovalRequest) => Promise<ApprovalDecision>;
  /** Reloads the live preview and reports its console; missing means no preview here. */
  checkPreview?: () => Promise<{ ok: boolean; report: string }>;
  /** Current session todo list & updater. */
  getTodos?: () => TodoItem[];
  setTodos?: (todos: TodoItem[]) => void;
  /** Interactive question handler. */
  askQuestion?: (req: QuestionRequest) => Promise<string | null>;
  /** Subagent delegation runner (`task` tool). */
  runSubagent?: (req: SubagentRequest) => Promise<{ output: string; touchedPaths?: string[] }>;
  /** Mode switch callback for plan_enter / plan_exit. */
  onModeSwitch?: (nextMode: AgentMode, note?: string) => void;
}

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface ToolResult {
  call: ToolCall;
  output: string;
  isError: boolean;
  /** For the activity log: which file or target this call touched. */
  path?: string;
  /** All project file paths created/modified/deleted by multi-file tools (apply_patch, task). */
  touchedPaths?: string[];
  /** Unified diff preview for edit_file / apply_patch. */
  diff?: string;
  /** The user said no to an approval. */
  declined?: boolean;
}

/** The storage the agent works through; satisfied by ProjectStore. */
export interface AgentFs {
  listFiles(projectId: string): Promise<{ path: string; size: number; revision: string }[]>;
  readFile(
    projectId: string,
    path: string,
  ): Promise<{ file: { revision: string }; content: string } | undefined>;
  writeFile(
    projectId: string,
    path: string,
    content: string,
    baseRevision: string | null,
  ): Promise<{ ok: true } | { ok: false; reason: string }>;
  deleteFile(
    projectId: string,
    path: string,
    baseRevision: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }>;
}

export const maxWriteBytes = 2 * 1024 * 1024;
export const maxProjectFiles = 2000;
const maxReadChars = 200_000;

const byteLength = (s: string) => new TextEncoder().encode(s).length;
const fail = (call: ToolCall, output: string, path?: string): ToolResult => ({
  call,
  output,
  isError: true,
  path,
});

function stringArg(args: unknown, key: string): string | undefined {
  const v = (args as Record<string, unknown> | null)?.[key];
  return typeof v === "string" ? v : undefined;
}

function numberArg(args: unknown, key: string): number | undefined {
  const v = (args as Record<string, unknown> | null)?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function booleanArg(args: unknown, key: string): boolean | undefined {
  const v = (args as Record<string, unknown> | null)?.[key];
  return typeof v === "boolean" ? v : undefined;
}

async function checkPermission(
  tool: ToolName,
  pattern: string,
  ctx: ToolContext,
  detail?: string,
): Promise<"allow" | "deny" | "declined"> {
  const mode = ctx.mode ?? "code";
  const baseRules =
    ctx.ruleset ?? rulesetForMode(mode, ctx.permissionPreset ?? "balanced", ctx.customPermissions);
  const resolved = resolve(tool, pattern, baseRules, ...(ctx.sessionRules ? [ctx.sessionRules] : []));
  if (resolved.action === "deny") return "deny";
  if (resolved.action === "allow") return "allow";

  let decision: ApprovalDecision = false;
  try {
    decision = (await ctx.approve?.({ tool, path: pattern, detail })) ?? false;
  } catch {
    decision = false;
  }

  if (decision === true) return "allow";
  if (decision && typeof decision === "object" && decision.allow === true) {
    if (decision.always) {
      ctx.onRememberAllow?.(tool, "*");
    }
    return "allow";
  }
  return "declined";
}

function parseTodosArg(args: unknown): TodoItem[] | null {
  const raw = (args as Record<string, unknown> | null)?.todos;
  if (!Array.isArray(raw)) return null;
  const validStatus = new Set<TodoStatus>(["pending", "in_progress", "completed", "cancelled"]);
  const validPriority = new Set<TodoPriority>(["high", "medium", "low"]);
  const items: TodoItem[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") return null;
    const obj = item as Record<string, unknown>;
    const content = typeof obj.content === "string" ? obj.content.trim() : "";
    if (!content) return null;
    const id = typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : `todo-${i + 1}`;
    const status = validStatus.has(obj.status as TodoStatus)
      ? (obj.status as TodoStatus)
      : "pending";
    const priority = validPriority.has(obj.priority as TodoPriority)
      ? (obj.priority as TodoPriority)
      : "medium";
    items.push({ id, content, status, priority });
  }
  return items;
}

/**
 * Runs one validated tool call against the project using Kilo Code's permission engine
 * and tool implementations. Every argument is validated in app code, never trusted from the model.
 */
export async function runTool(
  fs: AgentFs,
  projectId: string,
  call: ToolCall,
  ctx: ToolContext = {},
): Promise<ToolResult> {
  const mode = ctx.mode ?? "code";
  const baseRules =
    ctx.ruleset ?? rulesetForMode(mode, ctx.permissionPreset ?? "balanced", ctx.customPermissions);

  // Hard mode deny check before any side effects or prompts (Kilo Code resolve invariant)
  if ((toolNames as readonly string[]).includes(call.name)) {
    const baseDecision = evaluate(call.name, "*", baseRules);
    if (baseDecision.action === "deny") {
      return fail(
        call,
        `${call.name} is not allowed in ${modeLabel[mode]} mode. Switch modes or delegate via an allowed tool instead.`,
        stringArg(call.args, "path"),
      );
    }
  }

  switch (call.name) {
    case "list_files": {
      const files = await fs.listFiles(projectId);
      const output = files.length
        ? files.map((f) => `${f.path} (${f.size} bytes)`).join("\n")
        : "(no files)";
      return { call, output: truncateOutput(output).content, isError: false };
    }

    case "read_file": {
      const path = stringArg(call.args, "path");
      if (!path || !isSafeProjectPath(path)) return fail(call, "Invalid path.", path);
      const read = await fs.readFile(projectId, path);
      if (!read) return fail(call, `File not found: ${path}`, path);
      const offset = numberArg(call.args, "offset");
      const limit = numberArg(call.args, "limit");
      if (offset !== undefined || limit !== undefined) {
        const lines = read.content.split("\n");
        const start = Math.max(1, Math.floor(offset ?? 1));
        const count = Math.max(1, Math.floor(limit ?? 200));
        const slice = lines.slice(start - 1, start - 1 + count);
        const numbered = slice.map((line, i) => `${start + i}: ${line}`).join("\n");
        const header = `[${path}: lines ${start}-${start + slice.length - 1} of ${lines.length}]\n`;
        return { call, output: truncateOutput(header + numbered).content, isError: false, path };
      }
      const output =
        read.content.length > maxReadChars
          ? `${read.content.slice(0, maxReadChars)}\n[truncated: file is ${read.content.length} characters]`
          : read.content;
      return { call, output, isError: false, path };
    }

    case "write_file": {
      const path = stringArg(call.args, "path");
      const content = stringArg(call.args, "content");
      if (!path || !isSafeProjectPath(path))
        return fail(
          call,
          "Invalid path. Use a relative path; secrets files, .git and node_modules are not allowed.",
          path,
        );
      if (content === undefined) return fail(call, "Missing content.", path);
      if (content.includes("\0")) return fail(call, "Binary content is not allowed.", path);
      if (byteLength(content) > maxWriteBytes) return fail(call, "File is larger than 2 MB.", path);

      const perm = await checkPermission("write_file", path, ctx);
      if (perm !== "allow") {
        return {
          call,
          output: `The user declined writing ${path}. Do not retry.`,
          isError: true,
          path,
          declined: perm === "declined",
        };
      }

      const existing = await fs.readFile(projectId, path);
      if (!existing && (await fs.listFiles(projectId)).length >= maxProjectFiles)
        return fail(call, `Project already has ${maxProjectFiles} files.`, path);
      if (existing?.content === content)
        return { call, output: `Unchanged: ${path}`, isError: false, path };
      const result = await fs.writeFile(projectId, path, content, existing?.file.revision ?? null);
      if (!result.ok)
        return fail(
          call,
          result.reason === "conflict"
            ? "The file changed while writing. Read it again, then retry."
            : "Write failed.",
          path,
        );
      return {
        call,
        output: `${existing ? "Updated" : "Created"} ${path}`,
        isError: false,
        path,
        touchedPaths: [path],
      };
    }

    case "edit_file": {
      const path = stringArg(call.args, "path");
      const oldString = stringArg(call.args, "old_string");
      const newString = stringArg(call.args, "new_string");
      const replaceAll = booleanArg(call.args, "replace_all") ?? false;
      if (!path || !isSafeProjectPath(path)) return fail(call, "Invalid path.", path);
      if (oldString === undefined || newString === undefined)
        return fail(call, "Missing old_string or new_string.", path);
      if (newString.includes("\0")) return fail(call, "Binary content is not allowed.", path);

      const existing = await fs.readFile(projectId, path);
      if (!existing) return fail(call, `File not found: ${path}`, path);

      const perm = await checkPermission("edit_file", path, ctx);
      if (perm !== "allow") {
        return {
          call,
          output: `The user declined editing ${path}. Do not retry.`,
          isError: true,
          path,
          declined: perm === "declined",
        };
      }

      let updated: string;
      try {
        updated = replace(existing.content, oldString, newString, replaceAll);
      } catch (e) {
        return fail(call, e instanceof Error ? e.message : "Edit failed.", path);
      }

      if (byteLength(updated) > maxWriteBytes) return fail(call, "File is larger than 2 MB.", path);
      const writeRes = await fs.writeFile(projectId, path, updated, existing.file.revision);
      if (!writeRes.ok)
        return fail(call, "The file changed while editing. Read it again, then retry.", path);
      const diff = trimDiff(generateUnifiedDiff(existing.content, updated));
      return {
        call,
        output: `Edited ${path}\n${truncateOutput(diff, { maxLines: 120, maxBytes: 8192 }).content}`,
        isError: false,
        path,
        touchedPaths: [path],
        diff,
      };
    }

    case "apply_patch": {
      const patchText = stringArg(call.args, "patch_text");
      if (!patchText?.trim()) return fail(call, "Missing patch_text.");
      let hunks;
      try {
        hunks = parsePatch(patchText).hunks;
      } catch (e) {
        return fail(call, e instanceof Error ? e.message : "Invalid patch format.");
      }
      if (hunks.length === 0) return fail(call, "Patch contains no file hunks.");

      // Validate all paths first before touching storage
      for (const hunk of hunks) {
        if (!isSafeProjectPath(hunk.path)) return fail(call, `Invalid path: ${hunk.path}`, hunk.path);
        if (hunk.type === "update" && hunk.move_path && !isSafeProjectPath(hunk.move_path))
          return fail(call, `Invalid move path: ${hunk.move_path}`, hunk.move_path);
        if (hunk.type === "add" && hunk.contents.includes("\0"))
          return fail(call, "Binary content is not allowed.", hunk.path);
      }

      const patchTarget = hunks.map((h) => h.path).join(", ");
      const hasDelete = hunks.some((h) => h.type === "delete");
      const perm = await checkPermission(hasDelete ? "delete_file" : "apply_patch", patchTarget, ctx);
      if (perm !== "allow") {
        return {
          call,
          output: `The user declined applying patch to ${patchTarget}. Do not retry.`,
          isError: true,
          path: patchTarget,
          declined: perm === "declined",
        };
      }

      const added: string[] = [];
      const modified: string[] = [];
      const deleted: string[] = [];
      const diffs: string[] = [];

      for (const hunk of hunks) {
        if (hunk.type === "add") {
          if (byteLength(hunk.contents) > maxWriteBytes)
            return fail(call, `File is larger than 2 MB: ${hunk.path}`, hunk.path);
          const existing = await fs.readFile(projectId, hunk.path);
          const wr = await fs.writeFile(
            projectId,
            hunk.path,
            hunk.contents,
            existing?.file.revision ?? null,
          );
          if (!wr.ok) return fail(call, `Failed to add ${hunk.path}`, hunk.path);
          added.push(hunk.path);
        } else if (hunk.type === "delete") {
          const existing = await fs.readFile(projectId, hunk.path);
          if (!existing) return fail(call, `File not found: ${hunk.path}`, hunk.path);
          const dr = await fs.deleteFile(projectId, hunk.path, existing.file.revision);
          if (!dr.ok) return fail(call, `Failed to delete ${hunk.path}`, hunk.path);
          deleted.push(hunk.path);
        } else {
          const existing = await fs.readFile(projectId, hunk.path);
          if (!existing) return fail(call, `File not found: ${hunk.path}`, hunk.path);
          let fileUpdate;
          try {
            fileUpdate = deriveNewContentsFromChunks(hunk.path, hunk.chunks, existing.content);
          } catch (e) {
            return fail(call, e instanceof Error ? e.message : `Failed patching ${hunk.path}`, hunk.path);
          }
          const finalContent = joinBom(fileUpdate.content, fileUpdate.bom);
          if (byteLength(finalContent) > maxWriteBytes)
            return fail(call, `File is larger than 2 MB: ${hunk.path}`, hunk.path);
          if (hunk.move_path) {
            const destExisting = await fs.readFile(projectId, hunk.move_path);
            const wr = await fs.writeFile(
              projectId,
              hunk.move_path,
              finalContent,
              destExisting?.file.revision ?? null,
            );
            if (!wr.ok) return fail(call, `Failed moving to ${hunk.move_path}`, hunk.move_path);
            const dr = await fs.deleteFile(projectId, hunk.path, existing.file.revision);
            if (!dr.ok) return fail(call, `Failed removing source ${hunk.path}`, hunk.path);
            modified.push(hunk.move_path);
            deleted.push(hunk.path);
          } else {
            const wr = await fs.writeFile(projectId, hunk.path, finalContent, existing.file.revision);
            if (!wr.ok) return fail(call, `Failed updating ${hunk.path}`, hunk.path);
            modified.push(hunk.path);
          }
          if (fileUpdate.unified_diff) {
            diffs.push(`--- ${hunk.path}\n${trimDiff(fileUpdate.unified_diff)}`);
          }
        }
      }

      const touchedPaths = [...new Set([...added, ...modified, ...deleted])];
      const summary = [
        added.length ? `Added: ${added.join(", ")}` : "",
        modified.length ? `Updated: ${modified.join(", ")}` : "",
        deleted.length ? `Deleted: ${deleted.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; ");
      return {
        call,
        output: summary || "Patch applied.",
        isError: false,
        path: touchedPaths.length === 1 ? touchedPaths[0] : `${touchedPaths.length} files`,
        touchedPaths,
        diff: diffs.join("\n"),
      };
    }

    case "delete_file": {
      const path = stringArg(call.args, "path");
      if (!path || !isSafeProjectPath(path)) return fail(call, "Invalid path.", path);
      if (!(await fs.readFile(projectId, path))) return fail(call, `File not found: ${path}`, path);
      const perm = await checkPermission("delete_file", path, ctx);
      if (perm !== "allow")
        return {
          call,
          output: `The user declined deleting ${path}. Do not retry.`,
          isError: true,
          path,
          declined: true,
        };
      const current = await fs.readFile(projectId, path);
      if (!current) return fail(call, `File not found: ${path}`, path);
      const result = await fs.deleteFile(projectId, path, current.file.revision);
      if (!result.ok)
        return fail(call, "The file changed while deleting. Read it again first.", path);
      return { call, output: `Deleted ${path}`, isError: false, path, touchedPaths: [path] };
    }

    case "grep_search": {
      const pattern = stringArg(call.args, "pattern");
      const include = stringArg(call.args, "include");
      const caseSensitive = booleanArg(call.args, "case_sensitive") ?? false;
      if (!pattern) return fail(call, "Missing pattern.");
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, caseSensitive ? "g" : "gi");
      } catch (e) {
        return fail(call, `Invalid regex: ${e instanceof Error ? e.message : pattern}`);
      }
      const files = await fs.listFiles(projectId);
      const matches: string[] = [];
      const maxMatches = 200;

      for (const f of files) {
        if (include && !matchWildcard(f.path, include)) continue;
        const read = await fs.readFile(projectId, f.path);
        if (!read) continue;
        const lines = read.content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          regex.lastIndex = 0;
          if (regex.test(lines[i]!)) {
            matches.push(`${f.path}:${i + 1}: ${lines[i]!.trim().slice(0, 200)}`);
            if (matches.length >= maxMatches) break;
          }
        }
        if (matches.length >= maxMatches) break;
      }

      const output = matches.length
        ? matches.join("\n") + (matches.length >= maxMatches ? "\n[truncated at 200 matches]" : "")
        : `No matches found for /${pattern}/.`;
      return { call, output: truncateOutput(output).content, isError: false, path: pattern };
    }

    case "glob_files": {
      const pattern = stringArg(call.args, "pattern");
      if (!pattern) return fail(call, "Missing pattern.");
      const files = await fs.listFiles(projectId);
      const matched = files.filter((f) => matchWildcard(f.path, pattern)).map((f) => f.path);
      const output = matched.length ? matched.join("\n") : `No files matched '${pattern}'.`;
      return { call, output: truncateOutput(output).content, isError: false, path: pattern };
    }

    case "repo_overview": {
      const files = await fs.listFiles(projectId);
      if (!files.length) return { call, output: "(empty project)", isError: false };
      const byExt = new Map<string, number>();
      let totalBytes = 0;
      const lines: string[] = [];
      for (const f of files) {
        totalBytes += f.size;
        const dot = f.path.lastIndexOf(".");
        const ext = dot > f.path.lastIndexOf("/") ? f.path.slice(dot) : "(no ext)";
        byExt.set(ext, (byExt.get(ext) ?? 0) + 1);
      }
      const extSummary = [...byExt.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([ext, count]) => `${ext}: ${count}`)
        .join(", ");
      lines.push(`Project files: ${files.length} (${totalBytes} bytes)`);
      lines.push(`Extensions: ${extSummary}`);
      lines.push("Files:");
      for (const f of files.slice(0, 120)) {
        lines.push(`- ${f.path} (${f.size} B)`);
      }
      if (files.length > 120) lines.push(`... and ${files.length - 120} more files`);
      return { call, output: truncateOutput(lines.join("\n")).content, isError: false };
    }

    case "check_preview": {
      if (!ctx.checkPreview) return fail(call, "The preview is not available here.");
      const r = await ctx.checkPreview();
      return { call, output: truncateOutput(r.report).content, isError: !r.ok };
    }

    case "todowrite": {
      const todos = parseTodosArg(call.args);
      if (!todos) return fail(call, "Invalid todos array.");
      ctx.setTodos?.(todos);
      const completed = todos.filter((t) => t.status === "completed").length;
      return {
        call,
        output: `Updated todo list (${completed}/${todos.length} completed).`,
        isError: false,
        path: `${completed}/${todos.length}`,
      };
    }

    case "todoread": {
      const todos = ctx.getTodos?.() ?? [];
      const output = todos.length
        ? todos.map((t) => `[${t.status}] (${t.priority}) ${t.id}: ${t.content}`).join("\n")
        : "(no todos)";
      return { call, output, isError: false };
    }

    case "question": {
      const question = stringArg(call.args, "question")?.trim();
      if (!question) return fail(call, "Missing question.");
      const rawOptions = (call.args as Record<string, unknown> | null)?.options;
      const options = Array.isArray(rawOptions)
        ? rawOptions.filter((o): o is string => typeof o === "string" && o.trim().length > 0).slice(0, 6)
        : [];
      if (!ctx.askQuestion) {
        return fail(call, "Interactive question tool is unavailable in this context.");
      }
      const answer = await ctx.askQuestion({ question, options });
      if (answer === null) {
        return {
          call,
          output: "The user dismissed the question without answering.",
          isError: true,
          path: question,
          declined: true,
        };
      }
      return {
        call,
        output: `User answered: ${answer}`,
        isError: false,
        path: question,
      };
    }

    case "task": {
      const description = stringArg(call.args, "description")?.trim();
      const prompt = stringArg(call.args, "prompt")?.trim();
      const subagentType = stringArg(call.args, "subagent_type") as SubagentType | undefined;
      if (!description || !prompt) return fail(call, "Missing description or prompt.");
      if (subagentType !== "explore" && subagentType !== "scout" && subagentType !== "general")
        return fail(call, "Invalid subagent_type. Expected 'explore', 'scout', or 'general'.");
      if (!ctx.runSubagent) return fail(call, "Subagent execution is unavailable here.");
      const perm = await checkPermission("task", `${subagentType}:${description}`, ctx, prompt);
      if (perm !== "allow") {
        return {
          call,
          output: `The user declined running ${subagentType} subagent (${description}).`,
          isError: true,
          path: description,
          declined: perm === "declined",
        };
      }
      const res = await ctx.runSubagent({ description, prompt, subagentType });
      return {
        call,
        output: truncateOutput(res.output).content,
        isError: false,
        path: `${subagentType}: ${description}`,
        touchedPaths: res.touchedPaths,
      };
    }

    case "plan_enter": {
      const reason = stringArg(call.args, "reason");
      ctx.onModeSwitch?.("plan", reason);
      return {
        call,
        output: "Switched to Plan mode (read-only).",
        isError: false,
        path: "plan",
      };
    }

    case "plan_exit": {
      const summary = stringArg(call.args, "summary");
      ctx.onModeSwitch?.("code", summary);
      return {
        call,
        output: "Plan finalized. Ready to implement in Code mode.",
        isError: false,
        path: "code",
      };
    }

    default:
      return fail(call, `Unknown tool: ${call.name}`);
  }
}
