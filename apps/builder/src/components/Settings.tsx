import Link from "next/link";
import { ArrowLeft, Check, Globe, Info, KeyRound } from "lucide-react";
import { localeInfo, localePrefix, locales, type Locale } from "@ladestack/i18n";
import { settingsStrings } from "../i18n/settings";
import { shell } from "../i18n/shell";
import { EraseData } from "./EraseData";
import { ProviderSetup } from "./ProviderSetup";
import { BlurFade, DotPattern, MagicCard } from "./ui";
import styles from "./Welcome.module.css";

/** Minimum settings (SET-01..04): provider, language, local data, about. No account, no billing. */
export function Settings({ locale }: { locale: Locale }) {
  const t = settingsStrings[locale];
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
        <div className={styles.headerActions}>
          <Link className={styles.headerLink} href={`${prefix}/`}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ArrowLeft size={14} aria-hidden="true" />
              {t.back}
            </span>
          </Link>
        </div>
      </header>

      <main className={styles.settingsMain}>
        <BlurFade>
          <div className={styles.settingsHero}>
            <h1 className={styles.settingsTitle}>{t.title}</h1>
          </div>
        </BlurFade>

        <BlurFade delayMs={60}>
          <MagicCard as="section" aria-labelledby="settings-provider">
            <div className={styles.settingsCardInner}>
              <div className={styles.settingsCardHead}>
                <div className={styles.templateIconBox} aria-hidden="true">
                  <KeyRound size={17} />
                </div>
                <h2 id="settings-provider" className={styles.sectionTitle}>
                  {t.provider}
                </h2>
              </div>
              <p className={styles.templateDesc}>{t.providerBody}</p>
              <ProviderSetup locale={locale} idleLabel={shell[locale].providerStatus} />
            </div>
          </MagicCard>
        </BlurFade>

        <BlurFade delayMs={110}>
          <MagicCard as="section" aria-labelledby="settings-language">
            <div className={styles.settingsCardInner}>
              <div className={styles.settingsCardHead}>
                <div className={styles.templateIconBox} aria-hidden="true">
                  <Globe size={17} />
                </div>
                <h2 id="settings-language" className={styles.sectionTitle}>
                  {t.language}
                </h2>
              </div>
              <p className={styles.templateDesc}>{t.languageBody}</p>
              <ul className={styles.languages}>
                {locales.map((l) => (
                  <li key={l}>
                    <Link
                      className={styles.language}
                      href={`${localePrefix(l)}/settings`}
                      hrefLang={localeInfo[l].bcp47}
                      lang={localeInfo[l].bcp47}
                      aria-current={l === locale ? "page" : undefined}
                    >
                      <span>{localeInfo[l].nativeName}</span>
                      {l === locale ? <Check size={14} aria-hidden="true" /> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </MagicCard>
        </BlurFade>

        <BlurFade delayMs={160}>
          <EraseData locale={locale} title={t.data} />
        </BlurFade>

        <BlurFade delayMs={210}>
          <MagicCard as="section" aria-labelledby="settings-about">
            <div className={styles.settingsCardInner}>
              <div className={styles.settingsCardHead}>
                <div className={styles.templateIconBox} aria-hidden="true">
                  <Info size={17} />
                </div>
                <h2 id="settings-about" className={styles.sectionTitle}>
                  {t.about}
                </h2>
              </div>
              <p className={styles.templateDesc}>{t.aboutBody}</p>
              <a className={styles.back} href={`${prefix}/open-source`}>
                {t.openSource}
              </a>
            </div>
          </MagicCard>
        </BlurFade>
      </main>
    </div>
  );
}
