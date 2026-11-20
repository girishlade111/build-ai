import { describe, expect, it } from "vitest";
import type { Checkpoint, Project, ProjectFile } from "@ladestack/shared-types";
import {
  computeCodeAuthorship,
  computeDependencyGraph,
  computeFilesChangedTimeline,
  computeProjectOverviewMetrics,
  extractImportSpecifiers,
} from "./overviewMetrics";

const baseProject: Project = {
  id: "proj-1",
  name: "Demo React App",
  profile: "react-vite",
  outputLanguage: "en",
  createdAt: "2026-11-20T10:00:00.000Z",
  updatedAt: "2026-11-20T10:30:00.000Z",
  headRevision: "5",
};

function makeFile(path: string, content: string, revision = "1"): ProjectFile {
  return {
    id: `id-${path}`,
    projectId: baseProject.id,
    path,
    contentHash: `hash-${path}-${revision}`,
    size: content.length,
    revision,
  };
}

describe("overviewMetrics", () => {
  it("extracts ES imports, HTML script/link tags, and CSS @import", () => {
    expect(
      extractImportSpecifiers(
        "src/main.tsx",
        `import React from "react";\nimport App from "./App";\nimport "./App.css";`,
      ),
    ).toEqual(["react", "./App", "./App.css"]);

    expect(
      extractImportSpecifiers(
        "index.html",
        `<link rel="stylesheet" href="styles.css" /><script type="module" src="/src/main.tsx"></script>`,
      ),
    ).toEqual(["/src/main.tsx", "styles.css"]);
  });

  it("computes multi-level component dependency depth and external package counts", () => {
    const contents: Record<string, string> = {
      "index.html": `<script type="module" src="/src/main.tsx"></script>`,
      "src/main.tsx": `import App from "./App";\nimport "./App.css";`,
      "src/App.tsx": `import { useState } from "react";\nimport { Card } from "./components/Card";`,
      "src/components/Card.tsx": `import { Button } from "./Button";`,
      "src/components/Button.tsx": `export function Button() { return null; }`,
      "src/App.css": `body { margin: 0; }`,
    };
    const files = Object.entries(contents).map(([p, c]) => makeFile(p, c));
    const graph = computeDependencyGraph(files, contents);

    const byPath = Object.fromEntries(graph.nodes.map((n) => [n.path, n]));
    expect(byPath["src/components/Button.tsx"]?.depth).toBe(0);
    expect(byPath["src/components/Card.tsx"]?.depth).toBe(1);
    expect(byPath["src/App.tsx"]?.depth).toBe(2);
    expect(byPath["src/main.tsx"]?.depth).toBe(3);
    expect(byPath["index.html"]?.depth).toBe(4);
    expect(graph.localEdges).toBe(5);
    expect(graph.externalPackages).toBe(1);
    expect(graph.circularDeps).toBe(0);
  });

  it("handles circular dependencies safely without infinite recursion", () => {
    const contents: Record<string, string> = {
      "src/a.ts": `import "./b";`,
      "src/b.ts": `import "./a";`,
    };
    const files = Object.entries(contents).map(([p, c]) => makeFile(p, c));
    const graph = computeDependencyGraph(files, contents);

    expect(graph.circularDeps).toBe(2);
    expect(graph.nodes.every((n) => n.hasCycle)).toBe(true);
  });

  it("builds files-changed-over-time from checkpoints and session change events", () => {
    const contents: Record<string, string> = {
      "src/App.tsx": "line1\nline2\n",
      "src/Button.tsx": "export const B = 1;\n",
    };
    const files = [makeFile("src/App.tsx", contents["src/App.tsx"]!, "3"), makeFile("src/Button.tsx", contents["src/Button.tsx"]!, "2")];
    const checkpoints: Checkpoint[] = [
      {
        id: "cp-1",
        projectId: baseProject.id,
        label: "Initial",
        createdAt: "2026-11-20T10:05:00.000Z",
        reason: "manual",
        manifest: { "src/App.tsx": "h0" },
      },
      {
        id: "cp-2",
        projectId: baseProject.id,
        label: "AI layout",
        createdAt: "2026-11-20T10:15:00.000Z",
        reason: "task-boundary",
        manifest: { "src/App.tsx": "h1", "src/Button.tsx": "h2" },
      },
    ];
    const timeline = computeFilesChangedTimeline(baseProject, files, checkpoints, [
      {
        id: "ev-1",
        at: "2026-11-20T10:20:00.000Z",
        path: "src/App.tsx",
        author: "manual",
        linesChanged: 1,
        totalLines: 2,
      },
    ]);

    expect(timeline.length).toBeGreaterThanOrEqual(4);
    const aiCp = timeline.find((p) => p.id === "cp-2");
    expect(aiCp?.aiChanged).toBe(2);
    expect(aiCp?.manualChanged).toBe(0);
    const sessionPt = timeline.find((p) => p.kind === "session");
    expect(sessionPt?.manualChanged).toBe(1);
  });

  it("computes AI vs manual code statistics from tracked authorship and AI checkpoints", () => {
    const contents: Record<string, string> = {
      "src/App.tsx": "a\nb\nc\nd\n",
      "src/AiChart.tsx": "1\n2\n3\n4\n5\n6\n",
    };
    const files = [
      makeFile("src/App.tsx", contents["src/App.tsx"]!, "2"),
      makeFile("src/AiChart.tsx", contents["src/AiChart.tsx"]!, "1"),
    ];
    const summary = computeCodeAuthorship(
      files,
      contents,
      {
        "src/AiChart.tsx": {
          aiLines: 6,
          manualLines: 0,
          aiEdits: 1,
          manualEdits: 0,
          lastAuthor: "ai",
          updatedAt: "2026-11-20T10:15:00.000Z",
        },
      },
      [],
    );

    expect(summary.totalLines).toBe(10);
    expect(summary.aiLines).toBe(6);
    expect(summary.manualLines).toBe(4);
    expect(summary.aiPct).toBe(60);
    expect(summary.manualPct).toBe(40);
    expect(summary.aiFiles).toBe(1);
    expect(summary.manualFiles).toBe(1);
  });

  it("assembles complete ProjectOverviewMetrics end-to-end", () => {
    const contents: Record<string, string> = {
      "index.html": `<script type="module" src="/src/main.tsx"></script>`,
      "src/main.tsx": `import App from "./App";`,
      "src/App.tsx": `export default function App() { return null; }\n`,
    };
    const files = Object.entries(contents).map(([p, c]) => makeFile(p, c));
    const overview = computeProjectOverviewMetrics(baseProject, files, contents, [], {}, []);

    expect(overview.summary.totalFiles).toBe(3);
    expect(overview.summary.maxDependencyDepth).toBe(2);
    expect(overview.summary.manualPct).toBe(100);
    expect(overview.filesChangedTimeline.length).toBeGreaterThanOrEqual(2);
  });
});
