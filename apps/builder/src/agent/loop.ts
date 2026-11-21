import { ProviderStreamError, type StreamError } from "../providers/stream";
import type { Conversation, StepDelta, StepResult } from "./adapters";
import {
  KILO_ASK_PROMPT,
  KILO_CODE_PROMPT,
  KILO_DEBUG_PROMPT,
  KILO_ORCHESTRATOR_PROMPT,
  KILO_PLAN_PROMPT,
  systemPromptForMode,
} from "./kilocode/prompts";
import {
  DOOM_LOOP_THRESHOLD,
  isDoomLoop,
  isRetryableStreamError,
  normalizeArgsJson,
  retryDelayMs,
  sleepAbortable,
  type TodoItem,
  type ToolCallSignature,
} from "./kilocode/session";
import {
  runTool,
  type AgentFs,
  type AgentMode,
  type ToolContext,
  type ToolResult,
} from "./tools";

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; result: ToolResult }
  | { type: "retry"; attempt: number; delayMs: number; code: StreamError }
  | { type: "todo"; todos: TodoItem[] }
  | { type: "mode-switch"; mode: AgentMode; note?: string };

export type AgentOutcome =
  | { reason: "done" }
  | { reason: "stopped" }
  | { reason: "max-steps"; steps: number }
  | { reason: "error"; code: StreamError };

export const defaultMaxSteps = 30;

/**
 * Kilo Code-compatible agent execution loop:
 * - Exponential backoff retries on transient stream errors (429/5xx/network/timeout/interrupted)
 * - Doom-loop detection (DOOM_LOOP_THRESHOLD = 3 consecutive identical tool calls)
 * - Granular permission evaluation with session-scoped Always Allow overrides
 * - Live todo updates, interactive questions, subagent delegation, and Plan/Code mode switching
 */
export async function runAgent(o: {
  conversation: Conversation;
  fs: AgentFs;
  projectId: string;
  signal?: AbortSignal;
  maxSteps?: number;
  /** Maximum transient provider retries (Kilo Code retry engine). Defaults to 0 for direct callers. */
  maxRetries?: number;
  /** Optional custom backoff delay fn (for deterministic testing). */
  retryDelay?: (attempt: number) => number;
  onEvent: (e: AgentEvent) => void;
  approve?: ToolContext["approve"];
  mode?: ToolContext["mode"];
  permissionPreset?: ToolContext["permissionPreset"];
  ruleset?: ToolContext["ruleset"];
  customPermissions?: ToolContext["customPermissions"];
  sessionRules?: ToolContext["sessionRules"];
  onRememberAllow?: ToolContext["onRememberAllow"];
  checkPreview?: ToolContext["checkPreview"];
  getTodos?: ToolContext["getTodos"];
  setTodos?: ToolContext["setTodos"];
  askQuestion?: ToolContext["askQuestion"];
  runSubagent?: ToolContext["runSubagent"];
  /** Streams each turn and reports progress (live text, files being written). */
  onDelta?: (d: StepDelta) => void;
}): Promise<AgentOutcome> {
  const maxSteps = o.maxSteps ?? defaultMaxSteps;
  const maxRetries = o.maxRetries ?? 0;
  let activeMode: AgentMode = o.mode ?? "code";
  const recentCalls: ToolCallSignature[] = [];

  for (let step = 0; step < maxSteps; step++) {
    if (o.signal?.aborted) return { reason: "stopped" };

    let result: StepResult | undefined;
    let attempt = 0;
    while (true) {
      try {
        result = await o.conversation.step(o.signal, o.onDelta);
        break;
      } catch (e) {
        const code = e instanceof ProviderStreamError ? e.code : "unexpected";
        if (code === "aborted" || o.signal?.aborted) return { reason: "stopped" };
        if (attempt < maxRetries && isRetryableStreamError(code)) {
          attempt++;
          const waitMs = o.retryDelay ? o.retryDelay(attempt) : retryDelayMs(attempt);
          o.onEvent({ type: "retry", attempt, delayMs: waitMs, code });
          try {
            await sleepAbortable(waitMs, o.signal);
          } catch {
            return { reason: "stopped" };
          }
          continue;
        }
        return { reason: "error", code };
      }
    }

    if (result.text.trim()) o.onEvent({ type: "text", text: result.text.trim() });
    if (result.calls.length === 0) return { reason: "done" };

    const results: ToolResult[] = [];
    for (const call of result.calls) {
      if (o.signal?.aborted) return { reason: "stopped" };

      const sig: ToolCallSignature = { name: call.name, argsJson: normalizeArgsJson(call.args) };
      if (isDoomLoop(recentCalls, sig, DOOM_LOOP_THRESHOLD)) {
        let allowContinue = false;
        if (o.approve) {
          try {
            const dec = await o.approve({
              tool: "doom_loop",
              path: call.name,
              detail: `Repeated identical call (${DOOM_LOOP_THRESHOLD}+ times): ${call.name}`,
            });
            allowContinue =
              dec === true || (typeof dec === "object" && dec !== null && dec.allow === true);
          } catch {
            allowContinue = false;
          }
        }
        if (!allowContinue) {
          const halted: ToolResult = {
            call,
            output: `Doom-loop guard triggered: ${call.name} was called ${DOOM_LOOP_THRESHOLD} times consecutively with identical arguments. Stop repeating the same call and try a different approach or explain the blocker to the user.`,
            isError: true,
            path: call.name,
            declined: true,
          };
          o.onEvent({ type: "tool", result: halted });
          results.push(halted);
          continue;
        }
        recentCalls.length = 0;
      }

      let r: ToolResult;
      try {
        r = await runTool(o.fs, o.projectId, call, {
          approve: o.approve,
          mode: activeMode,
          permissionPreset: o.permissionPreset,
          ruleset: o.ruleset,
          customPermissions: o.customPermissions,
          sessionRules: o.sessionRules,
          onRememberAllow: o.onRememberAllow,
          checkPreview: o.checkPreview,
          getTodos: o.getTodos,
          setTodos: (todos) => {
            o.setTodos?.(todos);
            o.onEvent({ type: "todo", todos });
          },
          askQuestion: o.askQuestion,
          runSubagent: o.runSubagent,
          onModeSwitch: (nextMode, note) => {
            activeMode = nextMode;
            o.onEvent({ type: "mode-switch", mode: nextMode, note });
          },
        });
      } catch {
        r = { call, output: "Tool failed unexpectedly.", isError: true };
      }

      recentCalls.push(sig);
      if (recentCalls.length > DOOM_LOOP_THRESHOLD * 2) {
        recentCalls.shift();
      }

      o.onEvent({ type: "tool", result: r });
      results.push(r);
    }

    o.conversation.addResults(results);
  }
  return { reason: "max-steps", steps: maxSteps };
}

export const codeSystemPrompt = KILO_CODE_PROMPT;
export const planSystemPrompt = KILO_PLAN_PROMPT;
export const debugSystemPrompt = KILO_DEBUG_PROMPT;
export const askSystemPrompt = KILO_ASK_PROMPT;
export const orchestratorSystemPrompt = KILO_ORCHESTRATOR_PROMPT;
export { systemPromptForMode };

/** The Code-mode task that builds an approved plan. */
export function buildFromPlanPrompt(request: string, plan: string): string {
  return `Implement this plan for my request.\n\nRequest:\n${request}\n\nPlan:\n${plan}`;
}

/** The Code-mode task that applies a diagnosed fix. */
export function applyFixPrompt(problem: string, diagnosis: string): string {
  return `Apply the smallest fix for this problem, based on the diagnosis.\n\nProblem:\n${problem}\n\nDiagnosis:\n${diagnosis}`;
}
