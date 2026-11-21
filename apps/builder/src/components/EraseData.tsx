"use client";

import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import type { Locale } from "@ladestack/i18n";
import { erase } from "../i18n/erase";
import { browserClearDeps, clearPreviewCache } from "../preview/clear";
import { previewOrigin } from "../preview/origin";
import { setSession } from "../providers/session";
import { closeProjectStore } from "../storage/client";
import { eraseLocalData } from "../storage/erase";
import { ActionButton, MagicCard } from "./ui";
import styles from "./Welcome.module.css";

type State = "idle" | "busy" | "blocked" | "done" | "partial" | "failed";

/** Survives the reload after erasing, so the page can say the preview copy was not reached. */
const noteKey = "ladestack:erase-note";

function storages(): (Storage | null)[] {
  const get = (name: "sessionStorage" | "localStorage") => {
    try {
      return window[name];
    } catch {
      return null; // storage blocked
    }
  };
  return [get("sessionStorage"), get("localStorage")];
}

/** SET-03: erase everything this builder keeps in the browser, after an explicit confirmation. */
export function EraseData({ locale, title }: { locale: Locale; title?: string }) {
  const t = erase[locale];
  const [state, setState] = useState<State>("idle");

  useEffect(() => {
    try {
      if (sessionStorage.getItem(noteKey) === "preview") setState("partial");
      sessionStorage.removeItem(noteKey);
    } catch {
      // storage blocked: nothing to show
    }
  }, []);

  async function run() {
    if (!window.confirm(t.confirm)) return;
    setState("busy");
    // The preview origin's cached project copy goes first, while this page can still reach it.
    const preview = await clearPreviewCache(browserClearDeps(previewOrigin));
    const r = await eraseLocalData({
      factory: globalThis.indexedDB,
      storages: storages(),
      closeOwnConnection: closeProjectStore,
      onBlocked: () => setState("blocked"),
    });
    if (r.ok) {
      setSession(null); // drop the in-memory copy too and update the provider status
      setState("done");
      if (preview === "unreachable")
        try {
          sessionStorage.setItem(noteKey, "preview");
        } catch {
          // storage blocked
        }
      // Lists on this page (recent projects) read storage on mount; reload to show the empty state.
      window.location.reload();
    } else setState("failed");
  }

  const working = state === "busy" || state === "blocked";
  const statusText =
    state === "blocked"
      ? t.blocked
      : state === "done"
        ? t.done
        : state === "partial"
          ? t.previewNotCleared
          : state === "failed"
            ? t.failed
            : "";

  return (
    <MagicCard as="section" aria-labelledby="erase-title">
      <div className={styles.settingsCardInner}>
        <div className={styles.settingsCardHead}>
          <div className={styles.templateIconBox} aria-hidden="true" style={{ color: "#fca5a5" }}>
            <Trash2 size={17} />
          </div>
          <h2 id="erase-title" className={styles.sectionTitle}>
            {title ?? t.title}
          </h2>
        </div>
        <p className={styles.templateDesc}>{t.body}</p>
        <ActionButton
          type="button"
          variant="danger"
          onClick={() => void run()}
          disabled={working}
          aria-busy={working}
        >
          {working ? <Loader2 size={14} aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
          <span>{working ? t.busy : t.button}</span>
        </ActionButton>
        {statusText ? (
          <p
            role="status"
            className={state === "failed" || state === "partial" ? styles.error : styles.templateDesc}
          >
            {statusText}
          </p>
        ) : null}
      </div>
    </MagicCard>
  );
}
