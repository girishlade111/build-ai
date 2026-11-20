import { Suspense } from "react";
import { ErrorBoundary } from "../../../components/ErrorBoundary";
import { Workspace } from "../../../components/Workspace";

export default function ProjectPage() {
  return (
    <ErrorBoundary locale="en" scope="workspace" variant="workspace">
      <Suspense>
        <Workspace locale="en" />
      </Suspense>
    </ErrorBoundary>
  );
}
