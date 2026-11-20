import type { Checkpoint, Project, ProjectFile } from "@ladestack/shared-types";

export type FileTypeKey =
  | "TypeScript"
  | "JavaScript"
  | "HTML"
  | "CSS"
  | "JSON"
  | "Markdown"
  | "Other";

export type MetricUnit = "bytes" | "lines" | "files";

export interface TypeMetric {
  type: FileTypeKey;
  files: number;
  bytes: number;
  lines: number;
  sharePct: number;
  color: string;
}

export interface FolderMetric {
  folder: string;
  files: number;
  bytes: number;
  lines: number;
  revisions: number;
}

export interface FileMetric {
  path: string;
  name: string;
  folder: string;
  type: FileTypeKey;
  color: string;
  bytes: number;
  lines: number;
  revision: number;
}

export interface ProgressPoint {
  id: string;
  label: string;
  shortLabel: string;
  createdAt: string;
  reason: Checkpoint["reason"] | "current";
  fileCount: number;
  changedFiles: number;
  addedFiles: number;
  modifiedFiles: number;
  removedFiles: number;
}

export interface ProjectMetricsSummary {
  totalFiles: number;
  totalBytes: number;
  totalLines: number;
  folderCount: number;
  headRevision: number;
  totalEdits: number;
  checkpointCount: number;
  dirtySinceCheckpoint: number;
}

export interface ProjectMetrics {
  summary: ProjectMetricsSummary;
  byType: TypeMetric[];
  byFolder: FolderMetric[];
  files: FileMetric[];
  progressTimeline: ProgressPoint[];
}

/** Curated warm IDE chart palette grounded in LadeStack Build design tokens. */
export const fileTypeColors: Record<FileTypeKey, string> = {
  TypeScript: "#9fbbe0",
  JavaScript: "#dfa88f",
  HTML: "#f54e00",
  CSS: "#c0a8dd",
  JSON: "#c08532",
  Markdown: "#9fc9a2",
  Other: "#8c887d",
};

export function fileTypeLabel(path: string): FileTypeKey {
  const lower = path.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".mts"))
    return "TypeScript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs") || lower.endsWith(".cjs"))
    return "JavaScript";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "HTML";
  if (lower.endsWith(".css") || lower.endsWith(".scss")) return "CSS";
  if (lower.endsWith(".json")) return "JSON";
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "Markdown";
  return "Other";
}

export function folderOf(path: string, rootLabel = "(root)"): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? rootLabel : path.slice(0, idx);
}

export function fileNameOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

export function countLines(content: string): number {
  if (content.length === 0) return 0;
  let lines = 1;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) lines++;
  }
  if (content.charCodeAt(content.length - 1) === 10) lines--;
  return Math.max(1, lines);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function diffManifests(
  prev: Record<string, string>,
  next: Record<string, string>,
): { added: number; modified: number; removed: number; total: number } {
  let added = 0;
  let modified = 0;
  let removed = 0;
  for (const [path, hash] of Object.entries(next)) {
    if (!(path in prev)) added++;
    else if (prev[path] !== hash) modified++;
  }
  for (const path of Object.keys(prev)) {
    if (!(path in next)) removed++;
  }
  return { added, modified, removed, total: added + modified + removed };
}

export function computeProjectMetrics(
  project: Project,
  files: ProjectFile[],
  contents: Record<string, string>,
  checkpoints: Checkpoint[],
  labels: { rootFolder?: string; currentLabel?: string; checkpointPrefix?: string } = {},
): ProjectMetrics {
  const rootFolder = labels.rootFolder ?? "(root)";
  const currentLabel = labels.currentLabel ?? "Current";
  const cpPrefix = labels.checkpointPrefix ?? "CP";

  const fileMetrics: FileMetric[] = files.map((file) => {
    const type = fileTypeLabel(file.path);
    const content = contents[file.path] ?? "";
    const lines = countLines(content);
    const revision = Math.max(1, Number(file.revision) || 1);
    return {
      path: file.path,
      name: fileNameOf(file.path),
      folder: folderOf(file.path, rootFolder),
      type,
      color: fileTypeColors[type],
      bytes: file.size,
      lines,
      revision,
    };
  });

  const sortedFiles = [...fileMetrics].sort(
    (a, b) => b.bytes - a.bytes || b.lines - a.lines || a.path.localeCompare(b.path),
  );

  const totalFiles = fileMetrics.length;
  const totalBytes = fileMetrics.reduce((sum, f) => sum + f.bytes, 0);
  const totalLines = fileMetrics.reduce((sum, f) => sum + f.lines, 0);
  const totalEdits = fileMetrics.reduce((sum, f) => sum + Math.max(0, f.revision - 1), 0);

  const typeMap = new Map<FileTypeKey, { files: number; bytes: number; lines: number }>();
  const folderMap = new Map<
    string,
    { files: number; bytes: number; lines: number; revisions: number }
  >();

  for (const f of fileMetrics) {
    const t = typeMap.get(f.type) ?? { files: 0, bytes: 0, lines: 0 };
    t.files += 1;
    t.bytes += f.bytes;
    t.lines += f.lines;
    typeMap.set(f.type, t);

    const dir = folderMap.get(f.folder) ?? { files: 0, bytes: 0, lines: 0, revisions: 0 };
    dir.files += 1;
    dir.bytes += f.bytes;
    dir.lines += f.lines;
    dir.revisions += f.revision;
    folderMap.set(f.folder, dir);
  }

  const byType: TypeMetric[] = Array.from(typeMap.entries())
    .map(([type, data]) => ({
      type,
      files: data.files,
      bytes: data.bytes,
      lines: data.lines,
      sharePct:
        totalBytes > 0
          ? Math.round((data.bytes / totalBytes) * 1000) / 10
          : totalFiles > 0
            ? Math.round((data.files / totalFiles) * 1000) / 10
            : 0,
      color: fileTypeColors[type],
    }))
    .sort((a, b) => b.bytes - a.bytes || b.files - a.files || a.type.localeCompare(b.type));

  const byFolder: FolderMetric[] = Array.from(folderMap.entries())
    .map(([folder, data]) => ({ folder, ...data }))
    .sort((a, b) => b.bytes - a.bytes || b.files - a.files || a.folder.localeCompare(b.folder));

  // Build chronological timeline from checkpoints (oldest first) + current working tree.
  const chronological = [...checkpoints].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const currentManifest: Record<string, string> = Object.fromEntries(
    files.map((f) => [f.path, f.contentHash]),
  );

  const progressTimeline: ProgressPoint[] = [];
  let prevManifest: Record<string, string> = {};

  chronological.forEach((cp, index) => {
    const diff =
      index === 0
        ? {
            added: Object.keys(cp.manifest).length,
            modified: 0,
            removed: 0,
            total: Object.keys(cp.manifest).length,
          }
        : diffManifests(prevManifest, cp.manifest);
    progressTimeline.push({
      id: cp.id,
      label: cp.label || `${cpPrefix} ${index + 1}`,
      shortLabel: `${cpPrefix} ${index + 1}`,
      createdAt: cp.createdAt,
      reason: cp.reason,
      fileCount: Object.keys(cp.manifest).length,
      changedFiles: diff.total,
      addedFiles: diff.added,
      modifiedFiles: diff.modified,
      removedFiles: diff.removed,
    });
    prevManifest = cp.manifest;
  });

  const currentDiff =
    chronological.length > 0
      ? diffManifests(prevManifest, currentManifest)
      : { added: totalFiles, modified: 0, removed: 0, total: totalFiles };

  progressTimeline.push({
    id: "current",
    label: currentLabel,
    shortLabel: currentLabel,
    createdAt: project.updatedAt,
    reason: "current",
    fileCount: totalFiles,
    changedFiles: currentDiff.total,
    addedFiles: currentDiff.added,
    modifiedFiles: currentDiff.modified,
    removedFiles: currentDiff.removed,
  });

  const dirtySinceCheckpoint = chronological.length > 0 ? currentDiff.total : totalFiles;

  return {
    summary: {
      totalFiles,
      totalBytes,
      totalLines,
      folderCount: folderMap.size,
      headRevision: Math.max(1, Number(project.headRevision) || 1),
      totalEdits,
      checkpointCount: checkpoints.length,
      dirtySinceCheckpoint,
    },
    byType,
    byFolder,
    files: sortedFiles,
    progressTimeline,
  };
}
