// Fast, direct Next.js dev launcher for @ladestack/builder.
// Avoids nested npm workspace shells and starts Monaco asset syncing in parallel
// so port 3000 binds immediately on cold container boots.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const builderDir = join(scriptsDir, "..");
const requireFromBuilder = createRequire(join(builderDir, "package.json"));
const nextBin = requireFromBuilder.resolve("next/dist/bin/next");

const port = process.env.PORT || "3000";
const host = process.env.HOST || "0.0.0.0";

// Sync self-hosted Monaco assets in the background without blocking port 3000 readiness.
const monacoSync = spawn(process.execPath, [join(scriptsDir, "copy-monaco.mjs")], {
  cwd: builderDir,
  stdio: "inherit",
  env: process.env,
});
monacoSync.on("error", (err) => {
  console.error("Failed to sync Monaco assets:", err);
});

const nextArgs = [nextBin, "dev", "--turbopack", "-p", port, "-H", host, ...process.argv.slice(2)];
const server = spawn(process.execPath, nextArgs, {
  cwd: builderDir,
  stdio: "inherit",
  env: process.env,
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (monacoSync.exitCode === null) {
    monacoSync.kill(signal);
  }
  if (server.exitCode === null) {
    server.kill(signal);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.on("error", (err) => {
  console.error("Failed to start Next.js dev server:", err);
  process.exit(1);
});

server.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
