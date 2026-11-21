// Self-hosts Monaco: copies its prebuilt AMD bundle into public/ so the editor never loads from a CDN.
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// The package's "exports" map hides package.json, so walk up from its entry point instead.
function packageDir(entry) {
  let dir = dirname(entry);
  while (dir !== dirname(dir)) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name === "monaco-editor")
      return dir;
    dir = dirname(dir);
  }
  throw new Error("monaco-editor is not installed");
}
const pkgDir = packageDir(require.resolve("monaco-editor"));
const { version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const target = join(publicDir, "monaco");
const stamp = join(target, "VERSION");

if (existsSync(stamp) && readFileSync(stamp, "utf8") === version) process.exit(0);

mkdirSync(publicDir, { recursive: true });
const staging = join(publicDir, `.monaco-tmp-${process.pid}`);
try {
  rmSync(staging, { recursive: true, force: true });
  cpSync(join(pkgDir, "min", "vs"), join(staging, "vs"), { recursive: true });
  cpSync(join(pkgDir, "LICENSE"), join(staging, "LICENSE"));
  cpSync(join(pkgDir, "ThirdPartyNotices.txt"), join(staging, "ThirdPartyNotices.txt"));
  writeFileSync(join(staging, "VERSION"), version);
  rmSync(target, { recursive: true, force: true });
  renameSync(staging, target);
  console.warn(`Copied monaco-editor ${version} to public/monaco`);
} catch (err) {
  rmSync(staging, { recursive: true, force: true });
  throw err;
}
