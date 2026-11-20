"use client";

import { useEffect, useMemo } from "react";
import { ErrorFallback } from "../../components/ErrorBoundary";
import { normalizeUiError } from "../../errors/formatError";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[RouteError]", error);
  }, [error]);

  const report = useMemo(() => normalizeUiError(error), [error]);

  return (
    <ErrorFallback
      report={report}
      locale="en"
      scope="app"
      variant="global"
      onRetry={reset}
    />
  );
}
