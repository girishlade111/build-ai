export interface UiErrorReport {
  name: string;
  message: string;
  stack: string | null;
  componentStack: string | null;
  timestamp: string;
}

const MAX_DETAIL_CHARS = 2400;

/**
 * Redacts common API keys and bearer tokens before rendering or copying diagnostics
 * so BYOK credentials never leak through UI error details.
 */
export function sanitizeErrorText(raw: string): string {
  const cleaned = raw
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/\b(x-api-key|api[_-]?key|authorization)\s*[:=]\s*[^\s,;'"`]+/gi, "$1: [redacted]")
    .replace(/\bsk-(?:proj-|ant-|or-v1-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[redacted-key]");
  if (cleaned.length <= MAX_DETAIL_CHARS) return cleaned;
  return `${cleaned.slice(0, MAX_DETAIL_CHARS)}\n…`;
}

export function normalizeUiError(
  error: unknown,
  componentStack?: string | null,
  now: () => Date = () => new Date(),
): UiErrorReport {
  const timestamp = now().toISOString();
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: sanitizeErrorText(error.message || "Unexpected application error."),
      stack: error.stack ? sanitizeErrorText(error.stack) : null,
      componentStack: componentStack?.trim() ? sanitizeErrorText(componentStack.trim()) : null,
      timestamp,
    };
  }
  const fallbackMessage =
    typeof error === "string" && error.trim()
      ? sanitizeErrorText(error.trim())
      : "Unexpected application error.";
  return {
    name: "Error",
    message: fallbackMessage,
    stack: null,
    componentStack: componentStack?.trim() ? sanitizeErrorText(componentStack.trim()) : null,
    timestamp,
  };
}

export function formatErrorCopyText(report: UiErrorReport, scopeLabel: string): string {
  const lines = [
    `Scope: ${scopeLabel}`,
    `Time: ${report.timestamp}`,
    `${report.name}: ${report.message}`,
  ];
  if (report.componentStack) {
    lines.push("", "Component stack:", report.componentStack);
  }
  if (report.stack) {
    lines.push("", "Stack trace:", report.stack);
  }
  return lines.join("\n");
}

export function haveResetKeysChanged(
  prev: readonly unknown[] | undefined,
  next: readonly unknown[] | undefined,
): boolean {
  if (prev === next) return false;
  if (!prev || !next || prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) {
    if (!Object.is(prev[i], next[i])) return true;
  }
  return false;
}
