import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { packageUrlFromCommandLine, packageUrlFromDeepLink } from "./package-link.mjs";

describe("BotMRR package deep links", () => {
  it("accepts a public GitHub package URL", () => {
    const target = "https://raw.githubusercontent.com/acme/bots/main/reddit-lead-miner.md";
    assert.equal(packageUrlFromDeepLink(`openorgobot://install?url=${encodeURIComponent(target)}`), target);
    assert.equal(packageUrlFromCommandLine(["Open Orgo Bot", "--flag", `openorgobot://install?url=${encodeURIComponent(target)}`]), target);
  });

  it("rejects other commands, hosts, protocols, credentials, and unsupported file types", () => {
    assert.equal(packageUrlFromDeepLink("openorgobot://settings"), null);
    assert.equal(packageUrlFromDeepLink("openorgobot://install?url=https://evil.example/bot.json"), null);
    assert.equal(packageUrlFromDeepLink("openorgobot://install?url=http://raw.githubusercontent.com/a/b/main/bot.json"), null);
    assert.equal(packageUrlFromDeepLink("openorgobot://install?url=https://user@example.com/bot.json"), null);
    assert.equal(packageUrlFromDeepLink("openorgobot://install?url=https://github.com/acme/bot/run.sh"), null);
  });
});
