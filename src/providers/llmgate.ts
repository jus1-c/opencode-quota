/** LLMGate quota-provider adapter. */

import type {
  QuotaProvider,
  QuotaProviderContext,
  QuotaProviderResult,
  QuotaToastEntry,
} from "../lib/entries.js";
import {
  hasLlmGateAuthTokens,
  queryLlmGateQuota,
} from "../lib/llmgate.js";
import { isCanonicalProviderWithModelsAvailable } from "../lib/provider-availability.js";
import { modelProviderMatchesRuntimeId } from "../lib/provider-model-matching.js";
import { attemptedResult, mapNullableProviderResult } from "./result-helpers.js";

function numberDisplay(value: number): string {
  return Number(value.toFixed(2)).toLocaleString("en-US");
}

function buildEntries(result: Extract<NonNullable<Awaited<ReturnType<typeof queryLlmGateQuota>>>, { success: true }>): QuotaToastEntry[] {
  const label = result.planName ? `LLMGate ${result.planName}` : "LLMGate";
  const entries: QuotaToastEntry[] = [];
  if (result.windows.fiveHour) {
    const window = result.windows.fiveHour;
    entries.push({
      name: `${label} 5h`,
      group: label,
      label: "5h:",
      right: `${numberDisplay(window.used)}/${numberDisplay(window.limit)}`,
      percentRemaining: window.percentRemaining,
      resetTimeIso: window.resetTimeIso,
    });
  }
  if (result.windows.weekly) {
    const window = result.windows.weekly;
    entries.push({
      name: `${label} Weekly`,
      group: label,
      label: "Weekly:",
      right: `${numberDisplay(window.used)}/${numberDisplay(window.limit)}`,
      percentRemaining: window.percentRemaining,
      resetTimeIso: window.resetTimeIso,
    });
  }
  return entries;
}

export const llmGateProvider: QuotaProvider = {
  id: "llmgate",

  async isAvailable(ctx: QuotaProviderContext): Promise<boolean> {
    const providerAvailable = await isCanonicalProviderWithModelsAvailable({
      ctx,
      providerId: "llmgate",
      fallbackOnError: false,
    });
    return providerAvailable && hasLlmGateAuthTokens();
  },

  matchesCurrentModel(model: string): boolean {
    return modelProviderMatchesRuntimeId(model, "llmgate");
  },

  async fetch(ctx: QuotaProviderContext): Promise<QuotaProviderResult> {
    const result = await queryLlmGateQuota({ requestTimeoutMs: ctx.config?.requestTimeoutMs });
    return mapNullableProviderResult(result, {
      errorLabel: "LLMGate",
      onSuccess: (success) => attemptedResult(buildEntries(success), [], {
        singleWindowDisplayName: success.planName ? `LLMGate ${success.planName}` : "LLMGate",
        singleWindowShowRight: true,
      }),
    });
  },
};
