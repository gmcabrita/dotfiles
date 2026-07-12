#!/usr/bin/env node
// Thin launcher for the pi-chatgpt-web-adapter CLI.
// Prefers the compiled dist build; falls back to tsx-on-source for dev checkouts.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const distEntry = join(here, "..", "dist", "cli", "index.js");

async function main() {
  if (existsSync(distEntry)) {
    await import(distEntry);
    return;
  }
  // Dev fallback: run TypeScript source directly via tsx if available.
  const srcEntry = join(here, "..", "src", "cli", "index.ts");
  try {
    await import("tsx/esm");
    await import(srcEntry);
  } catch (err) {
    process.stderr.write(
      "pi-chatgpt-web: no build found at dist/ and tsx is unavailable.\n" +
        "Run `npm run build` in the package directory first.\n",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`pi-chatgpt-web: fatal: ${err?.stack || err}\n`);
  process.exit(1);
});
