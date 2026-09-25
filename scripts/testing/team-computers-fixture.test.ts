import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, type VerificationServer } from "../control-omb.ts";

it.each([
  "https://127.0.0.1:12345", "http://localhost:12345", "http://192.0.2.1:12345",
  "http://127.0.0.1:12345/api", "http://127.0.0.1:12345?token=secret", "http://127.0.0.1:12345#fragment",
  "http://user:password@127.0.0.1:12345", "http://127.0.0.1:0", "http://127.0.0.1:65536",
])("rejects an unsafe Orgo fixture endpoint before launching: %s", async (endpoint) => {
  await expect(launchVerificationServer({}, undefined, undefined, undefined, undefined, undefined, [], endpoint))
    .rejects.toThrow(/Orgo verification requires/);
});

it.for([false, true])("registers a computer engine only for an opted-in Box fixture: %s", async (withBox, { skip }) => {
  // Open Orgo Bot has no Box runtime (deleted in the fork); only the no-Box case applies.
  if (withBox) skip();
  const calls: string[] = [];
  const provider = createServer((request, response) => {
    calls.push(`${request.method} ${request.url}`);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, boxes: [] }));
  });
  let fixture: VerificationServer | undefined;
  try {
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const address = provider.address();
    if (!address || typeof address === "string") throw new Error("Box fixture has no loopback port");
    const endpoint = `http://127.0.0.1:${address.port}`;
    fixture = await launchVerificationServer({}, undefined, undefined, undefined, undefined, undefined, [], withBox ? endpoint : undefined);
    const config = JSON.parse(readFileSync(join(fixture.info.dataDir, "config.json"), "utf8"));
    const response = await fetch(`${fixture.info.url}/api/instances`);
    expect(response.ok).toBe(true);
    const { instances } = await response.json() as { instances: Array<{ instanceId: string; driverKind: string }> };
    expect(instances.filter(instance => instance.driverKind === "boxAgent").map(instance => instance.instanceId)).toEqual(withBox ? ["computer"] : []);
    if (withBox) {
      expect(config.instances.computer).toEqual({ driver: "boxAgent" });
      expect(config.box).toEqual({ token: "box_verification_fixture" });
    } else {
      expect(config.instances).not.toHaveProperty("computer");
      expect(config).not.toHaveProperty("box");
      expect(calls).toEqual([]);
    }
    // Merely advertising the opted-in backend must never provision a box.
    expect(calls.every(call => call.startsWith("GET "))).toBe(true);
  } finally {
    await fixture?.close();
    provider.closeAllConnections();
    if (provider.listening) await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()));
  }
  expect(existsSync(fixture!.info.dataDir)).toBe(false);
}, 30_000);
