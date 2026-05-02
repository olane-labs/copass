# Backend API Surface

All endpoints are served under the base URL `https://ai.copass.id` (unless noted otherwise).

## Authentication

All endpoints require authentication via one of:
- `Authorization: Bearer <jwt_token>` (Supabase JWT)
- `Authorization: Bearer <api_key>` (API key with `olk_` prefix)

Endpoints that accept encrypted payloads also use:
- `X-Encryption-Token: <session_token>` (wrapped DEK)

## Surface at a glance

The API is split between two layers:

| Layer | Prefix | Purpose |
|---|---|---|
| **Copass-ID storage** | `/api/v1/storage/*` | Sandboxes, data sources, projects, vault, ingestion |
| **Knowledge graph** | `/api/v1/*` | Querying, scoring, entities, users, API keys, usage |

> The legacy `/api/v1/extract/*` endpoints are **deprecated**. All ingestion now flows through `/api/v1/storage/ingest` and the sandbox-scoped `/api/v1/storage/sandboxes/{sandbox_id}/ingest`.

---

## Storage · Sandboxes

Sandboxes are the tenancy unit for copass-id. Each sandbox owns its data sources, projects, vault, and ingestion jobs.

### `POST /api/v1/storage/sandboxes`
Create a new sandbox.

**Request body:**
```json
{ "name": "string", "owner_id": "uuid", "tier": "free|pro|enterprise", "metadata": {} }
```
**Response:** `Sandbox` with `sandbox_id`, `status`, `storage_provider_type`, `limits`.

### `GET /api/v1/storage/sandboxes`
List sandboxes. Query: `status?`, `owner_id?`.

### `GET /api/v1/storage/sandboxes/{sandbox_id}`
Retrieve a sandbox.

### `PATCH /api/v1/storage/sandboxes/{sandbox_id}`
Update `name` and/or `metadata`.

### `POST /api/v1/storage/sandboxes/{sandbox_id}/suspend`
### `POST /api/v1/storage/sandboxes/{sandbox_id}/reactivate`
### `POST /api/v1/storage/sandboxes/{sandbox_id}/archive`
Soft lifecycle transitions. All return `StatusResponse`.

### `DELETE /api/v1/storage/sandboxes/{sandbox_id}`
Destroy sandbox and cascade-delete its data sources and projects.

---

## Storage · Data Sources

Nested under a sandbox. Every ingested byte is attributed to a data source —
register the source first, then push through it.

> **Ingestion is data-source driven.** The `ingestion_mode` on a source
> describes *who drives the push*, not a different endpoint:
>
> - **`manual`** — your backend pushes bytes via
>   `client.sources.ingest(sandboxId, sourceId, …)` (which hits
>   `POST /api/v1/storage/sandboxes/{sid}/ingest` with `data_source_id` set).
> - **`polling`** — same push, invoked by your workers on `poll_interval_seconds`
>   cadence (minimum 60 s). `last_sync_at` is stamped server-side on each
>   successful `ingest`.
> - **`realtime`** — same push, invoked from provider webhook handlers you
>   run. A `webhook_url` is generated on registration but is not yet served
>   by the Copass backend; wire it when server-side webhook handling lands.
>
> In every mode the wire path is identical. The mode is metadata that tells
> Copass (and your operators) how a source is expected to be driven. A
> future Copass scheduler / webhook router may take over the `polling` /
> `realtime` drivers without any client change.

### `POST /api/v1/storage/sandboxes/{sandbox_id}/sources`
**Request body:**
```json
{
  "provider": "slack|github|linear|gmail|jira|notion|custom",
  "name": "string",
  "ingestion_mode": "realtime|polling|batch|manual",
  "external_account_id": "string (optional)",
  "adapter_config": { "...": "provider-specific" },
  "poll_interval_seconds": 300
}
```

`poll_interval_seconds` must be ≥ 60 when present. `webhook_url` and
`last_sync_at` are server-maintained and returned on the response only —
they cannot be set via `POST` or `PATCH`.

### `GET /api/v1/storage/sandboxes/{sandbox_id}/sources`
Query: `provider?`, `status?`.

### `GET /api/v1/storage/sandboxes/{sandbox_id}/sources/{source_id}`
### `PATCH /api/v1/storage/sandboxes/{sandbox_id}/sources/{source_id}`
### `POST /api/v1/storage/sandboxes/{sandbox_id}/sources/{source_id}/pause`
### `POST /api/v1/storage/sandboxes/{sandbox_id}/sources/{source_id}/resume`
### `POST /api/v1/storage/sandboxes/{sandbox_id}/sources/{source_id}/disconnect`
### `DELETE /api/v1/storage/sandboxes/{sandbox_id}/sources/{source_id}`

---

## Storage · Projects

Sandbox-scoped project grouping. Replaces the deprecated `/api/v1/projects/*` indexing API.

### `POST /api/v1/storage/sandboxes/{sandbox_id}/projects`
**Request body:**
```json
{ "name": "string", "description": "string?", "data_source_ids": ["..."], "metadata": {} }
```

### `GET /api/v1/storage/sandboxes/{sandbox_id}/projects`
Query: `status?`.

### `GET /api/v1/storage/sandboxes/{sandbox_id}/projects/{project_id}`
### `PATCH /api/v1/storage/sandboxes/{sandbox_id}/projects/{project_id}`
### `POST /api/v1/storage/sandboxes/{sandbox_id}/projects/{project_id}/archive`
### `DELETE /api/v1/storage/sandboxes/{sandbox_id}/projects/{project_id}`

### `POST /api/v1/storage/sandboxes/{sandbox_id}/projects/{project_id}/sources/{source_id}`
Link a data source to a project.

### `DELETE /api/v1/storage/sandboxes/{sandbox_id}/projects/{project_id}/sources/{source_id}`
Unlink a data source.

---

## Storage · Vault

Encrypted object storage scoped to a sandbox. Uses raw bytes (not JSON).

### `PUT /api/v1/storage/sandboxes/{sandbox_id}/vault/{key:path}`
Store raw bytes. The request body is written as-is with the supplied `Content-Type`.

**Query parameters:**
- `encrypt=true` — encrypt before storing (requires encryption session)
- `deduplicate=true` — skip the write if identical content already exists

**Response:** `VaultStoreResponse` with `key`, `full_key`, `size_bytes`, `encrypted`, `deduplicated?`, `is_duplicate?`, `content_hash?`.

### `GET /api/v1/storage/sandboxes/{sandbox_id}/vault/{key:path}`
Retrieve raw bytes. Query: `decrypt=true|false` (default `true`).

### `DELETE /api/v1/storage/sandboxes/{sandbox_id}/vault/{key:path}`

### `GET /api/v1/storage/sandboxes/{sandbox_id}/vault`
List keys under a prefix. Query: `prefix?`, `max_keys?` (1–10000, default 1000).

---

## Storage · Ingestion

The transport beneath the data-source flow. In production, call
`client.sources.ingest(sandboxId, sourceId, …)` and let it set
`data_source_id` for you — these endpoints are the wire format, not the
recommended DX entry point. Dispatches a chunking job that owns downstream
ontology ingestion. Returns `202` with a `job_id` for polling.

### Shorthand (auto-resolves primary sandbox + default project)

### `POST /api/v1/storage/ingest`
**Request body:**
```json
{
  "text": "string",
  "source_type": "text|conversation|markdown|code|json",
  "storage_only": false,
  "project_id": "string (optional)",
  "data_source_id": "string (optional)"
}
```
**Response:** `{ "job_id", "status": "queued", "encrypted", "sandbox_id", "project_id", "status_url" }`

### `GET /api/v1/storage/ingest/{job_id}`
Job status. Includes `children` aggregation when the job is a parent chunking job.

### Explicit sandbox

### `POST /api/v1/storage/sandboxes/{sandbox_id}/ingest`
### `GET /api/v1/storage/sandboxes/{sandbox_id}/ingest/{job_id}`

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

### `POST /api/v2/plans/cosync`
Score a coding plan's knowledge confidence (v2).

---

## Matrix Query

### `GET /api/v1/matrix/query`
Natural language search across the knowledge graph.

**Query parameters:**
- `query` (required), `project_id?`, `reference_date?`, `detail_level?` (`concise|detailed`), `max_tokens?`

**Headers:**
- `X-Search-Matrix` — preset: `copass/1.0`, `copass/2.0` (append `:thinking` for task decomposition)
- `X-Detail-Instruction`, `X-Trace-Id`

---

## Canonical Entities

### `GET /api/v1/users/me/canonical-entities`
### `GET /api/v1/users/me/canonical-entities/{canonical_id}/perspective`

> Extraction provenance is no longer served from the entities API. To retrieve
> the sources that produced an entity, query the copass-id storage layer
> (ingestion jobs under `/api/v1/storage/ingest/{job_id}` and data sources under
> `/api/v1/storage/sandboxes/{sandbox_id}/sources`).

### `GET /api/v1/users/me/entities/search`
Query: `q` (required), `limit?`, `record_type?`, `min_similarity?`, `canonical_id?`.

---

## User Profile

### `POST /api/v1/users/me/profile`
Create or promote a user profile.

### `GET /api/v1/users/me/profile`
Get the current profile.

---

## API Keys

### `POST /api/v1/api-keys`
### `GET /api/v1/api-keys`
### `DELETE /api/v1/api-keys/{key_id}`

---

## Usage

### `GET /api/v1/usage`
Token consumption and cost breakdown.

### `GET /api/v1/usage/credits`
Token credit balance.

---

## Deprecated

The following endpoints are deprecated and removed from the SDK. Do not use them for new integrations:

- `POST /api/v1/extract`, `/extract/code`, `/extract/file`, `/extract/files`, `/extract/llm-only`, `/extract/file/llm-only`, `/extract/files/llm-only`
- `GET /api/v1/extract/jobs`, `GET /api/v1/extract/jobs/{job_id}`
- `POST /api/v1/extract/jobs/cancel`, `POST /api/v1/extract/jobs/retry-failed`
- `POST /api/v1/projects/register`, `GET /api/v1/projects/status`, `PATCH /api/v1/projects/{project_id}/complete`, `GET /api/v1/projects`

Use the storage ingest + sandbox-scoped project endpoints above instead.

---

## Error Responses

All errors follow this format:

```json
{ "error": "error_type", "detail": "Human readable message" }
```

**Status codes:** 400 (validation), 401 (auth required), 403 (forbidden), 404 (not found), 409 (conflict), 422 (unprocessable), 500 (internal), 503 (unavailable).
