# Kilo Code Agent Core Provenance

This directory contains ONLY the agent-core modules extracted from the official
`kilo-org/kilocode` repository (MIT License), with git origin and all non-agent
workspace/CLI/server files stripped.

## Ported Upstream Modules

| Local Module | Upstream Source (`kilo-org/kilocode`) | Purpose |
| --- | --- | --- |
| `edit.ts` | `packages/opencode/src/tool/edit.ts` | 9-strategy fuzzy replacer (`Simple`, `LineTrimmed`, `BlockAnchor` + Levenshtein, `WhitespaceNormalized`, `IndentationFlexible`, `EscapeNormalized`, `TrimmedBoundary`, `ContextAware`, `MultiOccurrence`), disproportionate match guard, `trimDiff` |
| `patch.ts` | `packages/opencode/src/patch/index.ts` | Multi-file `*** Begin Patch` / `*** End Patch` parser (`Add`, `Update`, `Move to`, `Delete`), 4-pass `seekSequence` with Unicode normalization, `deriveNewContentsFromChunks`, unified diff generation |
| `permission.ts` | `packages/opencode/src/permission/index.ts` & `evaluate.ts` | Wildcard rule matching, `evaluate()` (last-rule wins), `resolve()` (base `deny` cannot be escalated; session `allow` overrides `ask`), subagent hardening |
| `prompts.ts` | `packages/opencode/src/agent/prompt/{ask,debug,orchestrator,explore,compaction,summary}.txt`, `packages/opencode/src/kilocode/agent/scout.txt`, `packages/opencode/src/session/prompt/plan-mode.txt` | Primary modes (`code`, `plan`, `debug`, `ask`, `orchestrator`, `custom`) and subagents (`explore`, `scout`, `general`) |
| `session.ts` | `packages/opencode/src/session/{processor,retry,compaction,todo}.ts` & `packages/opencode/src/tool/truncate.ts` | `DOOM_LOOP_THRESHOLD = 3`, exponential backoff retry, `truncateOutput` (`2000` lines / `50 KB`), todos, token compaction, browser `localStorage` session persistence |
