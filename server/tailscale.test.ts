import { describe, expect, it } from "vitest";

import { classifyTailscaleStderr, explainTailscaleFailure, parseTailscaleStatus, probeTailscaleStatus } from "./tailscale.ts";

describe("tailscale helpers", () => {
  it("reads the MagicDNS name, addresses and state from status --json", () => {
    const status = parseTailscaleStatus("/usr/bin/tailscale", JSON.stringify({
      BackendState: "Running",
      Self: { DNSName: "mini.tail1234.ts.net.", TailscaleIPs: ["100.64.0.7", "fd7a:115c:a1e0::7"] },
    }));
    expect(status).toEqual({ cli: "/usr/bin/tailscale", dnsName: "mini.tail1234.ts.net", addresses: ["100.64.0.7", "fd7a:115c:a1e0::7"], backendState: "Running" });
    expect(parseTailscaleStatus("t", "{}")?.dnsName).toBeNull();
    expect(parseTailscaleStatus("t", "not json")).toBeNull();
  });

  it("classifies stderr into a closed set and never needs the raw text again", () => {
    expect(classifyTailscaleStderr("Logged out.\nLog in at: https://login.tailscale.com/a/tskey-auth-secret")).toBe("not-logged-in");
    expect(classifyTailscaleStderr("failed to connect to local tailscaled; is Tailscale running?")).toBe("not-running");
    expect(classifyTailscaleStderr("Access denied: serve config denied; use 'sudo tailscale set --operator=USER'")).toBe("needs-operator");
    expect(classifyTailscaleStderr("error: HTTPS is not enabled for this tailnet")).toBe("https-not-enabled");
    expect(classifyTailscaleStderr("something else entirely")).toBe("unknown");
    for (const reason of ["not-installed", "not-logged-in", "not-running", "no-magicdns", "needs-operator", "https-not-enabled", "unknown"] as const) {
      expect(explainTailscaleFailure(reason).length).toBeGreaterThan(20);
      expect(explainTailscaleFailure(reason)).not.toContain("tskey");
    }
  });

  it("keeps probing when an earlier installed CLI cannot reach its daemon", async () => {
    const calls: string[] = [];
    const result = await probeTailscaleStatus(["/Applications/Tailscale.app/cli", "/opt/homebrew/bin/tailscale"], async (cli) => {
      calls.push(cli);
      if (cli.startsWith("/Applications")) {
        return { ok: false, stdout: "", stderr: "Failed to load preferences.", code: 1 };
      }
      return {
        ok: true,
        stdout: JSON.stringify({
          BackendState: "Running",
          Self: { DNSName: "mini.tail1234.ts.net.", TailscaleIPs: ["100.64.0.7"] },
        }),
        stderr: "",
        code: 0,
      };
    });

    expect(calls).toEqual(["/Applications/Tailscale.app/cli", "/opt/homebrew/bin/tailscale"]);
    expect(result).toEqual({
      status: {
        cli: "/opt/homebrew/bin/tailscale",
        dnsName: "mini.tail1234.ts.net",
        addresses: ["100.64.0.7"],
        backendState: "Running",
      },
    });
  });
});
