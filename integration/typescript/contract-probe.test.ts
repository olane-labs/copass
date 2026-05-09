/**
 * Live contract probe — TS SDK against deployed Copass API.
 *
 * Each test sends one real request and asserts the response **shape**
 * matches what the Tier 1 mock fixtures assume. Catches the case where
 * the API changed but the mocks didn't.
 *
 * Skipped automatically when COPASS_INTEGRATION_API_KEY is unset.
 * Read-only — no creates, updates, or deletes.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CopassClient } from '@copass/core';

const API_KEY = process.env.COPASS_INTEGRATION_API_KEY;
const SANDBOX_ID = process.env.COPASS_INTEGRATION_SANDBOX_ID;
const API_URL = process.env.COPASS_API_URL ?? 'https://ai.staging.copass.id';

const skip = !API_KEY || !SANDBOX_ID;

describe.skipIf(skip)('TS SDK contract probe', () => {
  let client: CopassClient;

  beforeAll(() => {
    client = new CopassClient({
      apiUrl: API_URL,
      auth: { type: 'api-key', key: API_KEY! },
    });
  });

  it('users.getProfile returns user_id', async () => {
    const resp = await client.users.getProfile();
    expect(resp).toHaveProperty('user_id');
  });

  it('apiKeys.list returns an array', async () => {
    const resp = await client.apiKeys.list();
    expect(Array.isArray(resp)).toBe(true);
  });

  it('usage.getBalance returns balance_credits', async () => {
    const resp = await client.usage.getBalance();
    expect(resp).toHaveProperty('balance_credits');
  });

  it('usage.getSummary returns an object', async () => {
    const resp = await client.usage.getSummary();
    expect(typeof resp).toBe('object');
  });

  it('sandboxes.list returns sandboxes envelope', async () => {
    const resp = await client.sandboxes.list();
    expect(resp).toHaveProperty('sandboxes');
  });

  it('retrieval.discover (copass/copass_1.0) returns items', async () => {
    const resp = await client.retrieval.discover(SANDBOX_ID!, {
      query: 'what context is available',
      preset: 'copass/copass_1.0',
    });
    expect(resp).toHaveProperty('items');
    if (resp.items.length > 0) {
      const item = resp.items[0];
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('score');
      expect(item).toHaveProperty('canonical_ids');
    }
  });

  it('retrieval.discover (copass/copass_2.0) returns items with v2 fields', async () => {
    const resp = await client.retrieval.discover(SANDBOX_ID!, {
      query: 'what context is available',
      preset: 'copass/copass_2.0',
    });
    expect(resp).toHaveProperty('items');
    if (resp.items.length > 0) {
      const item = resp.items[0];
      // v2 contract: subgraph + matched_query_nodes present (may be null
      // on cold-start sandboxes — the mocks assume populated).
      expect(item).toHaveProperty('subgraph');
      expect(item).toHaveProperty('matched_query_nodes');
    }
  });

  it('retrieval.search returns answer + preset echo', async () => {
    const resp = await client.retrieval.search(SANDBOX_ID!, {
      query: 'what is the user working on',
    });
    expect(resp).toHaveProperty('answer');
    expect(resp).toHaveProperty('preset');
    expect(resp).toHaveProperty('execution_time_ms');
  });

  it('retrieval.interpret returns brief + citations', async () => {
    const discover = await client.retrieval.discover(SANDBOX_ID!, {
      query: 'overview',
      preset: 'copass/copass_1.0',
    });
    if (discover.items.length === 0) {
      console.log('skip interpret — smoke sandbox has no items to interpret on');
      return;
    }
    const resp = await client.retrieval.interpret(SANDBOX_ID!, {
      query: 'overview',
      items: [discover.items[0].canonical_ids],
    });
    expect(resp).toHaveProperty('brief');
    expect(resp).toHaveProperty('citations');
  });
});
