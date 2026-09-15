import { describe, expect, it } from "vitest";

import {
  ORGO_ACCOUNT_RESOURCES_ERROR,
  CLOUD_BACKEND_CHANGE_ERROR,
  VPS_ALIAS_CHANGE_ERROR,
  VPS_ALIAS_RESOURCES_ERROR,
  orgoAccountResourceChangeError,
  cloudBackendChangeError,
  vpsAliasChangeError,
  vpsAliasResourceChangeError,
} from "./cloud-backend.ts";

describe("cloud backend switching", () => {
  const activeTurnCases: Array<[string, boolean, boolean]> = [
    ["a busy bot", true, false],
    ["an active VPS thread", false, true],
  ];

  it.each(activeTurnCases)("rejects changes during %s", (_reason, busy, activeVpsThread) => {
    expect(cloudBackendChangeError(busy, activeVpsThread)).toBe(CLOUD_BACKEND_CHANGE_ERROR);
  });

  it("allows changes while idle", () => {
    expect(cloudBackendChangeError(false, false)).toBeNull();
  });

  it("keeps an active VPS turn on its original SSH host", () => {
    expect(vpsAliasChangeError("old-vps", "new-vps", true)).toBe(VPS_ALIAS_CHANGE_ERROR);
    expect(vpsAliasChangeError("old-vps", "old-vps", true)).toBeNull();
    expect(vpsAliasChangeError("old-vps", "new-vps", false)).toBeNull();
  });

  it("allows Orgo token rotation only when the replacement sees the same resources", () => {
    const current = [{ computerId: "bx_23456789", name: "ogb-scope-bot-hash" }];
    expect(orgoAccountResourceChangeError(current, [...current])).toBeNull();
    expect(orgoAccountResourceChangeError(current, null)).toBe(ORGO_ACCOUNT_RESOURCES_ERROR);
    expect(orgoAccountResourceChangeError(current, [{ ...current[0]!, computerId: "bx_3456789a" }]))
      .toBe(ORGO_ACCOUNT_RESOURCES_ERROR);
    expect(orgoAccountResourceChangeError([], null)).toBeNull();
  });

  it("keeps an SSH alias attached while its VPS still has local computers", () => {
    expect(vpsAliasResourceChangeError(1)).toBe(VPS_ALIAS_RESOURCES_ERROR);
    expect(vpsAliasResourceChangeError(0)).toBeNull();
  });
});
