"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { BookmarkPlus, History, RotateCcw } from "lucide-react";
import { localeInfo, type Locale } from "@ladestack/i18n";
import type { Checkpoint } from "@ladestack/shared-types";
import { history } from "../i18n/history";
import { countText } from "../i18n/plural";
import { formatCheckpointTime } from "../history/time";
import { getProjectStore } from "../storage/client";
import { ActionButton, ShimmerButton } from "./ui";
import styles from "./Workspace.module.css";

type Notice = { text: string; error: boolean } | null;

/**
 * Checkpoint timeline (PRD A.20): every snapshot of the project, newest first, with Restore and a
 * manual "Save checkpoint". Restoring always saves the current files as a checkpoint first.
 */
export function CheckpointHistory({
  locale,
  projectId,
  busy,
  refreshKey,
  onRestored,
}: {
  locale: Locale;
  projectId: string;
  /** The agent is running: no restores or manual saves until it finishes. */
  busy: boolean;
  /** Changes whenever checkpoints may have been added elsewhere (agent runs, undo). */
  refreshKey: number;
  onRestored: () => void;
}) {
  const h = history[locale];
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Checkpoint[] | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const reload = useCallback(async () => {
    try {
      const store = await getProjectStore();
      setItems(await store.listCheckpoints(projectId));
    } catch {
      setItems([]);
      setNotice({ text: h.failed, error: true });
    }
  }, [projectId, h.failed]);

  useEffect(() => {
    if (open) void reload();
  }, [open, refreshKey, reload]);

  async function saveNow() {
    if (busy || working) return;
    setWorking(true);
    setNotice(null);
    try {
      const store = await getProjectStore();
      const made = await store.createCheckpoint(projectId, h.reasonManual, "manual");
      if (!made) setNotice({ text: h.failed, error: true });
      await reload();
    } catch {
      setNotice({ text: h.failed, error: true });
    } finally {
      setWorking(false);
    }
  }

  async function restore(id: string) {
    if (busy || working || !window.confirm(h.restoreConfirm)) return;
    setWorking(true);
    setNotice(null);
    try {
      const store = await getProjectStore();
      const r = await store.restoreCheckpoint(projectId, id);
      setNotice(r.ok ? { text: h.restored, error: false } : { text: h.failed, error: true });
      if (r.ok) onRestored();
      await reload();
    } catch {
      setNotice({ text: h.failed, error: true });
    } finally {
      setWorking(false);
    }
  }

  const reason: Record<Checkpoint["reason"], string> = {
    "auto-before-ai-edit": h.reasonAuto,
    manual: h.reasonManual,
    "before-restore": h.reasonBeforeRestore,
    "task-boundary": h.reasonTask,
  };

  return (
    <>
      <ActionButton
        variant="outline"
        compact
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <History size={13} aria-hidden="true" />
        <span>{h.history}</span>
      </ActionButton>
      <section
        id={panelId}
        className={styles.history}
        hidden={!open}
        aria-labelledby={`${panelId}-title`}
      >
        <div className={styles.historyHead}>
          <h2 id={`${panelId}-title`}>{h.title}</h2>
          <ShimmerButton compact onClick={() => void saveNow()} disabled={busy || working}>
            <BookmarkPlus size={13} aria-hidden="true" />
            <span>{working ? h.saving : h.saveNow}</span>
          </ShimmerButton>
        </div>
        <p className={styles.historyHint}>{busy ? h.busy : h.current}</p>
        {notice ? (
          <p className={styles.historyNotice} role={notice.error ? "alert" : "status"}>
            {notice.text}
          </p>
        ) : null}
        {items && items.length === 0 ? <p className={styles.historyHint}>{h.empty}</p> : null}
        {items && items.length > 0 ? (
          <ol className={styles.historyList}>
            {items.map((c) => (
              <li key={c.id}>
                <div>
                  <strong>{reason[c.reason]}</strong>
                  {c.reason !== "manual" && c.label ? <span> · {c.label}</span> : null}
                  <p>
                    <time
                      dateTime={c.createdAt}
                      title={new Date(c.createdAt).toLocaleString(localeInfo[locale].bcp47)}
                    >
                      {formatCheckpointTime(c.createdAt, localeInfo[locale].bcp47)}
                    </time>
                    {" · "}
                    {countText(locale, h.files, Object.keys(c.manifest).length)}
                  </p>
                </div>
                <ActionButton
                  variant="outline"
                  compact
                  onClick={() => void restore(c.id)}
                  disabled={busy || working}
                >
                  <RotateCcw size={12} aria-hidden="true" />
                  <span>{h.restore}</span>
                </ActionButton>
              </li>
            ))}
          </ol>
        ) : null}
      </section>
    </>
  );
}
