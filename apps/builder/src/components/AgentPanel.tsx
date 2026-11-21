"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { localePrefix, type Locale } from "@ladestack/i18n";
import { createConversation } from "../agent/adapters";
import type { ChatImage } from "../providers/stream";
import {
  applyFixPrompt,
  buildFromPlanPrompt,
  runAgent,
  systemPromptForMode,
  type AgentOutcome,
} from "../agent/loop";
import { projectNameFromPrompt, takePendingTask } from "../agent/handoff";
import {
  toolsForMode,
  toolsForRuleset,
  type AgentMode,
  type ApprovalDecision,
  type ApprovalRequest,
  type QuestionRequest,
  type ToolContext,
} from "../agent/tools";
import {
  rulesetForSubagent,
  type PermissionPreset,
  type Ruleset,
} from "../agent/kilocode/permission";
import { systemPromptForSubagent } from "../agent/kilocode/prompts";
import {
  buildLocalCompactionSummary,
  clearAgentSession,
  estimateTokens,
  loadAgentSession,
  loadCustomModeConfig,
  saveAgentSession,
  saveCustomModeConfig,
  shouldCompact,
  type CustomModeConfig,
  type PersistedTurn,
  type TodoItem,
} from "../agent/kilocode/session";
import { partialStringField } from "../agent/partialJson";
import { agentStrings } from "../i18n/agent";
import { countText } from "../i18n/plural";
import { toolLabel } from "../agent/labels";
import { providerStrings, type ProviderStrings } from "../i18n/providers";
import { isSubmitShortcut } from "../composer/draft";
import { providers } from "../providers/registry";
import { getSession } from "../providers/session";
import type { StreamError } from "../providers/stream";
import { checkAttachments } from "../providers/capability";
import { useProviderSession } from "../providers/useProviderSession";
import { getProjectStore } from "../storage/client";
import styles from "./Workspace.module.css";
import { composeUserMessage } from "../attachments/attach";
import { AttachButton, AttachmentList, useAttachments } from "./Attachments";
import { RecoveryActions } from "./RecoveryActions";

type LogEntry =
  | { kind: "you"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; label: string; error: boolean; runtime?: boolean }
  | {
      kind: "end";
      text: string;
      error: boolean;
      undo?: { checkpointId: string; label: string };
      build?: { request: string; plan: string; mode: "plan" | "debug" };
      failed?: {
        code: StreamError;
        retry: { text: string; mode: AgentMode; images?: ChatImage[] };
      };
    };

const errorKey: Record<Exclude<StreamError, "aborted">, keyof ProviderStrings> = {
  "invalid-key": "invalidKey",
  billing: "billing",
  "rate-limit": "rateLimit",
  unavailable: "unavailable",
  network: "network",
  timeout: "timeout",
  unexpected: "unexpected",
  "no-models": "noModels",
  rejected: "rejected",
  interrupted: "unexpected",
};

const maxPrompt = 20_000;
const PRIMARY_MODES: readonly AgentMode[] = [
  "code",
  "plan",
  "debug",
  "ask",
  "orchestrator",
  "custom",
];

function modeCanModifyFiles(mode: AgentMode, custom: CustomModeConfig): boolean {
  if (mode === "code" || mode === "orchestrator") return true;
  if (mode === "custom") return custom.permissions.allowWrites || custom.permissions.allowDeletes || custom.permissions.allowSubagents;
  return false;
}

/** Bottom activity capsule (PRD A.13): full Kilo Code agent engine over the open project. */
export function AgentPanel({
  locale,
  projectId,
  onWrite,
  onDraft,
  onFilesChanged,
  onRunningChange,
  request,
  checkPreview,
}: {
  locale: Locale;
  projectId: string;
  onWrite: (path: string) => void;
  onDraft?: (draft: { path: string; content: string } | null) => void;
  onFilesChanged: () => void;
  onRunningChange?: (running: boolean) => void;
  request?: { id: number; mode: AgentMode; prompt: string };
  checkPreview?: ToolContext["checkPreview"];
}) {
  const a = agentStrings[locale];
  const at = useAttachments(locale);
  const t = providerStrings[locale];
  const session = useProviderSession();
  const [prompt, setPrompt] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [turns, setTurns] = useState<PersistedTurn[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [compactedSummary, setCompactedSummary] = useState<string | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<AgentMode>("code");
  const [preset, setPreset] = useState<PermissionPreset>("balanced");
  const [customConfig, setCustomConfig] = useState<CustomModeConfig>(() => loadCustomModeConfig());
  const [sessionRules, setSessionRules] = useState<Ruleset>([]);
  const [restoring, setRestoring] = useState(false);

  const sessionRulesRef = useRef<Ruleset>([]);
  sessionRulesRef.current = sessionRules;
  const todosRef = useRef<TodoItem[]>([]);
  todosRef.current = todos;
  const turnsRef = useRef<PersistedTurn[]>([]);
  turnsRef.current = turns;
  const compactedRef = useRef<string | undefined>(undefined);
  compactedRef.current = compactedSummary;
  const customConfigRef = useRef<CustomModeConfig>(customConfig);
  customConfigRef.current = customConfig;

  const runningChange = useRef(onRunningChange);
  runningChange.current = onRunningChange;
  const busy = running || restoring;
  useEffect(() => {
    runningChange.current?.(busy);
  }, [busy]);

  const [approval, setApproval] = useState<{
    req: ApprovalRequest;
    decide: (decision: ApprovalDecision) => void;
  } | null>(null);

  const [pendingQuestion, setPendingQuestion] = useState<{
    req: QuestionRequest;
    answer: (reply: string | null) => void;
  } | null>(null);
  const [questionDraft, setQuestionDraft] = useState("");

  const abort = useRef<AbortController | null>(null);
  const logEnd = useRef<HTMLLIElement>(null);
  const ids = {
    prompt: useId(),
    note: useId(),
    approval: useId(),
    question: useId(),
    preset: useId(),
    customInstructions: useId(),
  };

  useEffect(() => {
    return () => {
      abort.current?.abort();
    };
  }, []);

  // Load persisted Kilo Code session (history, todos, mode, permission preset) per project
  const hydratedProject = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId || hydratedProject.current === projectId) return;
    hydratedProject.current = projectId;
    const saved = loadAgentSession(projectId);
    if (saved) {
      setMode(saved.mode);
      setPreset(saved.preset);
      setTurns(saved.turns);
      setTodos(saved.todos);
      setCompactedSummary(saved.compactedSummary);
      if (saved.turns.length) {
        setLog(
          saved.turns.map((turn) =>
            turn.role === "user"
              ? { kind: "you", text: turn.content }
              : { kind: "text", text: turn.content },
          ),
        );
      }
    } else {
      setTurns([]);
      setTodos([]);
      setCompactedSummary(undefined);
      setLog([]);
    }
    setSessionRules([]);
  }, [projectId]);

  // Persist session changes automatically
  useEffect(() => {
    if (!projectId || hydratedProject.current !== projectId) return;
    saveAgentSession({
      projectId,
      mode,
      preset,
      turns,
      todos,
      compactedSummary,
    });
  }, [projectId, mode, preset, turns, todos, compactedSummary]);

  // Persist custom mode edits
  useEffect(() => {
    saveCustomModeConfig(customConfig);
  }, [customConfig]);

  const estimatedContextTokens = useMemo(() => {
    const historyText = turns.map((turn) => turn.content).join("\n");
    return estimateTokens((compactedSummary ?? "") + "\n" + historyText);
  }, [turns, compactedSummary]);

  // A prompt handed over from the welcome composer runs once, on arrival.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !session) return;
    started.current = true;
    const task = takePendingTask(projectId);
    if (task) {
      setMode(task.mode);
      void run(task.prompt, task.mode, task.images, false);
    }
  }, [session, projectId]);

  // A task from the preview console
  const lastRequest = useRef(0);
  useEffect(() => {
    if (!request || request.id === lastRequest.current) return;
    lastRequest.current = request.id;
    setMode(request.mode);
    if (session && !running) void run(request.prompt, request.mode);
    else setPrompt(request.prompt);
  }, [request]);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "nearest" });
  }, [log]);

  const add = (e: LogEntry) => setLog((l) => [...l, e]);

  // Live progress of the current turn.
  const [live, setLive] = useState<string | null>(null);
  const draftCb = useRef(onDraft);
  draftCb.current = onDraft;
  const pendingDraft = useRef<{ path: string; content: string } | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function queueDraft(d: { path: string; content: string }) {
    pendingDraft.current = d;
    if (draftTimer.current) return;
    draftTimer.current = setTimeout(() => {
      draftTimer.current = null;
      if (pendingDraft.current) draftCb.current?.(pendingDraft.current);
    }, 80);
  }
  function clearDraft() {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = null;
    pendingDraft.current = null;
    draftCb.current?.(null);
  }
  useEffect(
    () => () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    },
    [],
  );

  function endText(
    o: AgentOutcome,
    retry?: { text: string; mode: AgentMode; images?: ChatImage[] },
  ): LogEntry {
    switch (o.reason) {
      case "done":
        return { kind: "end", text: a.done, error: false };
      case "stopped":
        return { kind: "end", text: a.stopped, error: false };
      case "max-steps":
        return { kind: "end", text: a.maxSteps.replace("{steps}", String(o.steps)), error: true };
      case "error":
        return {
          kind: "end",
          text: t[errorKey[o.code === "aborted" ? "unexpected" : o.code]],
          error: true,
          ...(o.code !== "aborted" && retry ? { failed: { code: o.code, retry } } : {}),
        };
    }
  }

  function compactNow() {
    if (running || (!turns.length && !todos.length)) return;
    const summary = buildLocalCompactionSummary(turns, todos);
    setCompactedSummary(summary);
    setTurns((prev) => prev.slice(-4));
    add({ kind: "end", text: a.compactedNotice, error: false });
  }

  function resetSession() {
    if (running) return;
    clearAgentSession(projectId);
    setTurns([]);
    setTodos([]);
    setCompactedSummary(undefined);
    setSessionRules([]);
    setLog([]);
  }

  async function run(text = prompt, runMode: AgentMode = mode, images?: ChatImage[], typed = true) {
    const s = getSession();
    const task = text.trim();
    if (!s || !task || running || (typed && task.length > maxPrompt)) return;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    add({ kind: "you", text: task });
    setPrompt("");
    let wrote = false;
    let failures = 0;

    // Auto-compact if prior context exceeded Kilo Code threshold
    let activeHistory = turnsRef.current;
    let activeSummary = compactedRef.current;
    if (shouldCompact(estimateTokens((activeSummary ?? "") + activeHistory.map((x) => x.content).join("\n")))) {
      activeSummary = buildLocalCompactionSummary(activeHistory, todosRef.current);
      activeHistory = activeHistory.slice(-4);
      setCompactedSummary(activeSummary);
      setTurns(activeHistory);
    }

    try {
      const fs = await getProjectStore();
      let checkpointId: string | undefined;
      if (modeCanModifyFiles(runMode, customConfigRef.current)) {
        try {
          checkpointId = (
            await fs.createCheckpoint(projectId, projectNameFromPrompt(task), "auto-before-ai-edit")
          )?.id;
        } catch {
          checkpointId = undefined;
        }
        if (!checkpointId) {
          add({ kind: "end", text: a.checkpointFailed, error: true });
          return;
        }
      }

      const approveFn: ToolContext["approve"] = (req) =>
        new Promise<ApprovalDecision>((resolve) => {
          if (controller.signal.aborted) return resolve(false);
          const decide = (decision: ApprovalDecision) => {
            controller.signal.removeEventListener("abort", onAbort);
            setApproval(null);
            resolve(decision);
          };
          const onAbort = () => decide(false);
          controller.signal.addEventListener("abort", onAbort);
          setApproval({ req, decide });
        });

      const askQuestionFn: ToolContext["askQuestion"] = (req) =>
        new Promise<string | null>((resolve) => {
          if (controller.signal.aborted) return resolve(null);
          const answer = (reply: string | null) => {
            controller.signal.removeEventListener("abort", onAbort);
            setPendingQuestion(null);
            setQuestionDraft("");
            resolve(reply);
          };
          const onAbort = () => answer(null);
          controller.signal.addEventListener("abort", onAbort);
          setPendingQuestion({ req, answer });
        });

      const rememberAllow: ToolContext["onRememberAllow"] = (tool, pattern) => {
        setSessionRules((prev) => {
          const next: Ruleset = [...prev, { permission: tool, pattern, action: "allow" }];
          sessionRulesRef.current = next;
          return next;
        });
      };

      const runSubagentFn: ToolContext["runSubagent"] = async (subReq) => {
        const subRules = rulesetForSubagent(subReq.subagentType, preset);
        const subTools = toolsForRuleset(subRules);
        const subTexts: string[] = [];
        const touched = new Set<string>();
        await runAgent({
          conversation: createConversation({
            provider: s.provider,
            key: s.key,
            model: s.model,
            system: systemPromptForSubagent(subReq.subagentType),
            prompt: subReq.prompt,
            tools: subTools,
          }),
          fs,
          projectId,
          signal: controller.signal,
          maxSteps: 12,
          maxRetries: 2,
          ruleset: subRules,
          permissionPreset: preset,
          sessionRules: sessionRulesRef.current,
          onRememberAllow: rememberAllow,
          approve: approveFn,
          checkPreview,
          getTodos: () => todosRef.current,
          onEvent: (se) => {
            if (se.type === "text") subTexts.push(se.text);
            if (se.type === "tool" && !se.result.isError && se.result.touchedPaths?.length) {
              for (const p of se.result.touchedPaths) touched.add(p);
            }
          },
        });
        return {
          output: subTexts.join("\n\n") || `Subagent ${subReq.subagentType} finished.`,
          touchedPaths: [...touched],
        };
      };

      let lastAssistantText = "";
      const outcome = await runAgent({
        conversation: createConversation({
          provider: s.provider,
          key: s.key,
          model: s.model,
          system: systemPromptForMode(runMode, customConfigRef.current.instructions),
          prompt: task,
          history: activeHistory,
          compactedSummary: activeSummary,
          images,
          tools: toolsForMode(runMode, preset, customConfigRef.current.permissions),
        }),
        fs,
        projectId,
        checkPreview,
        mode: runMode,
        permissionPreset: preset,
        customPermissions: customConfigRef.current.permissions,
        sessionRules: sessionRulesRef.current,
        onRememberAllow: rememberAllow,
        maxRetries: 3,
        signal: controller.signal,
        getTodos: () => todosRef.current,
        setTodos: (next) => {
          todosRef.current = next;
          setTodos(next);
        },
        askQuestion: askQuestionFn,
        runSubagent: runSubagentFn,
        onDelta: (d) => {
          if (d.type === "text") return setLive(d.text);
          if (d.name !== "write_file") return;
          const path = partialStringField(d.args, "path");
          const content = partialStringField(d.args, "content");
          if (path) setLive(a.writing.replace("{path}", path));
          if (path && content !== undefined) queueDraft({ path, content });
        },
        onEvent: (e) => {
          setLive(null);
          if (e.type === "text") {
            lastAssistantText = e.text;
            return add({ kind: "text", text: e.text });
          }
          if (e.type === "retry") {
            setLive(a.retrying.replace("{attempt}", String(e.attempt)));
            return;
          }
          if (e.type === "todo") {
            todosRef.current = e.todos;
            setTodos(e.todos);
            return;
          }
          if (e.type === "mode-switch") {
            setMode(e.mode);
            return;
          }
          clearDraft();
          const { call, isError, path, touchedPaths } = e.result;
          const label = toolLabel(a, e.result);
          const error = isError && !e.result.declined;
          if (error) failures++;
          add({ kind: "tool", label, error, runtime: error && call.name === "check_preview" });
          if (isError) return;
          if (call.name === "write_file" || call.name === "edit_file") {
            if (path) {
              wrote = true;
              onWrite(path);
            }
          } else if (call.name === "apply_patch" || call.name === "task") {
            if (touchedPaths?.length) {
              wrote = true;
              for (const p of touchedPaths) onWrite(p);
              onFilesChanged();
            }
          } else if (call.name === "delete_file") {
            wrote = true;
            onFilesChanged();
          }
        },
        approve: approveFn,
      });

      // Record persisted multi-turn memory
      const now = new Date().toISOString();
      const nextTurns: PersistedTurn[] = [
        ...activeHistory,
        { role: "user", content: task, at: now },
        ...(lastAssistantText ? [{ role: "assistant" as const, content: lastAssistantText, at: now }] : []),
      ];
      setTurns(nextTurns);

      let end = endText(outcome, { text: task, mode: runMode, images });
      if (outcome.reason === "done" && failures > 0 && end.kind === "end")
        end = {
          ...end,
          text: countText(locale, a.doneWithFailures, failures),
          error: true,
        };
      if (end.kind !== "end") add(end);
      else if ((runMode === "plan" || runMode === "debug") && outcome.reason === "done" && lastAssistantText)
        add({ ...end, build: { request: task, plan: lastAssistantText, mode: runMode } });
      else if (wrote && checkpointId) add({ ...end, undo: { checkpointId, label: a.undo } });
      else add(end);
    } catch {
      add({ kind: "end", text: t.unexpected, error: true });
    } finally {
      if (abort.current === controller) abort.current = null;
      setLive(null);
      clearDraft();
      setRunning(false);
    }
  }

  async function restore(checkpointId: string) {
    if (running || restoring || !window.confirm(a.undoConfirm)) return;
    setRestoring(true);
    try {
      const fs = await getProjectStore();
      const r = await fs.restoreCheckpoint(projectId, checkpointId);
      if (r.ok) {
        add({
          kind: "end",
          text: a.restored,
          error: false,
          undo: { checkpointId: r.safety.id, label: a.undoRestore },
        });
        onFilesChanged();
      } else add({ kind: "end", text: a.restoreFailed, error: true });
    } catch {
      add({ kind: "end", text: a.restoreFailed, error: true });
    } finally {
      setRestoring(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    sendTyped();
  }

  function sendTyped() {
    if (!at.attachments.length) return void run();
    const m = composeUserMessage(prompt.trim(), at.attachments);
    if (!prompt.trim() || running || !getSession()) return;
    if (checkAttachments(getSession(), at.attachments).blocked.length) return;
    at.clear();
    void run(m.content, mode, m.images, false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (isSubmitShortcut({ ...e, isComposing: e.nativeEvent.isComposing })) {
      e.preventDefault();
      sendTyped();
    }
  }

  if (!session) {
    return (
      <section className={styles.agent} aria-label={a.label}>
        <p className={styles.agentNote}>
          {a.needProvider} <Link href={`${localePrefix(locale)}/`}>{a.startPage}</Link>
        </p>
      </section>
    );
  }

  const modeLabels: Record<AgentMode, string> = {
    code: a.modeCode,
    plan: a.modePlan,
    debug: a.modeDebug,
    ask: a.modeAsk,
    orchestrator: a.modeOrchestrator,
    custom: a.modeCustom,
  };

  const modePlaceholders: Record<AgentMode, string> = {
    code: a.placeholder,
    plan: a.planPlaceholder,
    debug: a.debugPlaceholder,
    ask: a.askPlaceholder,
    orchestrator: a.orchestratorPlaceholder,
    custom: a.customPlaceholder,
  };

  const modeNotes: Record<AgentMode, string> = {
    code: "",
    plan: `${a.planNote} `,
    debug: `${a.debugNote} `,
    ask: `${a.askNote} `,
    orchestrator: `${a.orchestratorNote} `,
    custom: `${a.customNote} `,
  };

  const approvalPrompt = approval
    ? approval.req.tool === "delete_file"
      ? a.approveDelete.replace("{path}", approval.req.path)
      : approval.req.tool === "doom_loop"
        ? a.approveDoomLoop.replace("{path}", approval.req.path)
        : a.approveAction
            .replace("{tool}", approval.req.tool)
            .replace("{path}", approval.req.path)
    : "";

  const completedTodos = todos.filter((item) => item.status === "completed").length;

  return (
    <section className={styles.agent} aria-label={a.label}>
      {todos.length > 0 ? (
        <div className={styles.agentTodos} aria-label={a.todosLabel}>
          <span className={styles.agentTodosHead}>
            {a.todosLabel} ({completedTodos}/{todos.length})
          </span>
          <ul className={styles.agentTodoList}>
            {todos.map((item) => (
              <li key={item.id} data-status={item.status}>
                <span aria-hidden="true">
                  {item.status === "completed"
                    ? "✓"
                    : item.status === "in_progress"
                      ? "→"
                      : item.status === "cancelled"
                        ? "×"
                        : "○"}
                </span>{" "}
                {item.content}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {log.length ? (
        <ol className={styles.agentLog} aria-live="polite">
          {log.map((e, i) => (
            <li
              key={i}
              data-kind={e.kind}
              data-error={"error" in e ? e.error : undefined}
              data-source={e.kind === "tool" && e.runtime ? "runtime" : undefined}
            >
              {e.kind === "tool" ? e.label : e.text}
              {e.kind === "end" && e.build ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className={styles.agentLink}
                    disabled={running || restoring}
                    onClick={() => {
                      setMode("code");
                      const b = e.build!;
                      void run(
                        (b.mode === "debug" ? applyFixPrompt : buildFromPlanPrompt)(
                          b.request,
                          b.plan,
                        ),
                        "code",
                      );
                    }}
                  >
                    {e.build.mode === "debug" ? a.applyFix : a.buildPlan}
                  </button>
                </>
              ) : null}
              {e.kind === "end" && e.failed ? (
                <RecoveryActions
                  code={e.failed.code}
                  retry={() => {
                    const r = e.failed!.retry;
                    void run(r.text, r.mode, r.images, false);
                  }}
                  settings={`${localePrefix(locale)}/settings`}
                  t={t}
                  disabled={running || restoring}
                  className={styles.agentLink}
                />
              ) : null}
              {e.kind === "end" && e.undo ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className={styles.agentLink}
                    disabled={running || restoring}
                    onClick={() => void restore(e.undo!.checkpointId)}
                  >
                    {e.undo.label}
                  </button>
                </>
              ) : null}
            </li>
          ))}
          {running && live ? <li data-kind="text">{live}</li> : null}
          {running ? <li data-kind="working">{a.working}</li> : null}
          <li ref={logEnd} aria-hidden="true" />
        </ol>
      ) : null}

      {approval ? (
        <div className={styles.agentApproval} role="group" aria-labelledby={ids.approval}>
          <p id={ids.approval}>{approvalPrompt}</p>
          <button
            type="button"
            className={styles.agentButton}
            onClick={() => approval.decide({ allow: true })}
          >
            {a.allowOnce}
          </button>
          {approval.req.tool !== "doom_loop" ? (
            <button
              type="button"
              className={styles.agentSecondary}
              onClick={() => approval.decide({ allow: true, always: true })}
            >
              {a.alwaysAllow}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.agentSecondary}
            autoFocus
            onClick={() => approval.decide(false)}
          >
            {a.deny}
          </button>
        </div>
      ) : null}

      {pendingQuestion ? (
        <div className={styles.agentQuestion} role="group" aria-labelledby={ids.question}>
          <p id={ids.question}>
            <strong>{a.questionLabel}:</strong> {pendingQuestion.req.question}
          </p>
          {pendingQuestion.req.options.length > 0 ? (
            <div className={styles.agentQuestionOptions}>
              {pendingQuestion.req.options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={styles.agentMode}
                  onClick={() => pendingQuestion.answer(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          ) : null}
          <div className={styles.agentQuestionInputRow}>
            <input
              type="text"
              className={styles.agentQuestionInput}
              value={questionDraft}
              placeholder={a.questionPlaceholder}
              onChange={(e) => setQuestionDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && questionDraft.trim()) {
                  e.preventDefault();
                  pendingQuestion.answer(questionDraft.trim());
                }
              }}
            />
            <button
              type="button"
              className={styles.agentButton}
              disabled={!questionDraft.trim()}
              onClick={() => pendingQuestion.answer(questionDraft.trim())}
            >
              {a.questionSubmit}
            </button>
            <button
              type="button"
              className={styles.agentSecondary}
              onClick={() => pendingQuestion.answer(null)}
            >
              {a.questionSkip}
            </button>
          </div>
        </div>
      ) : null}

      <div className={styles.agentToolbar}>
        <div className={styles.agentModes} role="group" aria-label={a.modeLabel}>
          {PRIMARY_MODES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              className={styles.agentMode}
              disabled={running}
              onClick={() => setMode(m)}
            >
              {modeLabels[m]}
            </button>
          ))}
        </div>

        <div className={styles.agentMetaControls}>
          <label htmlFor={ids.preset} className={styles.srOnly}>
            {a.permissionLabel}
          </label>
          <select
            id={ids.preset}
            className={styles.agentSelect}
            value={preset}
            disabled={running}
            aria-label={a.permissionLabel}
            onChange={(e) => setPreset(e.target.value as PermissionPreset)}
          >
            <option value="balanced">{a.permissionBalanced}</option>
            <option value="manual">{a.permissionManual}</option>
            <option value="auto">{a.permissionAuto}</option>
          </select>

          {turns.length > 0 ? (
            <span className={styles.agentSessionStat}>
              {turns.length}t · ~{estimatedContextTokens} tok
            </span>
          ) : null}

          <button
            type="button"
            className={styles.agentGhostButton}
            disabled={running || (!turns.length && !todos.length)}
            onClick={compactNow}
          >
            {a.compactSession}
          </button>

          <button
            type="button"
            className={styles.agentGhostButton}
            disabled={running || (!turns.length && !log.length && !todos.length)}
            onClick={resetSession}
          >
            {a.newSession}
          </button>
        </div>
      </div>

      {mode === "custom" ? (
        <div className={styles.agentCustomPanel}>
          <label htmlFor={ids.customInstructions} className={styles.agentCustomLabel}>
            {a.customInstructionsLabel}
          </label>
          <textarea
            id={ids.customInstructions}
            className={styles.agentCustomInput}
            rows={2}
            value={customConfig.instructions}
            disabled={running}
            onChange={(e) =>
              setCustomConfig((prev) => ({ ...prev, instructions: e.target.value }))
            }
          />
          <div className={styles.agentCustomPerms}>
            <label>
              <input
                type="checkbox"
                checked={customConfig.permissions.allowWrites}
                disabled={running}
                onChange={(e) =>
                  setCustomConfig((prev) => ({
                    ...prev,
                    permissions: { ...prev.permissions, allowWrites: e.target.checked },
                  }))
                }
              />
              {a.customPermWrites}
            </label>
            <label>
              <input
                type="checkbox"
                checked={customConfig.permissions.allowDeletes}
                disabled={running}
                onChange={(e) =>
                  setCustomConfig((prev) => ({
                    ...prev,
                    permissions: { ...prev.permissions, allowDeletes: e.target.checked },
                  }))
                }
              />
              {a.customPermDeletes}
            </label>
            <label>
              <input
                type="checkbox"
                checked={customConfig.permissions.allowPreview}
                disabled={running}
                onChange={(e) =>
                  setCustomConfig((prev) => ({
                    ...prev,
                    permissions: { ...prev.permissions, allowPreview: e.target.checked },
                  }))
                }
              />
              {a.customPermPreview}
            </label>
            <label>
              <input
                type="checkbox"
                checked={customConfig.permissions.allowSubagents}
                disabled={running}
                onChange={(e) =>
                  setCustomConfig((prev) => ({
                    ...prev,
                    permissions: { ...prev.permissions, allowSubagents: e.target.checked },
                  }))
                }
              />
              {a.customPermSubagents}
            </label>
          </div>
        </div>
      ) : null}

      <AttachmentList
        at={at}
        check={checkAttachments(session, at.attachments)}
        model={session?.model}
      />

      <form className={styles.agentForm} onSubmit={onSubmit} {...at.dropProps}>
        <label htmlFor={ids.prompt} className={styles.srOnly}>
          {a.label}
        </label>
        <textarea
          id={ids.prompt}
          className={styles.agentInput}
          rows={2}
          value={prompt}
          placeholder={modePlaceholders[mode]}
          maxLength={maxPrompt}
          aria-describedby={ids.note}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={running}
        />
        <AttachButton at={at} disabled={running} />
        {running ? (
          <button
            type="button"
            className={styles.agentButton}
            onClick={() => abort.current?.abort()}
          >
            {a.stop}
          </button>
        ) : (
          <button type="submit" className={styles.agentButton} disabled={!prompt.trim()}>
            {a.run}
          </button>
        )}
      </form>
      <p id={ids.note} className={styles.agentNote}>
        {modeNotes[mode]}
        {a.note.replace("{provider}", `${providers[session.provider].name} · ${session.model}`)}
      </p>
    </section>
  );
}
