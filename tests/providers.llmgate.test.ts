import { describe, expect, it, vi } from "vitest";

import {
  expectAttemptedWithErrorLabel,
  expectAttemptedWithNoErrors,
  expectNotAttempted,
} from "./helpers/provider-assertions.js";
import { llmGateProvider } from "../src/providers/llmgate.js";

vi.mock("../src/lib/llmgate.js", () => ({
  queryLlmGateQuota: vi.fn(),
  hasLlmGateAuthTokens: vi.fn(),
}));

vi.mock("../src/lib/provider-availability.js", () => ({
  isCanonicalProviderWithModelsAvailable: vi.fn(),
}));

describe("llmgate provider", () => {
  it("returns attempted:false when dashboard quota is not configured", async () => {
    const { queryLlmGateQuota } = await import("../src/lib/llmgate.js");
    (queryLlmGateQuota as any).mockResolvedValueOnce(null);

    const out = await llmGateProvider.fetch({} as any);
    expectNotAttempted(out);
  });

  it("maps billing windows into grouped rows", async () => {
    const { queryLlmGateQuota } = await import("../src/lib/llmgate.js");
    (queryLlmGateQuota as any).mockResolvedValueOnce({
      success: true,
      planName: "Pro 5x",
      creditBalance: 12.5,
      windows: {
        fiveHour: {
          limit: 50,
          used: 36.5,
          remaining: 13.5,
          percentRemaining: 27,
          resetTimeIso: "2026-07-21T00:49:44.000Z",
        },
        weekly: {
          limit: 275,
          used: 40,
          remaining: 235,
          percentRemaining: 85,
          resetTimeIso: "2026-07-25T00:49:44.000Z",
        },
      },
    });

    const out = await llmGateProvider.fetch({ config: { requestTimeoutMs: 1234 } } as any);
    expectAttemptedWithNoErrors(out);
    expect(queryLlmGateQuota).toHaveBeenCalledWith({ requestTimeoutMs: 1234 });
    expect(out.entries).toEqual([
      {
        name: "LLMGate Pro 5x 5h",
        group: "LLMGate Pro 5x",
        label: "5h:",
        right: "36.5/50",
        percentRemaining: 27,
        resetTimeIso: "2026-07-21T00:49:44.000Z",
      },
      {
        name: "LLMGate Pro 5x Weekly",
        group: "LLMGate Pro 5x",
        label: "Weekly:",
        right: "40/275",
        percentRemaining: 85,
        resetTimeIso: "2026-07-25T00:49:44.000Z",
      },
    ]);
  });

  it("maps errors into toast errors", async () => {
    const { queryLlmGateQuota } = await import("../src/lib/llmgate.js");
    (queryLlmGateQuota as any).mockResolvedValueOnce({ success: false, error: "Unauthorized" });

    const out = await llmGateProvider.fetch({} as any);
    expectAttemptedWithErrorLabel(out, "LLMGate");
  });

  it("matches LLMGate model ids", () => {
    expect(llmGateProvider.matchesCurrentModel?.("llmgate/gpt-5")).toBe(true);
    expect(llmGateProvider.matchesCurrentModel?.("openai/gpt-5")).toBe(false);
  });

  it("is available only when both LLMGate provider and login tokens are available", async () => {
    const { hasLlmGateAuthTokens } = await import("../src/lib/llmgate.js");
    const { isCanonicalProviderWithModelsAvailable } = await import("../src/lib/provider-availability.js");
    (isCanonicalProviderWithModelsAvailable as any).mockResolvedValueOnce(true);
    (hasLlmGateAuthTokens as any).mockResolvedValueOnce(true);

    const ctx = {} as any;
    await expect(llmGateProvider.isAvailable(ctx)).resolves.toBe(true);
    expect(isCanonicalProviderWithModelsAvailable).toHaveBeenCalledWith({
      ctx,
      providerId: "llmgate",
      fallbackOnError: false,
    });
  });

  it("is unavailable when the LLMGate provider is absent even with login tokens", async () => {
    const { hasLlmGateAuthTokens } = await import("../src/lib/llmgate.js");
    const { isCanonicalProviderWithModelsAvailable } = await import("../src/lib/provider-availability.js");
    (isCanonicalProviderWithModelsAvailable as any).mockResolvedValueOnce(false);
    (hasLlmGateAuthTokens as any).mockResolvedValueOnce(true);

    await expect(llmGateProvider.isAvailable({} as any)).resolves.toBe(false);
    expect(hasLlmGateAuthTokens).not.toHaveBeenCalled();
  });
});
