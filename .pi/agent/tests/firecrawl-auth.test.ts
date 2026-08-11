import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applyFirecrawlAuth,
  readFirecrawlApiKeys,
  selectFirecrawlApiKey,
} from "../extensions/firecrawl-auth.ts";

const API_KEY_ENV = "FIRECRAWL_API_KEY";

test("Firecrawl auth selects a different valid key on each reload", () => {
  const directory = mkdtempSync(join(tmpdir(), "firecrawl-auth-test-"));
  const authPath = join(directory, "auth.json");
  const missingAuthPath = join(directory, "missing.json");
  const originalApiKey = process.env[API_KEY_ENV];

  try {
    writeFileSync(
      authPath,
      JSON.stringify({
        firecrawl: {
          type: "api_key",
          key: [" fc-one ", "fc-two", "", "fc-one", 42],
        },
      }),
    );

    assert.deepEqual(readFirecrawlApiKeys(authPath), ["fc-one", "fc-two"]);
    assert.equal(selectFirecrawlApiKey(["one", "two"], undefined, () => 0), "one");
    assert.equal(selectFirecrawlApiKey(["one", "two"], "one", () => 0), "two");

    delete process.env[API_KEY_ENV];
    applyFirecrawlAuth(authPath, () => 0);
    assert.equal(process.env[API_KEY_ENV], "fc-one");

    applyFirecrawlAuth(authPath, () => 0);
    assert.equal(process.env[API_KEY_ENV], "fc-two");

    process.env[API_KEY_ENV] = "fc-foreign";
    applyFirecrawlAuth(missingAuthPath, () => 0);
    assert.equal(process.env[API_KEY_ENV], "fc-foreign");

    delete process.env[API_KEY_ENV];
    applyFirecrawlAuth(authPath, () => 0);
    applyFirecrawlAuth(missingAuthPath, () => 0);
    assert.equal(process.env[API_KEY_ENV], undefined);

    process.env[API_KEY_ENV] = "fc-shell";
    applyFirecrawlAuth(authPath, () => 0);
    assert.equal(process.env[API_KEY_ENV], "fc-shell");
  } finally {
    if (originalApiKey === undefined) delete process.env[API_KEY_ENV];
    else process.env[API_KEY_ENV] = originalApiKey;
    rmSync(directory, { recursive: true, force: true });
  }
});
