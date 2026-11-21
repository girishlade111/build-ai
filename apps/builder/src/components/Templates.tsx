import { FileCode2, FolderTree, Layers } from "lucide-react";
import { starterTemplates, type StarterTemplate } from "../templates";
import type { Locale } from "@ladestack/i18n";
import type { ShellStrings } from "../i18n/shell";
import { UseTemplateButton } from "./UseTemplateButton";
import { MagicCard } from "./ui";
import styles from "./Welcome.module.css";

/** Templates are explorable before any AI provider is connected (PRD A.12). */
export function Templates({ s, locale }: { s: ShellStrings; locale: Locale }) {
  const copy: Record<StarterTemplate["id"], { name: string; desc: string }> = {
    "static-site": { name: s.staticName, desc: s.staticDesc },
    "react-vite": { name: s.reactName, desc: s.reactDesc },
  };
  return (
    <section className={styles.templates} aria-labelledby="templates-title">
      <div className={styles.sectionHeader}>
        <h2 id="templates-title" className={styles.sectionTitle}>
          {s.templatesTitle}
        </h2>
      </div>
      <ul className={styles.templateList}>
        {starterTemplates.map((t) => {
          const fileCount = Object.keys(t.files).length;
          return (
            <MagicCard key={t.id} as="li" interactive className={styles.templateCard}>
              <div className={styles.templateInner}>
                <div className={styles.templateTop}>
                  <div className={styles.templateIconBox} aria-hidden="true">
                    {t.id === "react-vite" ? <Layers size={18} /> : <FileCode2 size={18} />}
                  </div>
                  <span className={styles.templateMetaText}>{fileCount} files</span>
                </div>

                <div>
                  <h3 className={styles.templateName}>{copy[t.id].name}</h3>
                  <p className={styles.templateDesc}>{copy[t.id].desc}</p>
                </div>

                <details className={styles.templateDetails}>
                  <summary className={styles.summary}>
                    <FolderTree size={14} aria-hidden="true" />
                    <span>
                      {s.showFiles} ({fileCount})
                    </span>
                  </summary>
                  <ul className={styles.fileList}>
                    {Object.keys(t.files)
                      .sort()
                      .map((p) => (
                        <li key={p}>
                          <code>{p}</code>
                        </li>
                      ))}
                  </ul>
                </details>

                <div className={styles.templateActions}>
                  <UseTemplateButton locale={locale} templateId={t.id} name={copy[t.id].name} />
                </div>
              </div>
            </MagicCard>
          );
        })}
      </ul>
    </section>
  );
}
