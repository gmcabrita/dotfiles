/** DeepSeek prepaid balance via `GET /user/balance`. */

import { balanceRow, type ProviderUsage, type UsageProvider } from "../model.ts";
import { getJson } from "./http.ts";

export const DEEPSEEK_BALANCE_ENDPOINT = "https://api.deepseek.com/user/balance";

export interface DeepSeekBalanceResponse {
  is_available: boolean;
  balance_infos: {
    currency: string;
    total_balance: string;
    granted_balance: string;
    topped_up_balance: string;
  }[];
}

export function parseDeepSeekUsage(body: DeepSeekBalanceResponse): ProviderUsage {
  const rows = body.balance_infos.map((info) =>
    balanceRow(`Balance (${info.currency})`, Number.parseFloat(info.total_balance), null, info.currency),
  );
  const notes = body.is_available ? [] : ["Account has no available balance."];
  return { rows, notes };
}

export const deepSeekUsageProvider: UsageProvider = {
  id: "deepseek",
  label: "DeepSeek",
  async fetch(auth) {
    const body = await getJson<DeepSeekBalanceResponse>(DEEPSEEK_BALANCE_ENDPOINT, {
      Authorization: `Bearer ${auth.token}`,
    });
    return parseDeepSeekUsage(body);
  },
};
