import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { localePrefix, type Locale } from "@ladestack/i18n";
import { shell } from "../i18n/shell";
import { settingsStrings } from "../i18n/settings";
import { Composer } from "./Composer";
import { ImportZip } from "./ImportZip";
import { ProviderSetup } from "./ProviderSetup";
import { RecentProjects } from "./RecentProjects";
import { Templates } from "./Templates";
import { BlurFade, DotPattern } from "./ui";
import styles from "./Welcome.module.css";

/** Screen A (PRD A.12): the first screen of the builder. Loads no editor or runtime. */
export function Welcome({ locale }: { locale: Locale }) {
  const s = shell[locale];
  const prefix = localePrefix(locale);
  return (
    <div className={styles.page}>
      <div className={styles.backdrop} aria-hidden="true">
        <DotPattern />
        <div className={styles.ambientGlow} />
      </div>

      <header className={styles.header}>
        {/* Plain anchor: the homepage is served by the Astro app, outside this basePath. */}
        <a className={styles.wordmark} href={`${prefix}/`}>
          LadeStack <span>Build</span>
        </a>

        <nav className={styles.navLinks} aria-label="Primary">
          <a className={styles.headerLink} href="#templates-title">
            {s.templatesTitle}
          </a>
          <a className={styles.headerLink} href="#import-title">
            Import
          </a>
          <Link className={styles.headerLink} href={`${prefix}/settings`}>
            {settingsStrings[locale].link}
          </Link>
        </nav>

        <div className={styles.headerActions}>
          <ProviderSetup locale={locale} idleLabel={s.providerStatus} />
        </div>
      </header>

      <main className={styles.main}>
        <BlurFade>
          <div className={styles.heroBlock}>
            <p className={styles.kicker}>{s.kicker}</p>
            <h1 className={styles.title}>{s.title}</h1>
          </div>
          <Composer s={s} locale={locale} />
          <div className={styles.heroNotes}>
            <p className={styles.note}>{s.freeNote}</p>
            <p className={styles.note}>{s.body}</p>
          </div>
        </BlurFade>

        <BlurFade delayMs={80}>
          <RecentProjects locale={locale} />
        </BlurFade>

        <BlurFade delayMs={140}>
          <Templates s={s} locale={locale} />
        </BlurFade>

        <BlurFade delayMs={200}>
          <ImportZip locale={locale} />
        </BlurFade>

        <footer className={styles.footerBar}>
          <a className={styles.back} href={`${prefix}/`}>
            <ArrowLeft size={15} aria-hidden="true" />
            <span>{s.back}</span>
          </a>
        </footer>
      </main>
    </div>
  );
}
