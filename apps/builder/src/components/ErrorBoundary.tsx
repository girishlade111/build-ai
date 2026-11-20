"use client";

import Link from "next/link";
import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { localePrefix, type Locale } from "@ladestack/i18n";
import {
  formatErrorCopyText,
  haveResetKeysChanged,
  normalizeUiError,
  type UiErrorReport,
} from "../errors/formatError";
import { errorBoundaryStrings, type ErrorBoundaryScope } from "../i18n/errorBoundary";
import styles from "./ErrorBoundary.module.css";

export interface ErrorBoundaryProps {
  children: ReactNode;
  locale?: Locale;
  scope?: ErrorBoundaryScope;
  variant?: "workspace" | "global";
  compact?: boolean;
  /** Automatically clears the boundary when any key changes (e.g. view switch or file change). */
  resetKeys?: readonly unknown[];
  onReset?: () => void;
}

interface ErrorBoundaryState {
  report: UiErrorReport | null;
}

export interface ErrorFallbackProps {
  report: UiErrorReport;
  locale: Locale;
  scope: ErrorBoundaryScope;
  variant: "workspace" | "global";
  compact?: boolean;
  onRetry: () => void;
}

export function ErrorFallback({
  report,
  locale,
  scope,
  variant,
  compact = false,
  onRetry,
}: ErrorFallbackProps) {
  const s = errorBoundaryStrings[locale];
  const scopeLabel = s.scopes[scope];
  const [copied, setCopied] = useState(false);
  const home = `${localePrefix(locale)}/`;

  async function copyDetails() {
    const text = formatErrorCopyText(report, scopeLabel);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be unavailable in restricted contexts.
    }
  }

  if (compact) {
    return (
      <section
        className={styles.compact}
        role="alert"
        aria-live="assertive"
        data-testid={`error-boundary-${scope}`}
      >
        <div className={styles.compactText}>
          <p className={styles.compactTitle}>
            {scopeLabel} · {report.name}
          </p>
          <p className={styles.compactMessage}>{s.compactBody}</p>
        </div>
        <button type="button" className={styles.primaryBtn} onClick={onRetry}>
          {s.retry}
        </button>
      </section>
    );
  }

  const themeClass = variant === "workspace" ? styles.workspace : styles.global;
  const diagnosticText = formatErrorCopyText(report, scopeLabel);

  return (
    <section
      className={`${styles.container} ${themeClass}`}
      role="alert"
      aria-live="assertive"
      data-testid={`error-boundary-${scope}`}
    >
      <div className={styles.card}>
        <p className={styles.meta}>
          <span>{scopeLabel}</span>
          <span aria-hidden="true">·</span>
          <span className={styles.errorCode}>{report.name}</span>
        </p>
        <h2 className={styles.heading}>{s.heading}</h2>
        <p className={styles.body}>{s.body}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primaryBtn} onClick={onRetry}>
            {s.retry}
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => window.location.reload()}
          >
            {s.reload}
          </button>
          {scope === "app" || scope === "workspace" ? (
            <Link className={styles.homeLink} href={home}>
              {s.backHome}
            </Link>
          ) : null}
        </div>
        <details className={styles.details}>
          <summary>{s.details}</summary>
          <div className={styles.detailsBody}>
            <pre className={styles.stackPre}>{diagnosticText}</pre>
            <div className={styles.detailsFooter}>
              <button
                type="button"
                className={styles.copyBtn}
                onClick={() => void copyDetails()}
              >
                {copied ? s.copied : s.copyDetails}
              </button>
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}

/**
 * Global and Workspace-scoped React Error Boundary. Catches render and lifecycle exceptions
 * inside its subtree and renders a localized recovery UI without losing local project files.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { report: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { report: normalizeUiError(error) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    const report = normalizeUiError(error, info.componentStack);
    this.setState({ report });
    console.error(`[ErrorBoundary:${this.props.scope ?? "app"}]`, error);
  }

  override componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.report && haveResetKeysChanged(prevProps.resetKeys, this.props.resetKeys)) {
      this.setState({ report: null });
    }
  }

  private readonly handleRetry = () => {
    this.setState({ report: null });
    this.props.onReset?.();
  };

  override render() {
    if (this.state.report) {
      return (
        <ErrorFallback
          report={this.state.report}
          locale={this.props.locale ?? "en"}
          scope={this.props.scope ?? "app"}
          variant={this.props.variant ?? "workspace"}
          compact={this.props.compact}
          onRetry={this.handleRetry}
        />
      );
    }
    return this.props.children;
  }
}
