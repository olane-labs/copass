/** Token usage and cost breakdown. */
export interface UsageResponse {
  summary: UsageSummary;
  by_model: Record<string, UsageSummary>;
  by_call_type: Record<string, UsageSummary>;
}

/** Aggregated usage summary. */
export interface UsageSummary {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd?: number;
}

/** Token credit balance. */
export interface UsageBalance {
  credits_remaining: number;
  credits_used: number;
  credits_total: number;
}
