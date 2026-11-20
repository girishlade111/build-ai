"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { defaultLocale, isLocale } from "@ladestack/i18n";
import { ErrorFallback } from "../../components/ErrorBoundary";
import { normalizeUiError } from "../../errors/formatError";

export default function LocalizedRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams<{ locale?: string }>();
  const locale = params?.locale && isLocale(params.locale) ? params.locale : defaultLocale;

  useEffect(() => {
    console.error("[LocalizedRouteError]", error);
  }, [error]);

  const report = useMemo(() => normalizeUiError(error), [error]);

  return (
    <ErrorFallback
      report={report}
      locale={locale}
      scope="app"
      variant="global"
      onRetry={reset}
    />
  );
}
