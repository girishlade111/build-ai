import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@ladestack/design-tokens/tokens.css";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/jetbrains-mono";
import "../globals.css";
import { ErrorBoundary } from "../../components/ErrorBoundary";

// Every response carries a fresh CSP nonce (src/middleware.ts), so pages render per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "LadeStack Build",
  description: "Local-first, bring-your-own-key AI builder workspace.",
  // The builder is an app surface, not a marketing page.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>
        <ErrorBoundary locale="en" scope="app" variant="global">
          {children}
        </ErrorBoundary>
      </body>
    </html>
  );
}
