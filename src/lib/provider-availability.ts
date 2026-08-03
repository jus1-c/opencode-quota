import type { QuotaProviderContext } from "./entries.js";
import {
  getQuotaProviderRuntimeIds,
  type CanonicalQuotaProviderId,
} from "./provider-metadata.js";

export async function isAnyProviderIdAvailable(params: {
  ctx: Pick<QuotaProviderContext, "client">;
  candidateIds: readonly string[];
  fallbackOnError: boolean;
}): Promise<boolean> {
  const { ctx, candidateIds, fallbackOnError } = params;

  try {
    const resp = await ctx.client.config.providers();
    const ids = new Set((resp.data?.providers ?? []).map((p) => p.id));
    return candidateIds.some((id) => ids.has(id));
  } catch {
    return fallbackOnError;
  }
}

export async function isAnyProviderIdWithModelsAvailable(params: {
  ctx: Pick<QuotaProviderContext, "client">;
  candidateIds: readonly string[];
  fallbackOnError: boolean;
}): Promise<boolean> {
  const { ctx, candidateIds, fallbackOnError } = params;

  try {
    const resp = await ctx.client.config.providers();
    return (resp.data?.providers ?? []).some((provider) => {
      if (!candidateIds.includes(provider.id)) return false;
      // Older clients and standalone quota commands expose only provider IDs.
      // A runtime response with an explicit empty model map means no usable models.
      return provider.models === undefined || Object.keys(provider.models).length > 0;
    });
  } catch {
    return fallbackOnError;
  }
}

export async function isCanonicalProviderAvailable(params: {
  ctx: Pick<QuotaProviderContext, "client">;
  providerId: CanonicalQuotaProviderId;
  fallbackOnError: boolean;
}): Promise<boolean> {
  const { ctx, providerId, fallbackOnError } = params;
  return isAnyProviderIdAvailable({
    ctx,
    candidateIds: getQuotaProviderRuntimeIds(providerId),
    fallbackOnError,
  });
}

export async function isCanonicalProviderWithModelsAvailable(params: {
  ctx: Pick<QuotaProviderContext, "client">;
  providerId: CanonicalQuotaProviderId;
  fallbackOnError: boolean;
}): Promise<boolean> {
  const { ctx, providerId, fallbackOnError } = params;
  return isAnyProviderIdWithModelsAvailable({
    ctx,
    candidateIds: getQuotaProviderRuntimeIds(providerId),
    fallbackOnError,
  });
}
