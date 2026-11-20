import type { Checkpoint, Project, ProjectFile } from "@ladestack/shared-types";
import type { FileAuthorship, FileChangeEvent } from "./autosave";
import { countLines, diffManifests, fileNameOf } from "./metrics";

export interface ChangeTimelinePoint {
  id: string;
  label: string;
  shortLabel: string;
  at: string;
  filesChanged: number;
  manualChanged: number;
  aiChanged: number;
  cumulativeChanges: number;
  fileCount: number;
  kind: "created" | "checkpoint" | "session" | "current";
}

export interface ComponentDependencyNode {
  path: string;
  name: string;
  depth: number;
  directLocalDeps: string[];
  externalDeps: string[];
  dependentsCount: number;
  hasCycle: boolean;
  lines: number;
}

export interface DepthDistributionBucket {
  depth: number;
  label: string;
  count: number;
}

export interface FileCodeOrigin {
  path: string;
  name: string;
  totalLines: number;
  aiLines: number;
  manualLines: number;
  aiPct: number;
  aiEdits: number;
  manualEdits: number;
  dominant: "ai" | "manual" | "mixed";
}

export interface CodeAuthorshipSummary {
  aiLines: number;
  manualLines: number;
  totalLines: number;
  aiPct: number;
  manualPct: number;
  aiFiles: number;
  manualFiles: number;
  mixedFiles: number;
  aiEdits: number;
  manualEdits: number;
  byFile: FileCodeOrigin[];
}

export interface ProjectOverviewMetrics {
  summary: {
    totalFiles: number;
    totalLines: number;
    totalChangeEvents: number;
    filesModifiedTotal: number;
    maxDependencyDepth: number;
    avgDependencyDepth: number;
    localEdges: number;
    externalPackages: number;
    circularDeps: number;
    aiPct: number;
    manualPct: number;
    aiLines: number;
    manualLines: number;
  };
  filesChangedTimeline: ChangeTimelinePoint[];
  dependencyNodes: ComponentDependencyNode[];
  depthDistribution: DepthDistributionBucket[];
  authorship: CodeAuthorshipSummary;
}

const CODE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".json"];

function normalizePath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

/** Extracts import/script/style specifiers from JS/TS/HTML/CSS source text. */
export function extractImportSpecifiers(path: string, content: string): string[] {
  const specifiers = new Set<string>();
  const lower = path.toLowerCase();

  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  ) {
    const patterns = [
      /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g,
      /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
      /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    ];
    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern)) {
        const spec = match[1]?.trim();
        if (spec) specifiers.add(spec);
      }
    }
  } else if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    const htmlPatterns = [
      /<script\b[^>]*\bsrc=["']([^"']+)["']/gi,
      /<link\b[^>]*\bhref=["']([^"']+)["']/gi,
    ];
    for (const pattern of htmlPatterns) {
      for (const match of content.matchAll(pattern)) {
        const spec = match[1]?.trim();
        if (spec && !spec.startsWith("http://") && !spec.startsWith("https://") && !spec.startsWith("#")) {
          specifiers.add(spec);
        }
      }
    }
  } else if (lower.endsWith(".css") || lower.endsWith(".scss")) {
    const cssPattern = /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?/gi;
    for (const match of content.matchAll(cssPattern)) {
      const spec = match[1]?.trim();
      if (spec && !spec.startsWith("http://") && !spec.startsWith("https://")) {
        specifiers.add(spec);
      }
    }
  }

  return Array.from(specifiers);
}

export function resolveLocalImport(
  fromPath: string,
  specifier: string,
  knownPaths: Set<string>,
): string | null {
  const cleanSpec = specifier.split(/[?#]/)[0] ?? "";
  if (!cleanSpec) return null;

  const isHtmlOrCss =
    fromPath.toLowerCase().endsWith(".html") ||
    fromPath.toLowerCase().endsWith(".htm") ||
    fromPath.toLowerCase().endsWith(".css");

  const isRelative = cleanSpec.startsWith("./") || cleanSpec.startsWith("../") || cleanSpec.startsWith("/");
  if (!isRelative && !isHtmlOrCss) return null;

  const base = cleanSpec.startsWith("/")
    ? normalizePath(cleanSpec.slice(1))
    : normalizePath(dirname(fromPath) ? `${dirname(fromPath)}/${cleanSpec}` : cleanSpec);

  for (const ext of CODE_EXTENSIONS) {
    const candidate = `${base}${ext}`;
    if (knownPaths.has(candidate)) return candidate;
  }
  for (const idxExt of ["/index.ts", "/index.tsx", "/index.js", "/index.jsx"]) {
    const candidate = `${base}${idxExt}`;
    if (knownPaths.has(candidate)) return candidate;
  }
  return null;
}

function isExternalSpecifier(fromPath: string, specifier: string): boolean {
  if (!specifier || specifier.startsWith(".") || specifier.startsWith("/")) return false;
  if (specifier.startsWith("http://") || specifier.startsWith("https://") || specifier.startsWith("data:")) {
    return false;
  }
  const lower = fromPath.toLowerCase();
  return (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  );
}

function packageRoot(specifier: string): string {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return specifier.split("/")[0] ?? specifier;
}

export function computeDependencyGraph(
  files: ProjectFile[],
  contents: Record<string, string>,
): {
  nodes: ComponentDependencyNode[];
  distribution: DepthDistributionBucket[];
  localEdges: number;
  externalPackages: number;
  circularDeps: number;
} {
  const knownPaths = new Set(files.map((f) => f.path));
  const localDepsMap = new Map<string, string[]>();
  const externalDepsMap = new Map<string, string[]>();
  const dependentsCount = new Map<string, number>();
  const allExternal = new Set<string>();

  for (const file of files) {
    const content = contents[file.path] ?? "";
    const specs = extractImportSpecifiers(file.path, content);
    const localDeps: string[] = [];
    const extDeps = new Set<string>();

    for (const spec of specs) {
      const resolved = resolveLocalImport(file.path, spec, knownPaths);
      if (resolved && resolved !== file.path) {
        if (!localDeps.includes(resolved)) {
          localDeps.push(resolved);
          dependentsCount.set(resolved, (dependentsCount.get(resolved) ?? 0) + 1);
        }
      } else if (!resolved && isExternalSpecifier(file.path, spec)) {
        const pkg = packageRoot(spec);
        extDeps.add(pkg);
        allExternal.add(pkg);
      }
    }

    localDepsMap.set(file.path, localDeps);
    externalDepsMap.set(file.path, Array.from(extDeps).sort());
  }

  const depthMemo = new Map<string, number>();
  const cycleFlags = new Set<string>();

  function calcDepth(path: string, stack: Set<string>): number {
    if (depthMemo.has(path)) return depthMemo.get(path)!;
    const deps = localDepsMap.get(path) ?? [];
    if (deps.length === 0) {
      depthMemo.set(path, 0);
      return 0;
    }

    stack.add(path);
    let maxChildDepth = -1;
    let encounteredCycle = false;

    for (const dep of deps) {
      if (stack.has(dep)) {
        encounteredCycle = true;
        cycleFlags.add(path);
        cycleFlags.add(dep);
        continue;
      }
      const d = calcDepth(dep, stack);
      if (d > maxChildDepth) maxChildDepth = d;
    }

    stack.delete(path);
    const depth = maxChildDepth === -1 ? (encounteredCycle ? 1 : 0) : maxChildDepth + 1;
    depthMemo.set(path, depth);
    return depth;
  }

  let localEdges = 0;
  const nodes: ComponentDependencyNode[] = files.map((file) => {
    const directLocalDeps = localDepsMap.get(file.path) ?? [];
    localEdges += directLocalDeps.length;
    const depth = calcDepth(file.path, new Set());
    return {
      path: file.path,
      name: fileNameOf(file.path),
      depth,
      directLocalDeps,
      externalDeps: externalDepsMap.get(file.path) ?? [],
      dependentsCount: dependentsCount.get(file.path) ?? 0,
      hasCycle: cycleFlags.has(file.path),
      lines: countLines(contents[file.path] ?? ""),
    };
  });

  nodes.sort(
    (a, b) =>
      b.depth - a.depth ||
      b.directLocalDeps.length - a.directLocalDeps.length ||
      b.dependentsCount - a.dependentsCount ||
      a.path.localeCompare(b.path),
  );

  const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 0);
  const bucketMap = new Map<number, number>();
  for (let d = 0; d <= maxDepth; d++) bucketMap.set(d, 0);
  for (const n of nodes) {
    bucketMap.set(n.depth, (bucketMap.get(n.depth) ?? 0) + 1);
  }

  const distribution: DepthDistributionBucket[] = Array.from(bucketMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([depth, count]) => ({
      depth,
      label: `L${depth}`,
      count,
    }));

  return {
    nodes,
    distribution,
    localEdges,
    externalPackages: allExternal.size,
    circularDeps: cycleFlags.size,
  };
}

function isAiCheckpointReason(reason: Checkpoint["reason"]): boolean {
  return reason === "auto-before-ai-edit" || reason === "task-boundary";
}

function formatShortTime(iso: string, fallback: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function computeFilesChangedTimeline(
  project: Project,
  files: ProjectFile[],
  checkpoints: Checkpoint[],
  changeHistory: FileChangeEvent[],
  labels: { createdLabel?: string; currentLabel?: string; checkpointPrefix?: string } = {},
): ChangeTimelinePoint[] {
  const createdLabel = labels.createdLabel ?? "Created";
  const currentLabel = labels.currentLabel ?? "Current";
  const cpPrefix = labels.checkpointPrefix ?? "CP";

  const points: ChangeTimelinePoint[] = [];
  const chronologicalCps = [...checkpoints].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let cumulative = files.length;
  const initialCount =
    chronologicalCps.length > 0
      ? Object.keys(chronologicalCps[0]!.manifest).length
      : files.length;
  cumulative = initialCount;

  points.push({
    id: "created",
    label: createdLabel,
    shortLabel: createdLabel,
    at: project.createdAt,
    filesChanged: initialCount,
    manualChanged: initialCount,
    aiChanged: 0,
    cumulativeChanges: cumulative,
    fileCount: initialCount,
    kind: "created",
  });

  // Merge chronological checkpoints and tracked change events grouped by minute bucket.
  type RawEvent =
    | { kind: "checkpoint"; at: string; cp: Checkpoint; index: number }
    | { kind: "session"; at: string; events: FileChangeEvent[] };

  const sessionBuckets = new Map<string, FileChangeEvent[]>();
  for (const ev of changeHistory) {
    const minuteKey = ev.at.slice(0, 16);
    const list = sessionBuckets.get(minuteKey) ?? [];
    list.push(ev);
    sessionBuckets.set(minuteKey, list);
  }

  const combined: RawEvent[] = [
    ...chronologicalCps.map((cp, index) => ({
      kind: "checkpoint" as const,
      at: cp.createdAt,
      cp,
      index,
    })),
    ...Array.from(sessionBuckets.values()).map((events) => ({
      kind: "session" as const,
      at: events[events.length - 1]!.at,
      events,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  let prevManifest: Record<string, string> =
    chronologicalCps.length > 0
      ? chronologicalCps[0]!.manifest
      : Object.fromEntries(files.map((f) => [f.path, f.contentHash]));

  let sessionIndex = 0;
  for (const item of combined) {
    if (item.kind === "checkpoint") {
      if (item.index === 0) {
        prevManifest = item.cp.manifest;
        continue;
      }
      const diff = diffManifests(prevManifest, item.cp.manifest);
      const isAi = isAiCheckpointReason(item.cp.reason);
      cumulative += diff.total;
      points.push({
        id: item.cp.id,
        label: item.cp.label || `${cpPrefix} ${item.index + 1}`,
        shortLabel: `${cpPrefix} ${item.index + 1}`,
        at: item.cp.createdAt,
        filesChanged: diff.total,
        manualChanged: isAi ? 0 : diff.total,
        aiChanged: isAi ? diff.total : 0,
        cumulativeChanges: cumulative,
        fileCount: Object.keys(item.cp.manifest).length,
        kind: "checkpoint",
      });
      prevManifest = item.cp.manifest;
    } else {
      sessionIndex++;
      const manualPaths = new Set<string>();
      const aiPaths = new Set<string>();
      for (const e of item.events) {
        if (e.author === "ai") aiPaths.add(e.path);
        else manualPaths.add(e.path);
      }
      const allPaths = new Set([...manualPaths, ...aiPaths]);
      const totalChanged = allPaths.size;
      cumulative += totalChanged;
      const shortTime = formatShortTime(item.at, `#${sessionIndex}`);
      points.push({
        id: `session-${sessionIndex}-${item.at}`,
        label: `${shortTime}`,
        shortLabel: shortTime,
        at: item.at,
        filesChanged: totalChanged,
        manualChanged: manualPaths.size,
        aiChanged: aiPaths.size,
        cumulativeChanges: cumulative,
        fileCount: files.length,
        kind: "session",
      });
    }
  }

  // Add current working state point if there are uncommitted diffs or only 1 point exists.
  const currentManifest = Object.fromEntries(files.map((f) => [f.path, f.contentHash]));
  const uncommittedDiff =
    chronologicalCps.length > 0
      ? diffManifests(prevManifest, currentManifest).total
      : files.filter((f) => (Number(f.revision) || 1) > 1).length;

  const shouldAppendCurrent =
    points.length === 1 || uncommittedDiff > 0 || points[points.length - 1]?.kind === "checkpoint";

  if (shouldAppendCurrent) {
    cumulative += uncommittedDiff;
    points.push({
      id: "current",
      label: currentLabel,
      shortLabel: currentLabel,
      at: project.updatedAt,
      filesChanged: uncommittedDiff,
      manualChanged: uncommittedDiff,
      aiChanged: 0,
      cumulativeChanges: cumulative,
      fileCount: files.length,
      kind: "current",
    });
  }

  return points;
}

export function computeCodeAuthorship(
  files: ProjectFile[],
  contents: Record<string, string>,
  trackedAuthorship: Record<string, FileAuthorship>,
  checkpoints: Checkpoint[],
): CodeAuthorshipSummary {
  // Infer AI-touched files from AI checkpoints when no explicit localStorage record exists yet.
  const inferredAiPaths = new Set<string>();
  const chronological = [...checkpoints].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (let i = 1; i < chronological.length; i++) {
    const prev = chronological[i - 1]!;
    const curr = chronological[i]!;
    if (!isAiCheckpointReason(curr.reason)) continue;
    for (const [path, hash] of Object.entries(curr.manifest)) {
      if (prev.manifest[path] !== hash) inferredAiPaths.add(path);
    }
  }

  let totalAiLines = 0;
  let totalManualLines = 0;
  let aiFiles = 0;
  let manualFiles = 0;
  let mixedFiles = 0;
  let totalAiEdits = 0;
  let totalManualEdits = 0;

  const byFile: FileCodeOrigin[] = files.map((file) => {
    const totalLines = countLines(contents[file.path] ?? "");
    const record = trackedAuthorship[file.path];

    let aiLines = 0;
    let manualLines = totalLines;
    let aiEdits = 0;
    let manualEdits = Math.max(0, (Number(file.revision) || 1) - 1);

    if (record) {
      const trackedSum = record.aiLines + record.manualLines;
      if (trackedSum > 0 && trackedSum !== totalLines) {
        const aiRatio = record.aiLines / trackedSum;
        aiLines = Math.round(totalLines * aiRatio);
        manualLines = Math.max(0, totalLines - aiLines);
      } else {
        aiLines = Math.min(totalLines, record.aiLines);
        manualLines = Math.max(0, totalLines - aiLines);
      }
      aiEdits = record.aiEdits;
      manualEdits = record.manualEdits;
    } else if (inferredAiPaths.has(file.path)) {
      aiLines = totalLines;
      manualLines = 0;
      aiEdits = 1;
      manualEdits = 0;
    }

    totalAiLines += aiLines;
    totalManualLines += manualLines;
    totalAiEdits += aiEdits;
    totalManualEdits += manualEdits;

    const dominant: FileCodeOrigin["dominant"] =
      aiLines > 0 && manualLines > 0 ? "mixed" : aiLines > 0 ? "ai" : "manual";

    if (dominant === "ai") aiFiles++;
    else if (dominant === "mixed") mixedFiles++;
    else manualFiles++;

    return {
      path: file.path,
      name: fileNameOf(file.path),
      totalLines,
      aiLines,
      manualLines,
      aiPct: totalLines > 0 ? Math.round((aiLines / totalLines) * 1000) / 10 : 0,
      aiEdits,
      manualEdits,
      dominant,
    };
  });

  byFile.sort((a, b) => b.totalLines - a.totalLines || a.path.localeCompare(b.path));

  const totalLines = totalAiLines + totalManualLines;
  const aiPct = totalLines > 0 ? Math.round((totalAiLines / totalLines) * 1000) / 10 : 0;
  const manualPct = totalLines > 0 ? Math.round((100 - aiPct) * 10) / 10 : 0;

  return {
    aiLines: totalAiLines,
    manualLines: totalManualLines,
    totalLines,
    aiPct,
    manualPct,
    aiFiles,
    manualFiles,
    mixedFiles,
    aiEdits: totalAiEdits,
    manualEdits: totalManualEdits,
    byFile,
  };
}

export function computeProjectOverviewMetrics(
  project: Project,
  files: ProjectFile[],
  contents: Record<string, string>,
  checkpoints: Checkpoint[],
  trackedAuthorship: Record<string, FileAuthorship>,
  changeHistory: FileChangeEvent[],
  labels: { createdLabel?: string; currentLabel?: string; checkpointPrefix?: string } = {},
): ProjectOverviewMetrics {
  const dependency = computeDependencyGraph(files, contents);
  const timeline = computeFilesChangedTimeline(project, files, checkpoints, changeHistory, labels);
  const authorship = computeCodeAuthorship(files, contents, trackedAuthorship, checkpoints);

  const maxDependencyDepth = dependency.nodes.reduce((max, n) => Math.max(max, n.depth), 0);
  const avgDependencyDepth =
    dependency.nodes.length > 0
      ? Math.round(
          (dependency.nodes.reduce((sum, n) => sum + n.depth, 0) / dependency.nodes.length) * 10,
        ) / 10
      : 0;

  const filesModifiedTotal = timeline.reduce((sum, pt) => sum + pt.filesChanged, 0);

  return {
    summary: {
      totalFiles: files.length,
      totalLines: authorship.totalLines,
      totalChangeEvents: changeHistory.length + checkpoints.length,
      filesModifiedTotal,
      maxDependencyDepth,
      avgDependencyDepth,
      localEdges: dependency.localEdges,
      externalPackages: dependency.externalPackages,
      circularDeps: dependency.circularDeps,
      aiPct: authorship.aiPct,
      manualPct: authorship.manualPct,
      aiLines: authorship.aiLines,
      manualLines: authorship.manualLines,
    },
    filesChangedTimeline: timeline,
    dependencyNodes: dependency.nodes,
    depthDistribution: dependency.distribution,
    authorship,
  };
}
