import { describe, it, expect } from 'vitest';
import { CopassClient } from '../../src/client.js';

describe('CopassClient', () => {
  it('instantiates with api-key auth', () => {
    const client = new CopassClient({
      auth: { type: 'api-key', key: 'olk_test' },
    });

    expect(client.sandboxes).toBeDefined();
    expect(client.sources).toBeDefined();
    expect(client.projects).toBeDefined();
    expect(client.vault).toBeDefined();
    expect(client.ingest).toBeDefined();
    expect(client.entities).toBeDefined();
    expect(client.matrix).toBeDefined();
    expect(client.users).toBeDefined();
    expect(client.apiKeys).toBeDefined();
    expect(client.usage).toBeDefined();
  });

  it('instantiates with bearer auth', () => {
    const client = new CopassClient({
      auth: { type: 'bearer', token: 'jwt-token' },
    });

    expect(client.ingest).toBeDefined();
  });

  it('accepts custom apiUrl', () => {
    const client = new CopassClient({
      apiUrl: 'https://custom.example.com',
      auth: { type: 'api-key', key: 'olk_test' },
    });

    expect(client).toBeDefined();
  });

  it('accepts encryptionKey', () => {
    const client = new CopassClient({
      auth: { type: 'bearer', token: 'jwt' },
      encryptionKey: 'my-master-key',
    });

    expect(client).toBeDefined();
  });

  it('accepts retry config', () => {
    const client = new CopassClient({
      auth: { type: 'api-key', key: 'olk_test' },
      retry: { maxAttempts: 5, backoffStrategy: 'linear', backoffBaseMs: 500 },
    });

    expect(client).toBeDefined();
  });
});
