import { describe, expect, it, vi } from "vitest";

import { vilaoProvider } from "../src/providers/vilao.js";
import { expectAttemptedWithNoErrors, visibleEntries } from "./helpers/provider-assertions.js";

vi.mock("../src/lib/vilao.js", () => ({
  queryVilaoQuota: vi.fn(),
  hasVilaoPat: vi.fn(),
  getVilaoAuthDiagnostics: vi.fn(async () => ({
    configured: true,
    authPaths: ["/tmp/auth.json"],
    statePath: "/tmp/state.json",
  })),
  getVilaoCacheIdentity: vi.fn(async () => "account-fingerprint"),
  formatVilaoVnd: vi.fn((value: number) => `${Math.round(value)} VND`),
}));

describe("vilao provider", () => {
  it("keeps remaining and max amounts in the expanded percent label", async () => {
    const { queryVilaoQuota } = await import("../src/lib/vilao.js");
    (queryVilaoQuota as any).mockResolvedValueOnce({
      success: true,
      balance: 40000,
      baseline: 100000,
      percentRemaining: 40,
      statePath: "/tmp/state.json",
    });

    const out = await vilaoProvider.fetch({ config: { requestTimeoutMs: 9000 } } as any);
    expectAttemptedWithNoErrors(out);
    expect(visibleEntries(out.entries, "vilao")).toEqual([
      {
        name: "Vilao Balance",
        group: "Vilao",
        label: ":: 40000 / 100000 ₫",
        percentRemaining: 40,
      },
    ]);
    expect(out.rawDetails).toEqual([
      { key: "balance", value: "40000 VND" },
      { key: "observed_baseline", value: "100000 VND" },
    ]);
    expect(out.presentation).toBeUndefined();
  });

  it("matches Vilao model ids and uses PAT presence for availability", async () => {
    const { hasVilaoPat } = await import("../src/lib/vilao.js");
    (hasVilaoPat as any).mockResolvedValueOnce(true);
    await expect(vilaoProvider.isAvailable({} as any)).resolves.toBe(true);
    expect(vilaoProvider.matchesCurrentModel?.("vilao/opt/gpt-5.6-sol")).toBe(true);
    expect(vilaoProvider.matchesCurrentModel?.("openai/gpt-5.6-sol")).toBe(false);
  });
});
