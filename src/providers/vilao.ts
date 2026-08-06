import type { QuotaProvider, QuotaProviderContext, QuotaProviderResult } from "../lib/entries.js";
import { modelProviderMatchesRuntimeId } from "../lib/provider-model-matching.js";
import {
  formatVilaoVnd,
  getVilaoAuthDiagnostics,
  getVilaoCacheIdentity,
  hasVilaoPat,
  queryVilaoQuota,
} from "../lib/vilao.js";
import {
  attemptedResult,
  mapNullableProviderResult,
  statusDetailsFromRecord,
} from "./result-helpers.js";

export const vilaoProvider: QuotaProvider = {
  id: "vilao",

  cacheIdentity: getVilaoCacheIdentity,

  async isAvailable(_ctx: QuotaProviderContext): Promise<boolean> {
    return hasVilaoPat();
  },

  matchesCurrentModel(model: string): boolean {
    return modelProviderMatchesRuntimeId(model, "vilao");
  },

  async fetch(ctx: QuotaProviderContext): Promise<QuotaProviderResult> {
    const result = await queryVilaoQuota({ requestTimeoutMs: ctx.config?.requestTimeoutMs });
    const diagnostics = await getVilaoAuthDiagnostics();
    const statusDetails = statusDetailsFromRecord({
      pat_metadata: diagnostics.configured ? "configured" : "(none)",
      auth_paths: diagnostics.authPaths.join(" | ") || "(none)",
      local_state_path: diagnostics.statePath,
    });
    const mapped = mapNullableProviderResult(result, {
      errorLabel: "Vilao",
      onSuccess: (success) => ({
        ...attemptedResult([
          {
            accounting: {
              resultType: "balance",
              acquisitionMethod: "remote_api",
              ownership: "maintained",
              authority: "locally_derived",
              observedAtIso: new Date().toISOString(),
            },
            name: "Vilao Balance",
            group: "Vilao",
            label: "₫:",
            percentRemaining: success.percentRemaining,
          },
          {
            accounting: {
              resultType: "balance",
              acquisitionMethod: "remote_api",
              ownership: "maintained",
              authority: "locally_derived",
              observedAtIso: new Date().toISOString(),
            },
            kind: "value",
            name: "Vilao Remaining Balance",
            group: "Vilao",
            label: "Remaining:",
            value: formatVilaoVnd(success.balance),
          },
          {
            accounting: {
              resultType: "balance",
              acquisitionMethod: "remote_api",
              ownership: "maintained",
              authority: "locally_derived",
              observedAtIso: new Date().toISOString(),
            },
            kind: "value",
            name: "Vilao Maximum Balance",
            group: "Vilao",
            label: "Max:",
            value: formatVilaoVnd(success.baseline),
          },
        ]),
        rawDetails: [
          { key: "balance", value: formatVilaoVnd(success.balance) },
          { key: "observed_baseline", value: formatVilaoVnd(success.baseline) },
        ],
      }),
    });
    return { ...mapped, statusDetails };
  },
};
