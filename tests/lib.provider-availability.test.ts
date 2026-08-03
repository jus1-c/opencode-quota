import { describe, expect, it, vi } from "vitest";

import {
  isAnyProviderIdAvailable,
  isCanonicalProviderAvailable,
  isCanonicalProviderWithModelsAvailable,
} from "../src/lib/provider-availability.js";

function makeCtx(params: {
  ids?: string[];
  providers?: Array<{ id: string; models?: Record<string, unknown> }>;
  error?: Error;
}) {
  const providers = params.error
    ? vi.fn().mockRejectedValue(params.error)
    : vi.fn().mockResolvedValue({
        data: { providers: params.providers ?? (params.ids ?? []).map((id) => ({ id })) },
      });

  return {
    client: {
      config: {
        providers,
      },
    },
  } as any;
}

describe("provider availability", () => {
  it("matches any configured provider id from a candidate list", async () => {
    await expect(
      isAnyProviderIdAvailable({
        ctx: makeCtx({ ids: ["openai", "github-copilot-chat"] }),
        candidateIds: ["copilot", "github-copilot-chat"],
        fallbackOnError: false,
      }),
    ).resolves.toBe(true);
  });

  it("expands canonical provider ids to metadata-backed runtime ids", async () => {
    await expect(
      isCanonicalProviderAvailable({
        ctx: makeCtx({ ids: ["github-copilot-chat"] }),
        providerId: "copilot",
        fallbackOnError: false,
      }),
    ).resolves.toBe(true);
  });

  it("matches expanded runtime aliases for non-special providers through metadata", async () => {
    await expect(
      isCanonicalProviderAvailable({
        ctx: makeCtx({ ids: ["chatgpt"] }),
        providerId: "openai",
        fallbackOnError: false,
      }),
    ).resolves.toBe(true);
    await expect(
      isCanonicalProviderAvailable({
        ctx: makeCtx({ ids: ["opencode"] }),
        providerId: "openai",
        fallbackOnError: false,
      }),
    ).resolves.toBe(false);
    await expect(
      isCanonicalProviderAvailable({
        ctx: makeCtx({ ids: ["glm"] }),
        providerId: "zai",
        fallbackOnError: false,
      }),
    ).resolves.toBe(true);
    await expect(
      isCanonicalProviderAvailable({
        ctx: makeCtx({ ids: ["synthetic"] }),
        providerId: "synthetic",
        fallbackOnError: false,
      }),
    ).resolves.toBe(true);
    await expect(
      isCanonicalProviderAvailable({
        ctx: makeCtx({ ids: ["llmgate"] }),
        providerId: "llmgate",
        fallbackOnError: false,
      }),
    ).resolves.toBe(true);
    await expect(
      isCanonicalProviderAvailable({
        ctx: makeCtx({ ids: ["antigravity"] }),
        providerId: "google-antigravity",
        fallbackOnError: false,
      }),
    ).resolves.toBe(true);
    await expect(
      isCanonicalProviderAvailable({
        ctx: makeCtx({ ids: ["minimax"] }),
        providerId: "minimax-coding-plan",
        fallbackOnError: false,
      }),
    ).resolves.toBe(true);
    await expect(
      isCanonicalProviderAvailable({
        ctx: makeCtx({ ids: ["minimax-cn-coding-plan"] }),
        providerId: "minimax-china-coding-plan",
        fallbackOnError: false,
      }),
    ).resolves.toBe(true);
    await expect(
      isCanonicalProviderAvailable({
        ctx: makeCtx({ ids: ["minimax"] }),
        providerId: "minimax-china-coding-plan",
        fallbackOnError: false,
      }),
    ).resolves.toBe(false);
  });

  it("does not treat broad normalization aliases as runtime provider ids", async () => {
    await expect(
      isCanonicalProviderAvailable({
        ctx: makeCtx({ ids: ["claude"] }),
        providerId: "anthropic",
        fallbackOnError: false,
      }),
    ).resolves.toBe(false);
  });

  it("returns false when no candidate provider ids are configured", async () => {
    await expect(
      isCanonicalProviderAvailable({
        ctx: makeCtx({ ids: [] }),
        providerId: "cursor",
        fallbackOnError: false,
      }),
    ).resolves.toBe(false);
  });

  it("requires a configured model when the runtime exposes a model map", async () => {
    await expect(
      isCanonicalProviderWithModelsAvailable({
        ctx: makeCtx({ providers: [{ id: "llmgate", models: {} }] }),
        providerId: "llmgate",
        fallbackOnError: false,
      }),
    ).resolves.toBe(false);
    await expect(
      isCanonicalProviderWithModelsAvailable({
        ctx: makeCtx({ providers: [{ id: "llmgate", models: { "gpt-5.6": {} } }] }),
        providerId: "llmgate",
        fallbackOnError: false,
      }),
    ).resolves.toBe(true);
  });

  it.each([
    [false, false],
    [true, true],
  ])(
    "returns fallbackOnError=%s when provider lookup throws",
    async (fallbackOnError, expected) => {
      await expect(
        isCanonicalProviderAvailable({
          ctx: makeCtx({ error: new Error("boom") }),
          providerId: "copilot",
          fallbackOnError,
        }),
      ).resolves.toBe(expected);
    },
  );
});
