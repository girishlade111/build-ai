import type { AgentStrings } from "../i18n/agent";
import type { ToolResult } from "./tools";

/**
 * The log line for one tool step. A failed step never reads as done (ERR-04): each tool has its
 * own failure wording, and a preview that could not be checked says it is a preview problem,
 * not the model's (ERR-03).
 */
export function toolLabel(a: AgentStrings, r: ToolResult): string {
  const p = r.path ?? "?";
  if (r.declined) {
    if (r.call.name === "delete_file") return a.declined.replace("{path}", p);
    return a.declinedAction.replace("{path}", p);
  }
  if (r.isError) {
    const failed: Record<string, string> = {
      list_files: a.listFailed,
      read_file: a.readFailed,
      check_preview: a.previewFailed,
      grep_search: a.searchFailed,
      glob_files: a.searchFailed,
      task: a.subagentFailed,
    };
    return (failed[r.call.name] ?? a.toolFailed).replace("{path}", p);
  }
  const done: Record<string, string> = {
    list_files: a.listed,
    check_preview: a.checkedPreview,
    read_file: a.read,
    write_file: a.wrote,
    edit_file: a.edited,
    apply_patch: a.patched,
    delete_file: a.deleted,
    grep_search: a.searched,
    glob_files: a.globbed,
    repo_overview: a.overviewed,
    todowrite: a.updatedTodos,
    todoread: a.readTodos,
    question: a.answeredQuestion,
    task: a.ranSubagent,
    plan_enter: a.enteredPlan,
    plan_exit: a.exitedPlan,
  };
  return (done[r.call.name] ?? a.toolFailed).replace("{path}", p);
}
