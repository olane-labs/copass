/** Token usage and cost breakdown — mirrors backend ``UsageResponse``. */
export interface UsageResponse {
  summary: UsageSummary;
  by_model: ModelUsage[];
  by_call_type: CallTypeUsage[];
  start_date?: string;
  end_date?: string;
}

/** Aggregated usage summary. */
export interface UsageSummary {
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  total_cost_usd: number;
  total_calls: number;
}

/** Per-model usage row. */
export interface ModelUsage {
  model: string;
  provider: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  calls: number;
}

/** Per-call-type usage row. */
export interface CallTypeUsage {
  call_type: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  calls: number;
}

/** Token credit balance — mirrors backend ``TokenBalanceResponse``.
 *
 * Phase 2+ stores amounts as USD microcents (1e-6 USD). The legacy
 * token-denominated balance (pre-Phase-0) is rolled forward via a
 * one-time backfill migration. Branch on ``currency`` rather than
 * assuming tokens.
 */
export interface UsageBalance {
  credits_purchased: number;
  credits_used: number;
  credits_remaining: number;
  currency: string;
}
