import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { locales } from "@ladestack/i18n";
import { agentStrings } from "../../i18n/agent";
import { ProviderStreamError } from "../../providers/stream";
import { openProjectDb, ProjectStore } from "../../storage/projectStore";
import { createConversation, type Conversation } from "../adapters";
import { toolLabel } from "../labels";
import { runAgent } from "../loop";
import { runTool, toolsForMode, type ToolCall } from "../tools";
import { replace, trimDiff } from "./edit";
import { deriveNewContentsFromChunks, parsePatch } from "./patch";
import {
  evaluate,
  fromConfig,
  matchWildcard,
  resolve,
  rulesetForMode,
  rulesetForSubagent,
} from "./permission";
import {
  buildLocalCompactionSummary,
  clearAgentSession,
  DOOM_LOOP_THRESHOLD,
  estimateTokens,
  isDoomLoop,
  isRetryableStreamError,
  loadAgentSession,
  loadCustomModeConfig,
  retryDelayMs,
  saveAgentSession,
  saveCustomModeConfig,
  shouldCompact,
  truncateOutput,
  type TodoItem,
} from "./session";

const call = (name: string, args: unknown, id = "k1"): ToolCall => ({ id, name, args });

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

describe("Kilo Code edit.ts 9-strategy fuzzy replacer", () => {
  it("performs exact, line-trimmed, indentation-flexible, whitespace, and block-anchor replacements", () => {
    expect(replace("const a = 1;\nconst b = 2;\n", "const a = 1;", "const a = 42;")).toBe(
      "const a = 42;\nconst b = 2;\n",
    );

    // Indentation-flexible match
    const indented = "function f() {\n    const x = 1;\n    return x + 1;\n}\n";
    expect(replace(indented, "const x = 1;\nreturn x + 1;", "    const x = 2;\n    return x * 2;")).toContain(
      "return x * 2;",
    );

    // BlockAnchorReplacer with slight middle-line typo (Levenshtein)
    const anchored = "function greet(name: string) {\n  const msg = `Hello ${name}`;\n  return msg;\n}\n";
    const fuzzy = replace(
      anchored,
      "function greet(name: string) {\n  const msg = `Helo ${name}`;\n  return msg;\n}",
      "function greet(name: string) {\n  return `Hi ${name}`;\n}",
    );
    expect(fuzzy).toContain("return `Hi ${name}`;");
  });

  it("supports replaceAll, preserves CRLF, and rejects ambiguous or empty oldString", () => {
    expect(replace("foo\nbar\nfoo", "foo", "baz", true)).toBe("baz\nbar\nbaz");
    expect(replace("a\r\nb\r\n", "b", "c")).toBe("a\r\nc\r\n");
    expect(() => replace("foo\nfoo", "foo", "bar", false)).toThrow(/multiple matches/);
    expect(() => replace("abc", "", "x")).toThrow(/cannot be empty/);
    expect(() => replace("abc", "abc", "abc")).toThrow(/identical/);
  });

  it("trims shared leading whitespace in diffs", () => {
    const d = "@@ -1 +1 @@\n-    old\n+    new";
    expect(trimDiff(d)).toBe("@@ -1 +1 @@\n-old\n+new");
  });
});

describe("Kilo Code patch.ts multi-file patch engine", () => {
  it("parses Add, Update, Move to, and Delete hunks and normalizes Unicode punctuation", () => {
    const patch = [
      "*** Begin Patch",
      "*** Add File: src/new.ts",
      "+export const x = 1;",
      "*** Update File: src/app.ts",
      "@@",
      " const title = 'Hello';",
      "-const count = 1;",
      "+const count = 2;",
      "*** Delete File: src/old.ts",
      "*** End Patch",
    ].join("\n");

    const parsed = parsePatch(patch);
    expect(parsed.hunks).toHaveLength(3);
    expect(parsed.hunks[0]).toEqual({
      type: "add",
      path: "src/new.ts",
      contents: "export const x = 1;",
    });

    // Unicode curly quotes in original file match ASCII quote in patch
    const updateHunk = parsed.hunks[1]!;
    expect(updateHunk.type).toBe("update");
    if (updateHunk.type === "update") {
      const updated = deriveNewContentsFromChunks(
        "src/app.ts",
        updateHunk.chunks,
        "const title = \u2018Hello\u2019;\nconst count = 1;\n",
      );
      expect(updated.content).toContain("const count = 2;");
      expect(updated.unified_diff).toContain("+const count = 2;");
    }
  });
});

describe("Kilo Code permission.ts wildcard & non-escalation engine", () => {
  it("evaluates last matching rule and prevents session rules from escalating base deny", () => {
    expect(matchWildcard("src/components/App.tsx", "src/**/*.tsx")).toBe(true);
    expect(matchWildcard("src/App.css", "src/**/*.tsx")).toBe(false);

    const base = fromConfig({ write_file: "deny", delete_file: "ask" });
    const sessionAllow = fromConfig({ write_file: "allow", delete_file: "allow" });

    // Base deny CANNOT be escalated by session allow
    expect(resolve("write_file", "src/App.tsx", base, sessionAllow).action).toBe("deny");
    // Base ask CAN be promoted to allow by session allow
    expect(resolve("delete_file", "src/old.ts", base, sessionAllow).action).toBe("allow");
  });

  it("hardens subagent rulesets and isolates Ask & Orchestrator modes", () => {
    expect(evaluate("write_file", "*", rulesetForMode("ask")).action).toBe("deny");
    expect(evaluate("task", "*", rulesetForMode("ask")).action).toBe("deny");
    expect(evaluate("write_file", "*", rulesetForMode("orchestrator")).action).toBe("deny");
    expect(evaluate("task", "*", rulesetForMode("orchestrator")).action).toBe("allow");

    // Subagents can never spawn nested tasks; explore/scout cannot edit files
    expect(evaluate("task", "*", rulesetForSubagent("general")).action).toBe("deny");
    expect(evaluate("write_file", "*", rulesetForSubagent("explore")).action).toBe("deny");
    expect(evaluate("write_file", "*", rulesetForSubagent("scout")).action).toBe("deny");
    expect(evaluate("write_file", "*", rulesetForSubagent("general", "manual")).action).toBe("ask");
  });
});

describe("Kilo Code session.ts (doom-loop, retry, truncate, persistence)", () => {
  it("detects doom loops after DOOM_LOOP_THRESHOLD consecutive identical calls", () => {
    const sig = { name: "read_file", argsJson: '{"path":"a.ts"}' };
    expect(isDoomLoop([sig, sig], sig)).toBe(false);
    expect(isDoomLoop([sig, sig, sig], sig)).toBe(true);
    expect(DOOM_LOOP_THRESHOLD).toBe(3);
  });

  it("classifies retryable errors, computes bounded backoff, and truncates large outputs", () => {
    expect(isRetryableStreamError("rate-limit")).toBe(true);
    expect(isRetryableStreamError("unavailable")).toBe(true);
    expect(isRetryableStreamError("invalid-key")).toBe(false);
    expect(retryDelayMs(1, 0)).toBe(2000);
    expect(retryDelayMs(2, 0)).toBe(4000);
    expect(retryDelayMs(10, 1)).toBeLessThanOrEqual(30_000);

    const big = Array.from({ length: 2500 }, (_, i) => `line-${i}`).join("\n");
    const tr = truncateOutput(big, { maxLines: 50 });
    expect(tr.truncated).toBe(true);
    expect(tr.content).toContain("Output truncated");
  });

  it("persists sessions and custom mode configs in storage and compacts summaries", () => {
    const s = memoryStorage();
    const todos: TodoItem[] = [
      { id: "1", content: "Add search", status: "in_progress", priority: "high" },
    ];
    saveAgentSession(
      {
        projectId: "p1",
        mode: "orchestrator",
        preset: "manual",
        turns: [{ role: "user", content: "Build dashboard", at: "2026-01-01T00:00:00Z" }],
        todos,
      },
      s,
    );
    const loaded = loadAgentSession("p1", s);
    expect(loaded?.mode).toBe("orchestrator");
    expect(loaded?.preset).toBe("manual");
    expect(loaded?.todos).toEqual(todos);

    const summary = buildLocalCompactionSummary(loaded!.turns, todos);
    expect(summary).toContain("Build dashboard");
    expect(summary).toContain("Add search");
    expect(shouldCompact(estimateTokens("x".repeat(200_000)))).toBe(true);

    clearAgentSession("p1", s);
    expect(loadAgentSession("p1", s)).toBeNull();

    saveCustomModeConfig(
      {
        name: "Reviewer",
        instructions: "Review strictly",
        permissions: {
          allowWrites: false,
          allowDeletes: false,
          allowPreview: true,
          allowSubagents: false,
        },
      },
      s,
    );
    expect(loadCustomModeConfig(s).instructions).toBe("Review strictly");
  });
});

describe("Kilo Code end-to-end tool execution & agent loop", () => {
  let store: ProjectStore;
  let projectId: string;

  beforeEach(async () => {
    store = new ProjectStore(await openProjectDb(new IDBFactory()));
    const p = await store.createProject({
      name: "KiloTest",
      profile: "static",
      files: {
        "index.html": "<h1>Hello</h1>\n<p>World</p>\n",
        "src/app.ts": "export function sum(a: number, b: number) {\n  return a + b;\n}\n",
      },
    });
    projectId = p.id;
  });

  it("runs edit_file, apply_patch, grep_search, glob_files, repo_overview, and line-sliced read_file", async () => {
    const edit = await runTool(
      store,
      projectId,
      call("edit_file", {
        path: "src/app.ts",
        old_string: "return a + b;",
        new_string: "return a + b + 1;",
      }),
    );
    expect(edit.isError).toBe(false);
    expect((await store.readFile(projectId, "src/app.ts"))?.content).toContain("a + b + 1");

    const patchText = [
      "*** Begin Patch",
      "*** Add File: src/utils.ts",
      "+export const VERSION = '2.0';",
      "*** Update File: index.html",
      "@@",
      " <h1>Hello</h1>",
      "-<p>World</p>",
      "+<p>Kilo Code</p>",
      "*** End Patch",
    ].join("\n");
    const patched = await runTool(store, projectId, call("apply_patch", { patch_text: patchText }));
    expect(patched.isError).toBe(false);
    expect(patched.touchedPaths).toEqual(expect.arrayContaining(["src/utils.ts", "index.html"]));
    expect((await store.readFile(projectId, "index.html"))?.content).toContain("Kilo Code");

    const grep = await runTool(store, projectId, call("grep_search", { pattern: "VERSION" }));
    expect(grep.isError).toBe(false);
    expect(grep.output).toContain("src/utils.ts:1:");

    const glob = await runTool(store, projectId, call("glob_files", { pattern: "src/*.ts" }));
    expect(glob.isError).toBe(false);
    expect(glob.output).toContain("src/app.ts");
    expect(glob.output).toContain("src/utils.ts");

    const overview = await runTool(store, projectId, call("repo_overview", {}));
    expect(overview.output).toContain("Project files: 3");

    const sliced = await runTool(
      store,
      projectId,
      call("read_file", { path: "src/app.ts", offset: 2, limit: 1 }),
    );
    expect(sliced.output).toContain("2:   return a + b + 1;");
  });

  it("supports todowrite/todoread, question, task subagent, plan_enter/plan_exit, and Always allow", async () => {
    let todos: TodoItem[] = [];
    const tw = await runTool(
      store,
      projectId,
      call("todowrite", {
        todos: [{ id: "t1", content: "Inspect app", status: "completed", priority: "high" }],
      }),
      { setTodos: (x) => (todos = x) },
    );
    expect(tw.isError).toBe(false);
    const tr = await runTool(store, projectId, call("todoread", {}), { getTodos: () => todos });
    expect(tr.output).toContain("Inspect app");

    const q = await runTool(
      store,
      projectId,
      call("question", { question: "Use Tailwind?", options: ["Yes", "No"] }),
      { askQuestion: async () => "Yes" },
    );
    expect(q.output).toBe("User answered: Yes");

    const sub = await runTool(
      store,
      projectId,
      call("task", {
        description: "Find exports",
        prompt: "List all exports",
        subagent_type: "explore",
      }),
      { runSubagent: async () => ({ output: "Found sum and VERSION" }) },
    );
    expect(sub.isError).toBe(false);
    expect(sub.output).toContain("Found sum");

    const remembered: string[] = [];
    const writeManual = await runTool(
      store,
      projectId,
      call("write_file", { path: "notes.txt", content: "hi" }),
      {
        permissionPreset: "manual",
        approve: async () => ({ allow: true, always: true }),
        onRememberAllow: (tool) => remembered.push(tool),
      },
    );
    expect(writeManual.isError).toBe(false);
    expect(remembered).toEqual(["write_file"]);

    const switched: string[] = [];
    await runTool(store, projectId, call("plan_enter", { reason: "design first" }), {
      mode: "code",
      onModeSwitch: (m) => switched.push(m),
    });
    expect(switched).toEqual(["plan"]);
  });

  it("retries transient provider errors and guards against doom loops in runAgent", async () => {
    let attempts = 0;
    const flaky: Conversation = {
      step: async () => {
        attempts++;
        if (attempts < 3) throw new ProviderStreamError("rate-limit");
        return { text: "Recovered!", calls: [] };
      },
      addResults: () => {},
    };
    const retries: number[] = [];
    const out = await runAgent({
      conversation: flaky,
      fs: store,
      projectId,
      maxRetries: 3,
      retryDelay: () => 1,
      onEvent: (e) => {
        if (e.type === "retry") retries.push(e.attempt);
      },
    });
    expect(out).toEqual({ reason: "done" });
    expect(retries).toEqual([1, 2]);

    // Doom loop guard triggers on 4th consecutive identical call
    let stepCalls = 0;
    const loopy: Conversation = {
      step: async () => {
        stepCalls++;
        if (stepCalls <= 4) return { text: "", calls: [call("list_files", {}, `c${stepCalls}`)] };
        return { text: "stopped repeating", calls: [] };
      },
      addResults: () => {},
    };
    const outputs: string[] = [];
    const res = await runAgent({
      conversation: loopy,
      fs: store,
      projectId,
      maxSteps: 6,
      onEvent: (e) => {
        if (e.type === "tool") outputs.push(e.result.output);
      },
    });
    expect(res).toEqual({ reason: "done" });
    expect(outputs[3]).toMatch(/Doom-loop guard triggered/);
  });

  it("injects multi-turn history and compactedSummary into provider adapters", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "continued" } }] }), {
          status: 200,
        }),
      );
    const conv = createConversation({
      provider: "openai",
      key: "sk-test-12345678901234567890",
      model: "gpt-4o",
      system: "base sys",
      compactedSummary: "## Compacted Session Context\n- Added header",
      history: [
        { role: "user", content: "Create header", at: "2026-01-01T00:00:00Z" },
        { role: "assistant", content: "Done header", at: "2026-01-01T00:00:01Z" },
      ],
      prompt: "Now add footer",
      tools: toolsForMode("code"),
      fetchImpl,
    });
    await conv.step();
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.messages[0].content).toContain("Compacted Session Context");
    expect(body.messages[1]).toEqual({ role: "user", content: "Create header" });
    expect(body.messages[2]).toEqual({ role: "assistant", content: "Done header" });
    expect(body.messages[3].content).toBe("Now add footer");
  });

  it("has complete 8-locale agentStrings and tool labels for every Kilo Code tool", () => {
    const enKeys = Object.keys(agentStrings.en).sort();
    for (const locale of locales) {
      expect(Object.keys(agentStrings[locale]).sort()).toEqual(enKeys);
    }
    expect(toolLabel(agentStrings.en, { call: call("edit_file", {}), output: "", isError: false, path: "a.ts" })).toBe(
      "Edited a.ts",
    );
    expect(toolLabel(agentStrings.en, { call: call("apply_patch", {}), output: "", isError: false, path: "2 files" })).toBe(
      "Patched 2 files",
    );
    expect(toolLabel(agentStrings.en, { call: call("task", {}), output: "", isError: false, path: "explore: scan" })).toBe(
      "Subagent explore: scan",
    );
  });
});
