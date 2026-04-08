# Backend API Surface

All endpoints are served under the base URL `https://ai.copass.id` with an `/api/v1` prefix (unless noted otherwise).

## Authentication

All endpoints require authentication via one of:
- `Authorization: Bearer <jwt_token>` (Supabase JWT)
- `Authorization: Bearer <api_key>` (API key with `olk_` prefix)

Endpoints that accept encrypted payloads also use:
- `X-Encryption-Token: <session_token>` (wrapped DEK)

---

## Extraction

Ingest text, code, and files into the knowledge graph.

### `POST /api/v1/extract`
Process text and generate ontology events.

**Request body:**
```json
{
  "text": "string (mutually exclusive with encrypted_text)",
  "encrypted_text": "string (base64, mutually exclusive with text)",
  "encryption_iv": "string (base64, required with encrypted_text)",
  "encryption_tag": "string (base64, required with encrypted_text)",
  "source_type": "string (optional)",
  "source_id": "string (optional, for deduplication)",
  "explicit_root_id": "string (optional)",
  "canonical_id": "string (optional)",
  "external_ids": { "email": "...", "github": "..." },
  "entity_hints": ["string"],
  "conversation_history": [{ "role": "...", "content": "..." }],
  "enable_conversation_adaptation": false,
  "materialize": false,
  "skip_cache": false,
  "project_id": "string (optional)"
}
```

**Response:** `ExtractResponse` with `canonical_id`, `behaviors`, `resolution` info.

### `POST /api/v1/extract/code`
Process code files.

### `POST /api/v1/extract/file`
Process an uploaded file (multipart/form-data).

### `POST /api/v1/extract/files`
Batch file processing (multipart/form-data).

### `GET /api/v1/extract/jobs/{job_id}`
Get extraction job status.

**Response:** `{ "job_id", "status": "pending|processing|completed|failed", ... }`

### `GET /api/v1/extract/jobs`
List extraction jobs.

### `POST /api/v1/extract/jobs/cancel`
Cancel an extraction job.

### `POST /api/v1/extract/jobs/retry`
Retry failed extraction jobs.

---

## Knowledge Scoring (Cosync)

### `POST /api/v1/cosync`
Score entities by knowledge confidence.

**Request body:**
```json
{
  "canonical_ids": ["uuid"],
  "text": "string (optional, for auto-scoping)",
  "project_id": "string (optional)"
}
```

**Response:**
```json
{
  "aggregate_score": 0.75,
  "tier": "review",
  "tier_label": "Review Recommended",
  "tier_action": "...",
  "entities": [
    {
      "entity_name": "...",
      "canonical_id": "...",
      "score": 0.8,
      "dimensions": { "...": { "name": "...", "score": 0.9, "weight": 0.3 } },
      "dominant_deficit": "...",
      "deficit_gap": 0.1
    }
  ],
  "learning_priorities": [...],
  "computation_time_ms": 42
}
```

### `POST /api/v2/plans/cosync`
Score a coding plan's knowledge confidence (v2).

**Request body:**
```json
{
  "plan_text": "string",
  "entities": [{ "name": "...", "hop_distance": 1 }],
  "project_id": "string (optional)"
}
```

**Response:** Tier classification, entity scores, learning priorities, model recommendation.

---

## Matrix Query

### `GET /api/v1/matrix/query`
Natural language search across the knowledge graph.

**Query parameters:**
- `query` (required) -- Natural language question
- `project_id` (optional) -- Scope to a project
- `reference_date` (optional) -- YYYY-MM-DD for temporal resolution
- `detail_level` -- `"concise"` or `"detailed"`
- `max_tokens` (optional) -- Override LLM token limit

**Headers:**
- `X-Search-Matrix` -- Preset name: `semantic_alignment`, `semantic_path`, `hierarchical`, `temporal_only`, `direct_graph`, `path_discovery`
- `X-Detail-Instruction` -- Custom LLM instruction
- `X-Trace-Id` -- Correlation ID for tracing

**Response:**
```json
{
  "answer": "string",
  "context": "string",
  "execution_time_ms": 150
}
```

---

## Canonical Entities

### `GET /api/v1/users/me/canonical-entities`
List all canonical entities for the authenticated user.

### `GET /api/v1/users/me/canonical-entities/{canonical_id}/perspective`
Get full perspective of a canonical entity (behaviors, metadata, portals, time series).

### `GET /api/v1/users/me/canonical-entities/{canonical_id}/extraction-sources`
List extraction sources for a canonical entity.

---

## User Profile

### `POST /api/v1/users/me/profile`
Create or promote a user profile.

**Request body:**
```json
{
  "display_name": "string (for new profile)",
  "canonical_id": "string (to promote existing entity)"
}
```

**Response:** `{ "canonical_id", "display_name", "is_user_root", "semantic_tags" }`

---

## Projects

### `POST /api/v1/projects/register`
Register or upsert a project.

**Request body:**
```json
{
  "project_path": "/path/to/project",
  "project_name": "my-project",
  "indexing_mode": "full|incremental"
}
```

### `GET /api/v1/projects/status?project_path=...`
Get project indexing status.

### `PATCH /api/v1/projects/{project_id}/complete`
Mark project indexing as complete.

---

## API Keys

### `POST /api/v1/api-keys`
Create a new API key.

**Request body:** `{ "name": "string", "expires_in_days": 90 }`
**Response:** `{ "key_id", "key": "olk_... (shown only once)", "name", "created_at" }`

### `GET /api/v1/api-keys`
List API keys (masked).

### `DELETE /api/v1/api-keys/{key_id}`
Revoke an API key.

---

## Usage

### `GET /api/v1/usage`
Get token consumption and cost breakdown.

**Response:** `{ "summary", "by_model", "by_call_type" }`

### `GET /api/v1/usage/balance`
Get token credit balance.

---

## Error Responses

All errors follow this format:

```json
{
  "error": "error_type",
  "detail": "Human readable message"
}
```

**Status codes:** 400 (validation), 401 (auth required), 403 (forbidden), 404 (not found), 409 (conflict), 422 (unprocessable), 500 (internal), 503 (unavailable).
