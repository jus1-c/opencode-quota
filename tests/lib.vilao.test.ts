import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatVilaoVnd, queryVilaoQuota, VILAO_PAT_METADATA_KEY } from "../src/lib/vilao.js";

const mocks = vi.hoisted(() => ({
  readCredentialRows: vi.fn(),
}));

vi.mock("../src/lib/opencode-auth.js", () => ({
  readCredentialRows: mocks.readCredentialRows,
  getCredentialDatabasePaths: vi.fn(() => ["/tmp/opencode.db"]),
}));

function credentialRow(overrides: { active?: boolean; metadata?: Record<string, unknown> } = {}) {
  const active = overrides.active ?? true;
  return {
    id: `vilao-${active ? "active" : "older"}`,
    integrationId: "vilao",
    label: "Vilao",
    active,
    value: {
      type: "api",
      key: "inference-key-must-not-be-used",
      metadata: overrides.metadata ?? { [VILAO_PAT_METADATA_KEY]: "pat-secret" },
    },
  };
}

function onlyResult(read: Awaited<ReturnType<typeof queryVilaoQuota>>) {
  expect(read).toHaveLength(1);
  return read[0]!.result;
}

describe("vilao quota", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mocks.readCredentialRows.mockResolvedValue([credentialRow()]);
  });

  it("ignores a login without PAT metadata", async () => {
    mocks.readCredentialRows.mockResolvedValue([credentialRow({ metadata: {} })]);
    await expect(queryVilaoQuota()).resolves.toEqual([]);
  });

  it("resets the baseline whenever the balance rises", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { balance: 100000 } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { balance: 40000 } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { balance: 80000 } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { balance: 60000 } }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    let saved = "";
    const dependencies = {
      runtimeDirs: { dataDir: "/d", configDir: "/c", cacheDir: "/x", stateDir: "/state" },
      readText: async () => {
        if (!saved) throw Object.assign(new Error("missing"), { code: "ENOENT" });
        return saved;
      },
      writeState: async (_path: string, state: unknown) => {
        saved = JSON.stringify(state);
      },
      nowMs: 123,
    };

    expect(onlyResult(await queryVilaoQuota({}, dependencies))).toMatchObject({
      success: true,
      balanceCents: 10_000_000,
      baselineCents: 10_000_000,
      percentRemaining: 100,
    });
    expect(onlyResult(await queryVilaoQuota({}, dependencies))).toMatchObject({
      success: true,
      balanceCents: 4_000_000,
      baselineCents: 10_000_000,
      percentRemaining: 40,
    });
    expect(onlyResult(await queryVilaoQuota({}, dependencies))).toMatchObject({
      success: true,
      balanceCents: 8_000_000,
      baselineCents: 8_000_000,
      percentRemaining: 100,
    });
    expect(onlyResult(await queryVilaoQuota({}, dependencies))).toMatchObject({
      success: true,
      balanceCents: 6_000_000,
      baselineCents: 8_000_000,
      percentRemaining: 75,
    });
    expect(saved).not.toContain("pat-secret");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://vilao.ai/api/v2/account/balance",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer pat-secret" }),
      }),
    );
  });

  it("keeps a saved baseline from state written before lastBalanceCents existed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ data: { balance: 50000 } }), { status: 200 }),
      ),
    );
    const legacyState = JSON.stringify({
      version: 1,
      accountFingerprint: createHash("sha256").update("pat-secret").digest("hex"),
      baselineCents: 10_000_000,
      updatedAt: 1,
    });
    let saved = legacyState;
    const dependencies = {
      readText: async () => saved,
      writeState: async (_path: string, state: unknown) => {
        saved = JSON.stringify(state);
      },
    };

    // No lastBalanceCents means the previous balance is unknown, so the read
    // cannot prove a rise and must keep the stored baseline.
    expect(onlyResult(await queryVilaoQuota({}, dependencies))).toMatchObject({
      success: true,
      balanceCents: 5_000_000,
      baselineCents: 10_000_000,
      percentRemaining: 50,
    });
    expect(JSON.parse(saved)).toMatchObject({
      baselineCents: 10_000_000,
      lastBalanceCents: 5_000_000,
    });
  });

  it("rounds API float noise to currency cents", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: { balance: 39742.238790000054 } }), { status: 200 }),
      ),
    );
    const result = onlyResult(
      await queryVilaoQuota(
        {},
        {
          readText: async () => {
            throw Object.assign(new Error("missing"), { code: "ENOENT" });
          },
          writeState: async () => {},
        },
      ),
    );
    expect(result).toMatchObject({
      success: true,
      balanceCents: 3_974_224,
      baselineCents: 3_974_224,
    });
  });

  it("returns a reconnect error when the PAT is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unauthorized", { status: 401 })),
    );
    const result = onlyResult(await queryVilaoQuota());
    expect(result.success ? "" : result.error).toContain("401");
  });

  it("redacts a PAT echoed by an API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad pat-secret", { status: 500 })),
    );
    const result = onlyResult(await queryVilaoQuota());
    const error = result.success ? "" : result.error;
    expect(error).toContain("[redacted]");
    expect(error).not.toContain("pat-secret");
  });

  it("does not overwrite malformed baseline state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: { balance: 100 } }), { status: 200 })),
    );
    const writeState = vi.fn();
    const result = onlyResult(
      await queryVilaoQuota(
        {},
        {
          readText: async () => "not json",
          writeState,
        },
      ),
    );
    expect(result.success ? "" : result.error).toBeTruthy();
    expect(writeState).not.toHaveBeenCalled();
  });

  it("formats đồng without decimals", () => {
    expect(formatVilaoVnd(4_000_000)).toBe("40.000 ₫");
  });
});
