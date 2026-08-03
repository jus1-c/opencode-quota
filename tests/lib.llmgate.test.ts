import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getLlmGateAuthDiagnostics,
  hasLlmGateAuthTokens,
  LLMGATE_ACCESS_TOKEN_METADATA_KEY,
  LLMGATE_REFRESH_TOKEN_METADATA_KEY,
  queryLlmGateQuota,
} from "../src/lib/llmgate.js";

vi.mock("../src/lib/opencode-auth.js", () => ({
  readAuthFile: vi.fn(),
  getAuthPaths: vi.fn(() => ["/tmp/auth.json"]),
}));

function connectedAuth() {
  return {
    llmgate: {
      type: "api",
      key: "keychain-managed",
      metadata: {
        [LLMGATE_ACCESS_TOKEN_METADATA_KEY]: "access-token",
        [LLMGATE_REFRESH_TOKEN_METADATA_KEY]: "refresh-token",
      },
    },
  };
}

describe("llmgate quota", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns null without a complete access and refresh token pair", async () => {
    const { readAuthFile } = await import("../src/lib/opencode-auth.js");
    (readAuthFile as any).mockResolvedValueOnce({
      llmgate: {
        type: "api",
        metadata: { [LLMGATE_ACCESS_TOKEN_METADATA_KEY]: "access-token" },
      },
    });

    await expect(queryLlmGateQuota()).resolves.toBeNull();
  });

  it("returns billing quota windows using the login access token", async () => {
    const { readAuthFile } = await import("../src/lib/opencode-auth.js");
    (readAuthFile as any).mockResolvedValue(connectedAuth());
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: 200,
      message: "success",
      data: {
        plan_code: "pro5x",
        plan_name: "Pro 5x",
        status: "active",
        credit_balance: 12.5,
        usage_quota: {
          five_hour: { limit: 50, used: 36.5, remaining: 13.5, reset_at_unix: 1784610984 },
          weekly: { limit: 275, used: 40, remaining: 235, reset_at_unix: 1784956584 },
        },
      },
    }), { status: 200 })) as any;
    vi.stubGlobal("fetch", fetchMock);

    const out = await queryLlmGateQuota({ requestTimeoutMs: 9876 });
    expect(out).toEqual({
      success: true,
      planCode: "pro5x",
      planName: "Pro 5x",
      planStatus: "active",
      creditBalance: 12.5,
      windows: {
        fiveHour: {
          limit: 50,
          used: 36.5,
          remaining: 13.5,
          percentRemaining: 27,
          resetTimeIso: "2026-07-21T05:16:24.000Z",
        },
        weekly: {
          limit: 275,
          used: 40,
          remaining: 235,
          percentRemaining: 85,
          resetTimeIso: "2026-07-25T05:16:24.000Z",
        },
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://llmgate.app/api/v1/billing/overview",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer access-token",
          "User-Agent": "OpenCode-Quota-Toast/1.0",
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("reports a rejected access token as a reconnect error", async () => {
    const { readAuthFile } = await import("../src/lib/opencode-auth.js");
    (readAuthFile as any).mockResolvedValue(connectedAuth());
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Unauthorized", { status: 401 })) as any);

    const out = await queryLlmGateQuota();
    expect(out && !out.success ? out.error : "").toContain("Run /connect");
  });

  it("reports malformed billing payloads", async () => {
    const { readAuthFile } = await import("../src/lib/opencode-auth.js");
    (readAuthFile as any).mockResolvedValue(connectedAuth());
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { usage_quota: {} } }), { status: 200 })) as any);

    const out = await queryLlmGateQuota();
    expect(out && !out.success ? out.error : "").toBe(
      "LLMGate billing response has no reportable usage quota windows",
    );
  });

  it("detects a complete token pair from auth metadata", async () => {
    const { readAuthFile } = await import("../src/lib/opencode-auth.js");
    (readAuthFile as any).mockResolvedValue(connectedAuth());

    await expect(hasLlmGateAuthTokens()).resolves.toBe(true);
    await expect(getLlmGateAuthDiagnostics()).resolves.toEqual({
      configured: true,
      accessTokenConfigured: true,
      refreshTokenConfigured: true,
      authPaths: ["/tmp/auth.json"],
    });
  });
});
