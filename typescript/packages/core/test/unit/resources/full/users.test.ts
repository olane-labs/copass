import { describe, it, expect, beforeEach } from 'vitest';
import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

const FULL_PROFILE = {
  user_id: 'u-1',
  canonical_id: 'c-root',
  display_name: 'Alice',
  is_user_root: true,
  semantic_tags: ['person'],
  was_created: true,
  created_at: '2026-01-01T00:00:00',
  metadata: {},
  sandbox_id: 'sb-primary',
  project_id: 'proj-default',
};

describe('users', () => {
  beforeEach(() => mockFetch.mockReset());

  it('createProfile POSTs to /users/me/profile', async () => {
    mockFetch.mockResolvedValue(jsonResponse(FULL_PROFILE));
    const client = makeClient();
    const resp = await client.users.createProfile({ display_name: 'Alice' });
    const call = lastFetchCall();
    expect(call.url).toContain('/api/v1/users/me/profile');
    expect((call.body as { display_name: string }).display_name).toBe('Alice');
    expect(resp.user_id).toBe('u-1');
    expect(resp.canonical_id).toBe('c-root');
    expect(resp.sandbox_id).toBe('sb-primary');
    expect(resp.was_created).toBe(true);
  });

  it('getProfile GETs /users/me/profile', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ...FULL_PROFILE, was_created: false }));
    const client = makeClient();
    const resp = await client.users.getProfile();
    expect(lastFetchCall().url).toContain('/api/v1/users/me/profile');
    expect(resp.display_name).toBe('Alice');
    expect(resp.is_user_root).toBe(true);
    expect(resp.was_created).toBe(false);
  });
});
