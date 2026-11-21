"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Activity,
  BarChart3,
  Code2,
  Download,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  Globe,
  Settings,
} from "lucide-react";
import { AgentPanel } from "./AgentPanel";
import { CheckpointHistory } from "./CheckpointHistory";
import { ErrorBoundary } from "./ErrorBoundary";
import { Preview } from "./Preview";
import { ProjectDashboard } from "./ProjectDashboard";
import { ProjectOverview } from "./ProjectOverview";
import { ActionButton, SegmentedControl } from "./ui";
import { PreviewController } from "../preview/controller";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { localePrefix, type Locale } from "@ladestack/i18n";
import type { Project, ProjectFile } from "@ladestack/shared-types";
import { settingsStrings } from "../i18n/settings";
import { workspace } from "../i18n/workspace";
import { getProjectStore } from "../storage/client";
import {
  AUTOSAVE_INTERVAL_MS,
  buildFileRevisionMap,
  estimateChangedLines,
  formatSavedClock,
  formatSavedDateTime,
  loadWorkspaceAutoSave,
  recordFileChange,
  saveWorkspaceAutoSave,
  type FileAuthorship,
  type FileChangeEvent,
  type WorkspaceView,
} from "../workspace/autosave";
import { buildFileTree, defaultFile, type TreeNode } from "../workspace/fileTree";
import { countLines } from "../workspace/metrics";
import { buildProjectZip, downloadZip, zipFileName } from "../export/zip";
import styles from "./Workspace.module.css";

// Monaco is heavy and browser-only: load it when a project opens, never on the welcome screen.
const CodeEditor = dynamic(() => import("../editor/CodeEditor").then((m) => m.CodeEditor), {
  ssr: false,
});

type Load =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "error" } // storage failed: not the same as a missing project (ERR-03)
  | { state: "ready"; project: Project };
type Save = "saved" | "dirty" | "saving" | "error" | "conflict";

interface OpenFile {
  path: string;
  revision: string;
  content: string;
}

const autosaveDelayMs = 800;

function FileIcon({ path }: { path: string }) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) return <FileJson size={14} className={styles.fileIcon} aria-hidden="true" />;
  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".html") ||
    lower.endsWith(".css")
  ) {
    return <FileCode2 size={14} className={styles.fileIcon} aria-hidden="true" />;
  }
  return <FileText size={14} className={styles.fileIcon} aria-hidden="true" />;
}

/** Screen B (PRD A.13): full-screen Code or Preview over the local project store. */
export function Workspace({ locale }: { locale: Locale }) {
  const w = workspace[locale];
  const id = useSearchParams().get("id");
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [fileError, setFileError] = useState(false);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [open, setOpen] = useState<OpenFile | null>(null);
  // The file the agent is writing right now, as it streams in (PRD: Monaco live streaming).
  const [draft, setDraft] = useState<{ path: string; content: string } | null>(null);
  const [follow, setFollow] = useState(true);
  const [save, setSave] = useState<Save>("saved");
  // Reload the preview whenever the saved files change.
  const [previewKey, setPreviewKey] = useState(0);
  const previewController = useMemo(() => new PreviewController(), []);
  const [agentRequest, setAgentRequest] = useState<
    { id: number; mode: "debug"; prompt: string } | undefined
  >();
  useEffect(() => {
    if (save === "saved") setPreviewKey((k) => k + 1);
  }, [save, files]);
  const [view, setView] = useState<WorkspaceView>("code");
  const [agentBusy, setAgentBusy] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState<string | null>(null);
  const [authorship, setAuthorship] = useState<Record<string, FileAuthorship>>({});
  const [changeHistory, setChangeHistory] = useState<FileChangeEvent[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** True while an edit is waiting for its autosave. */
  const pending = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;
  const saveRef = useRef(save);
  saveRef.current = save;
  const viewRef = useRef(view);
  viewRef.current = view;
  const followRef = useRef(follow);
  followRef.current = follow;
  const filesRef = useRef(files);
  filesRef.current = files;
  const projectRef = useRef<Project | null>(null);
  projectRef.current = load.state === "ready" ? load.project : null;
  const authorshipRef = useRef(authorship);
  authorshipRef.current = authorship;
  const changeHistoryRef = useRef(changeHistory);
  changeHistoryRef.current = changeHistory;
  const fileContentsCacheRef = useRef<Record<string, string>>({});

  const persistAutoSaveSnapshot = useCallback(
    (overrides?: {
      authorship?: Record<string, FileAuthorship>;
      changeHistory?: FileChangeEvent[];
      files?: ProjectFile[];
    }) => {
      const currentProject = projectRef.current;
      if (!id || !currentProject || typeof window === "undefined") return;
      const nowIso = new Date().toISOString();
      const currentOpen = openRef.current;
      const snapshotFiles = overrides?.files ?? filesRef.current;
      const res = saveWorkspaceAutoSave(window.localStorage, {
        version: 1,
        projectId: id,
        projectName: currentProject.name,
        savedAt: nowIso,
        view: viewRef.current,
        activeFilePath: currentOpen?.path ?? null,
        followEdits: followRef.current,
        openDraft: currentOpen
          ? {
              path: currentOpen.path,
              revision: currentOpen.revision,
              content: currentOpen.content,
              dirty: saveRef.current === "dirty",
            }
          : null,
        fileRevisions: buildFileRevisionMap(snapshotFiles),
        authorship: overrides?.authorship ?? authorshipRef.current,
        changeHistory: overrides?.changeHistory ?? changeHistoryRef.current,
      });
      if (res.ok) setLastAutoSavedAt(res.savedAt);
    },
    [id],
  );

  const openFile = useCallback(async (projectId: string, path: string) => {
    try {
      const store = await getProjectStore();
      const read = await store.readFile(projectId, path);
      if (read) setOpen({ path, revision: read.file.revision, content: read.content });
      setSave("saved");
      setFileError(false);
    } catch {
      // Keep whatever is on screen; nothing was written (ERR-02).
      setFileError(true);
    }
  }, []);

  useEffect(() => {
    if (!id) {
      setLoad({ state: "missing" });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const store = await getProjectStore();
        const project = await store.getProject(id);
        if (cancelled) return;
        if (!project) return setLoad({ state: "missing" });
        const list = await store.listFiles(id);
        if (cancelled) return;
        const allContents = await store.readAllFiles(id);
        if (cancelled) return;
        fileContentsCacheRef.current = Object.fromEntries(
          allContents.map((entry) => [entry.path, entry.content]),
        );
        const restoredAutoSave =
          typeof window !== "undefined" ? loadWorkspaceAutoSave(window.localStorage, id) : null;
        if (restoredAutoSave) {
          setAuthorship(restoredAutoSave.authorship);
          setChangeHistory(restoredAutoSave.changeHistory);
          setLastAutoSavedAt(restoredAutoSave.savedAt);
          authorshipRef.current = restoredAutoSave.authorship;
          changeHistoryRef.current = restoredAutoSave.changeHistory;
        } else {
          setAuthorship({});
          setChangeHistory([]);
          setLastAutoSavedAt(null);
          authorshipRef.current = {};
          changeHistoryRef.current = [];
        }
        setFiles(list);
        filesRef.current = list;
        projectRef.current = project;
        setLoad({ state: "ready", project });
        const preferred =
          restoredAutoSave?.activeFilePath &&
          list.some((f) => f.path === restoredAutoSave.activeFilePath)
            ? restoredAutoSave.activeFilePath
            : defaultFile(list.map((f) => f.path));
        if (preferred) await openFile(id, preferred);
      } catch {
        if (!cancelled) setLoad({ state: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, openFile, attempt]);

  // Periodically auto-save the current workspace project state to localStorage every 30 seconds.
  useEffect(() => {
    if (load.state !== "ready" || !id) return;
    persistAutoSaveSnapshot();
    const intervalId = window.setInterval(() => {
      persistAutoSaveSnapshot();
    }, AUTOSAVE_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [load.state, id, persistAutoSaveSnapshot]);

  const persist = useCallback(async () => {
    clearTimeout(timer.current);
    pending.current = false;
    const current = openRef.current;
    if (!id || !current) return;
    setSave("saving");
    try {
      const store = await getProjectStore();
      const result = await store.writeFile(id, current.path, current.content, current.revision);
      if (result.ok) {
        // Keep typing that happened while saving: only advance the revision.
        const prevContent = fileContentsCacheRef.current[current.path];
        fileContentsCacheRef.current[current.path] = current.content;
        const nextFiles = filesRef.current.map((f) =>
          f.path === result.file.path ? result.file : f,
        );
        const tracked = recordFileChange(
          { authorship: authorshipRef.current, changeHistory: changeHistoryRef.current },
          {
            path: current.path,
            author: "manual",
            totalLines: countLines(current.content),
            linesChanged: estimateChangedLines(prevContent, current.content),
            at: new Date().toISOString(),
          },
        );
        authorshipRef.current = tracked.authorship;
        changeHistoryRef.current = tracked.changeHistory;
        setAuthorship(tracked.authorship);
        setChangeHistory(tracked.changeHistory);
        setOpen((o) =>
          o && o.path === current.path ? { ...o, revision: result.file.revision } : o,
        );
        setFiles(nextFiles);
        filesRef.current = nextFiles;
        setSave(openRef.current?.content === current.content ? "saved" : "dirty");
        persistAutoSaveSnapshot({
          authorship: tracked.authorship,
          changeHistory: tracked.changeHistory,
          files: nextFiles,
        });
      } else {
        setSave(result.reason === "conflict" ? "conflict" : "error");
      }
    } catch {
      setSave("error");
    }
  }, [id, persistAutoSaveSnapshot]);

  // Leaving the workspace inside the app (home, settings) unmounts it: save what is pending first.
  const persistRef = useRef(persist);
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);
  const persistAutoSaveRef = useRef(persistAutoSaveSnapshot);
  useEffect(() => {
    persistAutoSaveRef.current = persistAutoSaveSnapshot;
  }, [persistAutoSaveSnapshot]);
  useEffect(
    () => () => {
      if (pending.current) void persistRef.current();
      persistAutoSaveRef.current();
    },
    [],
  );

  // Flush pending edits and auto-save snapshot when the tab is hidden or closed.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") {
        if (timer.current) void persist();
        persistAutoSaveSnapshot();
      }
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [persist, persistAutoSaveSnapshot]);

  function edit(content: string) {
    setOpen((o) => (o ? { ...o, content } : o));
    if (save === "conflict") return; // never autosave over a newer version
    setSave("dirty");
    pending.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(), autosaveDelayMs);
  }

  function saveNow() {
    if (save !== "conflict") void persist();
  }

  async function select(path: string) {
    if (!id || path === open?.path) return;
    if (save === "dirty") await persist();
    await openFile(id, path);
  }

  /** The agent saved a file: refresh the tree, track AI authorship, and update the open file unless dirty. */
  const agentWrote = useCallback(
    async (path: string) => {
      if (!id) return;
      const store = await getProjectStore();
      const [nextFiles, read] = await Promise.all([store.listFiles(id), store.readFile(id, path)]);
      setFiles(nextFiles);
      filesRef.current = nextFiles;
      if (read) {
        const prevContent = fileContentsCacheRef.current[path];
        fileContentsCacheRef.current[path] = read.content;
        const tracked = recordFileChange(
          { authorship: authorshipRef.current, changeHistory: changeHistoryRef.current },
          {
            path,
            author: "ai",
            totalLines: countLines(read.content),
            linesChanged: estimateChangedLines(prevContent, read.content),
            at: new Date().toISOString(),
          },
        );
        authorshipRef.current = tracked.authorship;
        changeHistoryRef.current = tracked.changeHistory;
        setAuthorship(tracked.authorship);
        setChangeHistory(tracked.changeHistory);
        persistAutoSaveSnapshot({
          authorship: tracked.authorship,
          changeHistory: tracked.changeHistory,
          files: nextFiles,
        });
      }
      const current = openRef.current;
      if (!current) await openFile(id, path);
      else if (current.path === path && saveRef.current !== "dirty") await openFile(id, path);
    },
    [id, openFile, persistAutoSaveSnapshot],
  );

  /** Files were restored or deleted: reload the tree and the open file. */
  const restored = useCallback(async () => {
    if (!id) return;
    const store = await getProjectStore();
    const list = await store.listFiles(id);
    setFiles(list);
    const paths = list.map((f) => f.path);
    const current = openRef.current?.path;
    // Unsaved edits stay on screen; saving them later reports a conflict instead of overwriting.
    if (current && saveRef.current === "dirty") return;
    const next = current && paths.includes(current) ? current : defaultFile(paths);
    if (next) await openFile(id, next);
    else setOpen(null);
  }, [id, openFile]);

  const [exporting, setExporting] = useState<"idle" | "busy" | "error">("idle");

  async function exportZip() {
    if (!id || load.state !== "ready") return;
    setExporting("busy");
    try {
      if (save === "dirty") await persist(); // export what the user sees, not a stale copy
      const store = await getProjectStore();
      const bytes = buildProjectZip(await store.readAllFiles(id));
      downloadZip(bytes, zipFileName(load.project.name));
      setExporting("idle");
    } catch {
      setExporting("error");
    }
  }

  const home = `${localePrefix(locale)}/`;

  if (load.state !== "ready") {
    return (
      <main className={styles.message}>
        {load.state === "error" ? (
          <>
            <p role="alert">{w.storageError}</p>
            <button
              type="button"
              onClick={() => {
                setLoad({ state: "loading" });
                setAttempt((n) => n + 1);
              }}
            >
              {w.retry}
            </button>
          </>
        ) : (
          <p role="status">
            {load.state === "loading" ? w.loading : id ? w.notFound : w.missingId}
          </p>
        )}
        {load.state !== "loading" ? <Link href={home}>{w.back}</Link> : null}
      </main>
    );
  }

  const status: Record<Save, string> = {
    saved: w.saved,
    dirty: w.unsaved,
    saving: w.saving,
    error: w.saveError,
    conflict: w.conflict,
  };

  const viewItems: ReadonlyArray<{ value: WorkspaceView; label: string; icon: React.ReactNode }> = [
    { value: "code", label: w.code, icon: <Code2 size={14} aria-hidden="true" /> },
    { value: "preview", label: w.preview, icon: <Globe size={14} aria-hidden="true" /> },
    { value: "overview", label: w.overview, icon: <Activity size={14} aria-hidden="true" /> },
    { value: "dashboard", label: w.dashboard, icon: <BarChart3 size={14} aria-hidden="true" /> },
  ];

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link className={styles.home} href={home} aria-label={w.back}>
            LadeStack <span>Build</span>
          </Link>
          <span className={styles.crumbSep} aria-hidden="true">
            /
          </span>
          <h1 className={styles.projectName}>{load.project.name}</h1>
        </div>

        <div className={styles.headerCenter}>
          <SegmentedControl
            items={viewItems}
            value={view}
            onChange={setView}
            ariaLabel={w.viewLabel}
          />
        </div>

        <div className={styles.headerRight}>
          <ActionButton
            variant="outline"
            compact
            onClick={() => void exportZip()}
            disabled={exporting === "busy"}
          >
            <Download size={13} aria-hidden="true" />
            <span>{exporting === "busy" ? w.exporting : w.exportZip}</span>
          </ActionButton>
          <CheckpointHistory
            locale={locale}
            projectId={id!}
            busy={agentBusy}
            refreshKey={historyKey}
            onRestored={() => void restored()}
          />
          <Link className={styles.settingsLink} href={`${localePrefix(locale)}/settings`}>
            <Settings size={14} aria-hidden="true" />
            <span>{settingsStrings[locale].link}</span>
          </Link>
          <p
            className={styles.saveState}
            role="status"
            aria-live="polite"
            data-state={save}
            data-testid="workspace-autosave"
            title={
              lastAutoSavedAt
                ? `${w.autoSaveTooltip} (${formatSavedDateTime(lastAutoSavedAt, locale)})`
                : w.autoSaveTooltip
            }
          >
            {save === "conflict" || save === "error" ? null : (
              <>
                <span>{status[save]}</span>
                <span className={styles.saveSep} aria-hidden="true">
                  ·
                </span>
                {lastAutoSavedAt ? (
                  <span className={styles.autoSaveText}>
                    {w.autoSavedLabel}{" "}
                    <time className={styles.autoSaveTime} dateTime={lastAutoSavedAt}>
                      {formatSavedClock(lastAutoSavedAt, locale)}
                    </time>
                  </span>
                ) : (
                  <span className={styles.autoSaveText}>{w.autoSavePending}</span>
                )}
              </>
            )}
          </p>
        </div>
      </header>

      {exporting === "error" ? (
        <p className={styles.alert} role="alert">
          {w.exportError}
        </p>
      ) : null}
      {fileError ? (
        <p className={styles.alert} role="alert">
          {w.fileError}
        </p>
      ) : null}
      {save === "conflict" || save === "error" ? (
        <div className={styles.alert} role="alert">
          <span>{status[save]}</span>
          {save === "conflict" && open ? (
            <button type="button" onClick={() => void openFile(id!, open.path)}>
              {w.reloadFile}
            </button>
          ) : null}
          {save === "error" ? (
            <button type="button" onClick={() => void persist()}>
              {w.retrySave}
            </button>
          ) : null}
        </div>
      ) : null}

      {view === "code" ? (
        <ErrorBoundary
          locale={locale}
          scope="editor"
          variant="workspace"
          resetKeys={[id, view, open?.path, draft?.path]}
        >
          <div className={styles.code}>
            <nav className={styles.explorer} aria-label={w.files}>
              <div className={styles.explorerHead}>
                <p className={styles.explorerTitle}>{w.files}</p>
                <span className={styles.explorerCount}>{files.length}</span>
              </div>
              <label className={styles.follow}>
                <input
                  type="checkbox"
                  checked={follow}
                  onChange={(e) => setFollow(e.target.checked)}
                />
                <span>{w.followEdits}</span>
              </label>
              <Tree
                nodes={buildFileTree(files.map((f) => f.path))}
                active={open?.path}
                onSelect={select}
                nested={false}
              />
            </nav>

            <section className={styles.editorPane}>
              {draft && follow && save !== "dirty" ? (
                <>
                  <p className={styles.breadcrumb}>
                    <FileIcon path={draft.path} />
                    <span>{draft.path}</span>
                    <span className={styles.writing} role="status">
                      · {w.agentWriting}
                    </span>
                  </p>
                  <div className={styles.editor}>
                    <CodeEditor
                      path={draft.path}
                      value={draft.content}
                      loadingLabel={w.editorLoading}
                      onChange={() => {}}
                      onSave={() => {}}
                      readOnly
                    />
                  </div>
                </>
              ) : open ? (
                <>
                  <p className={styles.breadcrumb}>
                    <FileIcon path={open.path} />
                    <span>{open.path}</span>
                    {save === "dirty" ? <span className={styles.dirtyDot} aria-hidden="true" /> : null}
                  </p>
                  <div className={styles.editor}>
                    <CodeEditor
                      path={open.path}
                      value={open.content}
                      loadingLabel={w.editorLoading}
                      onChange={edit}
                      onSave={saveNow}
                    />
                  </div>
                </>
              ) : (
                <p className={styles.empty}>{w.selectFile}</p>
              )}
            </section>
          </div>
        </ErrorBoundary>
      ) : null}

      {view === "overview" ? (
        <ErrorBoundary
          locale={locale}
          scope="overview"
          variant="workspace"
          resetKeys={[id, view, previewKey, historyKey]}
        >
          <ProjectOverview
            locale={locale}
            project={load.project}
            files={files}
            refreshKey={previewKey}
            historyKey={historyKey}
            authorship={authorship}
            changeHistory={changeHistory}
            lastAutoSavedAt={lastAutoSavedAt}
            onOpenFile={(path) => {
              void select(path);
              setView("code");
            }}
            onSnapshotSaved={() => {
              setHistoryKey((k) => k + 1);
              persistAutoSaveSnapshot();
            }}
          />
        </ErrorBoundary>
      ) : null}

      {view === "dashboard" ? (
        <ErrorBoundary
          locale={locale}
          scope="dashboard"
          variant="workspace"
          resetKeys={[id, view, previewKey, historyKey]}
        >
          <ProjectDashboard
            locale={locale}
            project={load.project}
            files={files}
            refreshKey={previewKey}
            historyKey={historyKey}
            onOpenFile={(path) => {
              void select(path);
              setView("code");
            }}
            onCheckpointCreated={() => {
              setHistoryKey((k) => k + 1);
              persistAutoSaveSnapshot();
            }}
          />
        </ErrorBoundary>
      ) : null}

      {/* Kept mounted while editing so the agent's check_preview can reload it. */}
      <div className={view === "preview" ? styles.previewWrap : styles.hiddenPane}>
        <ErrorBoundary
          locale={locale}
          scope="preview"
          variant="workspace"
          resetKeys={[id, view, previewKey]}
        >
          <Preview
            locale={locale}
            projectId={id!}
            paths={files.map((f) => f.path)}
            refreshKey={previewKey}
            controller={previewController}
            onDebug={(prompt) =>
              setAgentRequest((r) => ({ id: (r?.id ?? 0) + 1, mode: "debug", prompt }))
            }
          />
        </ErrorBoundary>
      </div>

      <ErrorBoundary locale={locale} scope="agent" variant="workspace" compact resetKeys={[id]}>
        <AgentPanel
          locale={locale}
          projectId={id!}
          onWrite={(p) => void agentWrote(p)}
          onDraft={setDraft}
          onFilesChanged={() => {
            setHistoryKey((k) => k + 1);
            void restored();
          }}
          request={agentRequest}
          checkPreview={() => previewController.check()}
          onRunningChange={(r) => {
            setAgentBusy(r);
            if (!r) setHistoryKey((k) => k + 1);
          }}
        />
      </ErrorBoundary>
    </div>
  );
}

function Tree({
  nodes,
  active,
  onSelect,
  nested,
}: {
  nodes: TreeNode[];
  active: string | undefined;
  onSelect: (path: string) => void;
  nested: boolean;
}) {
  return (
    <ul className={nested ? `${styles.tree} ${styles.treeNested}` : styles.tree}>
      {nodes.map((n) =>
        n.children ? (
          <li key={n.path}>
            <details open>
              <summary className={styles.folder}>
                <Folder size={14} className={styles.fileIcon} aria-hidden="true" />
                <span>{n.name}</span>
              </summary>
              <Tree nodes={n.children} active={active} onSelect={onSelect} nested />
            </details>
          </li>
        ) : (
          <li key={n.path}>
            <button
              type="button"
              className={styles.file}
              aria-current={n.path === active ? "true" : undefined}
              onClick={() => onSelect(n.path)}
            >
              <FileIcon path={n.path} />
              <span className={styles.fileName}>{n.name}</span>
            </button>
          </li>
        ),
      )}
    </ul>
  );
}
