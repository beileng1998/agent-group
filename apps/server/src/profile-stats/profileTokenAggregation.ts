import type { ProviderKind } from "@agent-group/contracts";

import type { TokenDayRow } from "./profileStatsRows";
import { nonEmptyString, normalizeProviderKind, num } from "./profileStatsValues";

export interface TokenModelUsageCount {
  readonly provider: ProviderKind | "unknown";
  readonly model: string;
  tokens: number;
}

export interface TokenActivityAggregate {
  readonly tokensByDay: Map<string, number>;
  readonly tokensByProvider: Map<ProviderKind, number>;
  readonly tokensByProviderModel: Map<string, TokenModelUsageCount>;
  readonly lifetime: number;
}

export function aggregateTokenActivity(rows: ReadonlyArray<TokenDayRow>): TokenActivityAggregate {
  const tokensByDay = new Map<string, number>();
  const tokensByProvider = new Map<ProviderKind, number>();
  const tokensByProviderModel = new Map<string, TokenModelUsageCount>();
  let lifetime = 0;
  for (const row of rows) {
    const day = nonEmptyString(row.day);
    const tokens = num(row.tokens);
    if (!day || tokens <= 0) continue;
    tokensByDay.set(day, (tokensByDay.get(day) ?? 0) + tokens);
    lifetime += tokens;
    const provider = normalizeProviderKind(row.provider);
    if (provider !== "unknown") {
      tokensByProvider.set(provider, (tokensByProvider.get(provider) ?? 0) + tokens);
    }
    const model = nonEmptyString(row.model) ?? "unknown";
    const providerModelKey = `${provider}\u0000${model}`;
    const existing = tokensByProviderModel.get(providerModelKey);
    if (existing) existing.tokens += tokens;
    else tokensByProviderModel.set(providerModelKey, { provider, model, tokens });
  }
  return { tokensByDay, tokensByProvider, tokensByProviderModel, lifetime };
}
