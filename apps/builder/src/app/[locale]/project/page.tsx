import { notFound } from "next/navigation";
import { Suspense } from "react";
import { defaultLocale, isLocale } from "@ladestack/i18n";
import { ErrorBoundary } from "../../../components/ErrorBoundary";
import { Workspace } from "../../../components/Workspace";

export default async function LocalizedProjectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale) || locale === defaultLocale) notFound();
  return (
    <ErrorBoundary locale={locale} scope="workspace" variant="workspace">
      <Suspense>
        <Workspace locale={locale} />
      </Suspense>
    </ErrorBoundary>
  );
}
