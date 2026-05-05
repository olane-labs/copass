import { describe, it, expect, beforeEach } from 'vitest';
import { jsonResponse, lastFetchCall, makeClient, mockFetch } from './_helpers.js';

describe('users', () => {
  beforeEach(() => mockFetch.mockReset());

  it('createProfile POSTs to /users/me/profile', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ user_id: 'u-1', display_name: 'Alice' }),
    );
    const client = makeClient();
    const resp = await client.users.createProfile({ display_name: 'Alice' });
    const call = lastFetchCall();
    expect(call.url).toContain('/api/v1/users/me/profile');
    expect((call.body as { display_name: string }).display_name).toBe('Alice');
    expect(resp.user_id).toBe('u-1');
  });

  it('getProfile GETs /users/me/profile', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ user_id: 'u-1', display_name: 'Alice' }),
    );
    const client = makeClient();
    const resp = await client.users.getProfile();
    expect(lastFetchCall().url).toContain('/api/v1/users/me/profile');
    expect(resp.display_name).toBe('Alice');
  });
});
