# copass-hermes-agents

Copass agent primitives for the Hermes API server (NousResearch hermes-agent),
routed to LLMs via OpenRouter.

This package owns the Hermes-specific backend and the
`CopassHermesAgent(BaseAgent)` convenience subclass. Hermes itself runs
inside a per-(user, sandbox) Daytona sandbox; this client speaks
HTTP/SSE to the sandbox endpoint via `httpx.AsyncClient`.

## Spike-locked posture (ADR 0008 Phase 1b)

- Stateless `/v1/chat/completions` only. The full conversation history
  is sent in `messages[]` on every turn — Hermes' on-disk session DB
  is unused.
- `Authorization: Bearer <API_SERVER_KEY>` on every call. The bearer
  is the per-sandbox caller-side key minted at provision time; it is
  NOT an LLM key.
- Single OpenRouter credential-pool entry per sandbox (no rotation).
  Hermes resolves the OpenRouter key from process env at agent
  construction time.
- Model strings use the `hermes/<openrouter-model-id>` shape; the
  backend strips the `hermes/` prefix before forwarding to Hermes.
