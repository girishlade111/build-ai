"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FileCode2, Layers, Trash2 } from "lucide-react";
import { localeInfo, localePrefix, type Locale } from "@ladestack/i18n";
import type { Project } from "@ladestack/shared-types";
import { fill, recent } from "../i18n/recent";
import { getProjectStore } from "../storage/client";
import { mayHaveProjects } from "../storage/hasProjects";
import { MagicCard } from "./ui";
import styles from "./Welcome.module.css";

const shown = 12;

/** Projects saved in this browser, newest first. Renders nothing until there is one. */
export function RecentProjects({ locale }: { locale: Locale }) {
  const r = recent[locale];
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        if (!(await mayHaveProjects())) return;
        const list = await (await getProjectStore()).listProjects();
        if (live) setProjects(list.slice(0, shown));
      } catch {
        // Storage unavailable (private mode, blocked): the rest of the screen still works.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (projects.length === 0) return null;

  const date = new Intl.DateTimeFormat(localeInfo[locale].bcp47, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  async function remove(p: Project) {
    if (!window.confirm(fill(r.confirmRemove, p.name))) return;
    setBusy(p.id);
    setError(false);
    try {
      await (await getProjectStore()).deleteProject(p.id);
      setProjects((list) => list.filter((x) => x.id !== p.id));
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={styles.templates} aria-labelledby="recent-title">
      <div className={styles.sectionHeader}>
        <h2 id="recent-title" className={styles.sectionTitle}>
          {r.title}
        </h2>
        <p className={styles.sectionSubtitle}>{r.localNote}</p>
      </div>
      <MagicCard className={styles.recentCard}>
        <ul className={styles.recentList}>
          {projects.map((p) => (
            <li key={p.id} className={styles.recentItem}>
              <Link
                className={styles.recentLink}
                href={`${localePrefix(locale)}/project?id=${encodeURIComponent(p.id)}`}
              >
                <span className={styles.recentIcon} aria-hidden="true">
                  {p.profile === "react-vite" ? <Layers size={16} /> : <FileCode2 size={16} />}
                </span>
                <span className={styles.recentTextGroup}>
                  <span className={styles.templateName}>{p.name}</span>
                  <span className={styles.recentMeta}>
                    {p.profile === "react-vite" ? r.reactVite : r.static} · {r.edited}{" "}
                    <time dateTime={p.updatedAt}>{date.format(new Date(p.updatedAt))}</time>
                  </span>
                </span>
              </Link>
              <button
                type="button"
                className={styles.recentRemove}
                aria-label={fill(r.removeLabel, p.name)}
                disabled={busy === p.id}
                onClick={() => void remove(p)}
              >
                <Trash2 size={14} aria-hidden="true" />
                <span>{r.remove}</span>
              </button>
            </li>
          ))}
        </ul>
      </MagicCard>
      {error ? (
        <p className={styles.error} role="alert">
          {r.removeError}
        </p>
      ) : null}
    </section>
  );
}
