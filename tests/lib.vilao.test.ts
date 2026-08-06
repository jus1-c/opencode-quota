import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryVilaoQuota, VILAO_PAT_METADATA_KEY } from "../src/lib/vilao.js";

const mocks = vi.hoisted(() => ({
  readAuthFile: vi.fn(),
}));

vi.mock("../src/lib/opencode-auth.js", () => ({
  readAuthFile: mocks.readAuthFile,
  getAuthPaths: vi.fn(() => ["/tmp/auth.json"]),
}));

function auth() {
  return {
    vilao: {
      type: "api",
      key: "inference-key-must-not-be-used",
      metadata: { [VILAO_PAT_METADATA_KEY]: "pat-secret" },
    },
  };
}

describe("vilao quota", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("ignores the inference key when PAT metadata is missing", async () => {
    mocks.readAuthFile.mockResolvedValue({ vilao: { type: "api", key: "inference-key" } });
    await expect(queryVilaoQuota()).resolves.toBeNull();
  });

  it("starts at 100 percent and keeps the observed high-water baseline", async () => {
    mocks.readAuthFile.mockResolvedValue(auth());
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { balance: 100000 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { balance: 40000 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { balance: 120000 } }), { status: 200 }));
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

    await expect(queryVilaoQuota({}, dependencies)).resolves.toMatchObject({
      success: true,
      balance: 100000,
      baseline: 100000,
      percentRemaining: 100,
    });
    await expect(queryVilaoQuota({}, dependencies)).resolves.toMatchObject({
      success: true,
      balance: 40000,
      baseline: 100000,
      percentRemaining: 40,
    });
    await expect(queryVilaoQuota({}, dependencies)).resolves.toMatchObject({
      success: true,
      balance: 120000,
      baseline: 120000,
      percentRemaining: 100,
    });
    expect(saved).not.toContain("pat-secret");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://vilao.ai/api/v2/account/balance",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer pat-secret" }),
      }),
    );
  });

  it("rounds API float noise to currency cents", async () => {
    mocks.readAuthFile.mockResolvedValue(auth());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: { balance: 39742.238790000054 } }), { status: 200 })),
    );
    const result = await queryVilaoQuota({}, {
      readText: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
      writeState: async () => {},
    });
    expect(result).toMatchObject({ success: true, balance: 39742.24, baseline: 39742.24 });
  });

  it("returns a reconnect error when the PAT is rejected", async () => {
    mocks.readAuthFile.mockResolvedValue(auth());
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Unauthorized", { status: 401 })));
    const result = await queryVilaoQuota();
    expect(result && !result.success ? result.error : "").toContain("Run /connect");
  });

  it("redacts a PAT echoed by an API error", async () => {
    mocks.readAuthFile.mockResolvedValue(auth());
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad pat-secret", { status: 500 })));
    const result = await queryVilaoQuota();
    expect(result && !result.success ? result.error : "").toContain("[redacted]");
    expect(result && !result.success ? result.error : "").not.toContain("pat-secret");
  });

  it("does not overwrite malformed baseline state", async () => {
    mocks.readAuthFile.mockResolvedValue(auth());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: { balance: 100 } }), { status: 200 })),
    );
    const writeState = vi.fn();
    const result = await queryVilaoQuota({}, {
      readText: async () => "not json",
      writeState,
    });
    expect(result && !result.success ? result.error : "").toBeTruthy();
    expect(writeState).not.toHaveBeenCalled();
  });
});
