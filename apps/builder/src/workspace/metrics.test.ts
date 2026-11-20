import { describe, expect, it } from "vitest";
import type { Checkpoint, Project, ProjectFile } from "@ladestack/shared-types";
import {
  computeProjectMetrics,
  countLines,
  diffManifests,
  fileTypeLabel,
  formatBytes,
} from "./metrics";

const sampleProject: Project = {
  id: "proj-1",
  name: "React + Vite",
  profile: "react-vite",
  outputLanguage: "en",
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T12:00:00.000Z",
  headRevision: "4",
};

const sampleFiles: ProjectFile[] = [
  { id: "1", projectId: "proj-1", path: "index.html", contentHash: "h1", size: 220, revision: "1" },
  {
    id: "2",
    projectId: "proj-1",
    path: "src/App.tsx",
    contentHash: "h2-v2",
    size: 640,
    revision: "3",
  },
  { id: "3", projectId: "proj-1", path: "src/App.css", contentHash: "h3", size: 180, revision: "2" },
  {
    id: "4",
    projectId: "proj-1",
    path: "package.json",
    contentHash: "h4",
    size: 310,
    revision: "1",
  },
];

const sampleContents: Record<string, string> = {
  "index.html": "<!doctype html>\n<html>\n<body></body>\n</html>\n",
  "src/App.tsx": "export function App() {\n  return <main>Hello</main>;\n}\n",
  "src/App.css": "main {\n  padding: 1rem;\n}",
  "package.json": '{\n  "name": "app"\n}',
};

const sampleCheckpoints: Checkpoint[] = [
  {
    id: "cp-2",
    projectId: "proj-1",
    label: "Added styles",
    createdAt: "2026-10-01T11:30:00.000Z",
    reason: "manual",
    manifest: {
      "index.html": "h1",
      "src/App.tsx": "h2-v1",
      "src/App.css": "h3",
      "package.json": "h4",
    },
  },
  {
    id: "cp-1",
    projectId: "proj-1",
    label: "Initial scaffold",
    createdAt: "2026-10-01T10:15:00.000Z",
    reason: "task-boundary",
    manifest: {
      "index.html": "h1",
      "src/App.tsx": "h2-v1",
      "package.json": "h4",
    },
  },
];

describe("workspace metrics helpers", () => {
  it("classifies file extensions accurately", () => {
    expect(fileTypeLabel("src/App.tsx")).toBe("TypeScript");
    expect(fileTypeLabel("script.js")).toBe("JavaScript");
    expect(fileTypeLabel("index.html")).toBe("HTML");
    expect(fileTypeLabel("styles.css")).toBe("CSS");
    expect(fileTypeLabel("package.json")).toBe("JSON");
    expect(fileTypeLabel("README.md")).toBe("Markdown");
    expect(fileTypeLabel("assets/logo.svg")).toBe("Other");
  });

  it("counts lines without overcounting trailing newlines", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("one line")).toBe(1);
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("a\nb\nc")).toBe(3);
  });

  it("formats byte sizes cleanly", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(1_572_864)).toBe("1.50 MB");
  });

  it("computes manifest diffs across added, modified, and removed files", () => {
    const diff = diffManifests(
      { "a.ts": "1", "b.ts": "2", "old.ts": "3" },
      { "a.ts": "1", "b.ts": "2b", "new.ts": "4" },
    );
    expect(diff).toEqual({ added: 1, modified: 1, removed: 1, total: 3 });
  });
});

describe("computeProjectMetrics", () => {
  it("aggregates summary, file types, folders, and chronological checkpoint progress", () => {
    const m = computeProjectMetrics(sampleProject, sampleFiles, sampleContents, sampleCheckpoints);

    expect(m.summary).toEqual({
      totalFiles: 4,
      totalBytes: 1350,
      totalLines: 13,
      folderCount: 2,
      headRevision: 4,
      totalEdits: 3, // (3-1) + (2-1)
      checkpointCount: 2,
      dirtySinceCheckpoint: 1, // src/App.tsx changed from h2-v1 to h2-v2
    });

    expect(m.byType[0]).toMatchObject({ type: "TypeScript", files: 1, bytes: 640 });
    expect(m.byFolder).toEqual([
      { folder: "src", files: 2, bytes: 820, lines: 6, revisions: 5 },
      { folder: "(root)", files: 2, bytes: 530, lines: 7, revisions: 2 },
    ]);

    expect(m.progressTimeline).toHaveLength(3);
    expect(m.progressTimeline[0]).toMatchObject({
      id: "cp-1",
      shortLabel: "CP 1",
      fileCount: 3,
      changedFiles: 3,
    });
    expect(m.progressTimeline[1]).toMatchObject({
      id: "cp-2",
      shortLabel: "CP 2",
      fileCount: 4,
      addedFiles: 1,
      changedFiles: 1,
    });
    expect(m.progressTimeline[2]).toMatchObject({
      id: "current",
      shortLabel: "Current",
      fileCount: 4,
      modifiedFiles: 1,
      changedFiles: 1,
    });
  });

  it("handles empty projects with zero files and no checkpoints", () => {
    const m = computeProjectMetrics(sampleProject, [], {}, []);
    expect(m.summary.totalFiles).toBe(0);
    expect(m.summary.totalBytes).toBe(0);
    expect(m.summary.checkpointCount).toBe(0);
    expect(m.byType).toEqual([]);
    expect(m.byFolder).toEqual([]);
    expect(m.progressTimeline).toHaveLength(1);
    expect(m.progressTimeline[0]?.fileCount).toBe(0);
  });
});
