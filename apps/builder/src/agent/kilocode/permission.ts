/**
 * Ported from kilo-org/kilocode: packages/opencode/src/permission/index.ts & evaluate.ts (MIT License).
 * Wildcard rule evaluation (last-match wins), non-escalating resolution (base deny can never be
 * overridden by session approvals), per-mode default rulesets, and subagent permission hardening.
 */

export type PermissionAction = "allow" | "deny" | "ask";

export interface Rule {
  permission: string;
  pattern: string;
  action: PermissionAction;
}

export type Ruleset = Rule[];

export type PermissionPreset = "balanced" | "manual" | "auto";

export type KiloAgentMode = "code" | "plan" | "debug" | "ask" | "orchestrator" | "custom";

export type SubagentType = "explore" | "scout" | "general";

export type PermissionConfig = Record<
  string,
  PermissionAction | Record<string, PermissionAction>
>;

/**
 * Glob/wildcard matcher supporting `*` (any chars), `?` (single char), and `**`.
 */
export function matchWildcard(value: string, pattern: string): boolean {
  if (pattern === "*" || pattern === "**") return true;
  if (pattern === value) return true;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLE_STAR__/g, ".*")
    .replace(/\?/g, ".");
  // Also allow `*` in non-path tool names / arbitrary strings to match across `/` when pattern has no `/`
  const expr = pattern.includes("/")
    ? `^${escaped}$`
    : `^${pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".")}$`;
  try {
    return new RegExp(expr).test(value);
  } catch {
    return false;
  }
}

export function fromConfig(config: PermissionConfig): Ruleset {
  const ruleset: Ruleset = [];
  for (const [permission, value] of Object.entries(config)) {
    if (typeof value === "string") {
      ruleset.push({ permission, pattern: "*", action: value });
    } else {
      for (const [pattern, action] of Object.entries(value)) {
        ruleset.push({ permission, pattern, action });
      }
    }
  }
  return ruleset;
}

export function merge(...rulesets: Ruleset[]): Ruleset {
  return rulesets.flat();
}

/**
 * Kilo Code's evaluate(): last matching rule wins; defaults to "ask" when unmatched.
 */
export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
  const flat = rulesets.flat();
  for (let i = flat.length - 1; i >= 0; i--) {
    const rule = flat[i]!;
    if (matchWildcard(permission, rule.permission) && matchWildcard(pattern, rule.pattern)) {
      return rule;
    }
  }
  return { action: "ask", permission, pattern: "*" };
}

/**
 * Kilo Code's resolve():
 * - Hard base "deny" can NEVER be escalated by saved/session overrides (Ask/Plan safety).
 * - Session "deny" blocks execution.
 * - Base "ask" can be promoted to "allow" if an override explicitly allows a matching pattern.
 */
export function resolve(
  permission: string,
  pattern: string,
  ruleset: Ruleset,
  ...overrides: Ruleset[]
): Rule {
  const base = evaluate(permission, pattern, ruleset);
  const saved = overrides.length ? evaluate(permission, pattern, ...overrides) : undefined;
  if (base.action === "deny") return base;
  if (saved?.action === "deny") return saved;
  if (base.action === "ask") {
    if (saved?.action === "allow" && matchWildcard(pattern, saved.pattern)) return saved;
    return base;
  }
  if (saved?.action === "allow") return saved;
  return base;
}

const READ_TOOLS: PermissionConfig = {
  list_files: "allow",
  read_file: "allow",
  grep_search: "allow",
  glob_files: "allow",
  repo_overview: "allow",
  todoread: "allow",
  todowrite: "allow",
  question: "allow",
};

const WRITE_DENY: PermissionConfig = {
  write_file: "deny",
  edit_file: "deny",
  apply_patch: "deny",
  delete_file: "deny",
};

export interface CustomModePermissions {
  allowWrites: boolean;
  allowDeletes: boolean;
  allowPreview: boolean;
  allowSubagents: boolean;
}

export function rulesetForMode(
  mode: KiloAgentMode,
  preset: PermissionPreset = "balanced",
  customPerms?: CustomModePermissions,
): Ruleset {
  const writeAction: PermissionAction = preset === "manual" ? "ask" : "allow";
  const deleteAction: PermissionAction = preset === "auto" ? "allow" : "ask";
  const subagentAction: PermissionAction = preset === "manual" ? "ask" : "allow";

  switch (mode) {
    case "code":
      return fromConfig({
        ...READ_TOOLS,
        write_file: writeAction,
        edit_file: writeAction,
        apply_patch: writeAction,
        delete_file: deleteAction,
        check_preview: "allow",
        task: subagentAction,
        plan_enter: "allow",
        plan_exit: "deny",
      });

    case "plan":
      return fromConfig({
        ...READ_TOOLS,
        ...WRITE_DENY,
        check_preview: "deny",
        task: subagentAction,
        plan_enter: "deny",
        plan_exit: "allow",
      });

    case "debug":
      return fromConfig({
        ...READ_TOOLS,
        ...WRITE_DENY,
        check_preview: "allow",
        task: subagentAction,
        plan_enter: "allow",
        plan_exit: "deny",
      });

    case "ask":
      return fromConfig({
        ...READ_TOOLS,
        ...WRITE_DENY,
        check_preview: "deny",
        task: "deny",
        plan_enter: "allow",
        plan_exit: "deny",
      });

    case "orchestrator":
      // Kilo Code orchestrator delegates implementation via task subagents rather than editing directly
      return fromConfig({
        ...READ_TOOLS,
        ...WRITE_DENY,
        check_preview: "allow",
        task: subagentAction,
        plan_enter: "allow",
        plan_exit: "deny",
      });

    case "custom": {
      const perms: CustomModePermissions = customPerms ?? {
        allowWrites: true,
        allowDeletes: false,
        allowPreview: true,
        allowSubagents: true,
      };
      return fromConfig({
        ...READ_TOOLS,
        write_file: perms.allowWrites ? writeAction : "deny",
        edit_file: perms.allowWrites ? writeAction : "deny",
        apply_patch: perms.allowWrites ? writeAction : "deny",
        delete_file: perms.allowDeletes ? deleteAction : "deny",
        check_preview: perms.allowPreview ? "allow" : "deny",
        task: perms.allowSubagents ? subagentAction : "deny",
        plan_enter: "allow",
        plan_exit: "allow",
      });
    }
  }
}

/**
 * Hardens a subagent's ruleset so it can never perform actions outside its role
 * (and prevents recursive subagent spawning).
 */
export function rulesetForSubagent(
  subagent: SubagentType,
  preset: PermissionPreset = "balanced",
): Ruleset {
  if (subagent === "explore" || subagent === "scout") {
    return fromConfig({
      list_files: "allow",
      read_file: "allow",
      grep_search: "allow",
      glob_files: "allow",
      repo_overview: "allow",
      todoread: "allow",
      todowrite: "deny",
      question: "deny",
      ...WRITE_DENY,
      check_preview: "deny",
      task: "deny",
      plan_enter: "deny",
      plan_exit: "deny",
    });
  }
  // "general" subagent can implement changes in Code/Orchestrator waves, never spawn nested tasks
  const writeAction: PermissionAction = preset === "manual" ? "ask" : "allow";
  const deleteAction: PermissionAction = preset === "auto" ? "allow" : "ask";
  return fromConfig({
    ...READ_TOOLS,
    write_file: writeAction,
    edit_file: writeAction,
    apply_patch: writeAction,
    delete_file: deleteAction,
    check_preview: "allow",
    question: "deny",
    task: "deny",
    plan_enter: "deny",
    plan_exit: "deny",
  });
}
