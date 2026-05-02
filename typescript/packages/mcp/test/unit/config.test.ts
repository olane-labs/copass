import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('parses all fields from env', () => {
    const cfg = loadConfig({
      COPASS_API_KEY: 'olk_test',
      COPASS_SANDBOX_ID: 'sb1',
      COPASS_API_URL: 'http://localhost:8000',
      COPASS_PROJECT_ID: 'proj_42',
      COPASS_PRESET: 'copass/1.0',
      COPASS_INGEST_DATA_SOURCE_ID: 'ds_ingest',
    });

    expect(cfg).toEqual({
      api_key: 'olk_test',
      sandbox_id: 'sb1',
      api_url: 'http://localhost:8000',
      project_id: 'proj_42',
      preset: 'copass/1.0',
      ingest_data_source_id: 'ds_ingest',
    });
  });

  it('defaults optional fields', () => {
    const cfg = loadConfig({
      COPASS_API_KEY: 'olk_test',
      COPASS_SANDBOX_ID: 'sb1',
    });

    expect(cfg.api_url).toBe('https://ai.copass.id');
    expect(cfg.preset).toBe('copass/1.0');
    expect(cfg.project_id).toBeUndefined();
    expect(cfg.ingest_data_source_id).toBeUndefined();
  });

  it('throws listing missing required vars', () => {
    expect(() => loadConfig({})).toThrow(/COPASS_API_KEY.*COPASS_SANDBOX_ID/);
  });

  it('throws on invalid preset', () => {
    expect(() =>
      loadConfig({
        COPASS_API_KEY: 'olk_test',
        COPASS_SANDBOX_ID: 'sb1',
        COPASS_PRESET: 'ludicrous',
      }),
    ).toThrow(/COPASS_PRESET must be one of/);
  });

  it('parses COPASS_CONTEXT_WINDOW_INITIAL_TURNS from JSON', () => {
    const cfg = loadConfig({
      COPASS_API_KEY: 'olk_test',
      COPASS_SANDBOX_ID: 'sb1',
      COPASS_CONTEXT_WINDOW_ID: 'ds_x',
      COPASS_CONTEXT_WINDOW_INITIAL_TURNS: JSON.stringify([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ]),
    });

    expect(cfg.context_window_initial_turns).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]);
  });

  it('leaves initial turns undefined when env var is absent', () => {
    const cfg = loadConfig({
      COPASS_API_KEY: 'olk_test',
      COPASS_SANDBOX_ID: 'sb1',
    });

    expect(cfg.context_window_initial_turns).toBeUndefined();
  });

  it('throws on malformed initial turns JSON', () => {
    expect(() =>
      loadConfig({
        COPASS_API_KEY: 'olk_test',
        COPASS_SANDBOX_ID: 'sb1',
        COPASS_CONTEXT_WINDOW_INITIAL_TURNS: 'not json',
      }),
    ).toThrow(/not valid JSON/);
  });

  it('throws on initial turns with bad shape', () => {
    expect(() =>
      loadConfig({
        COPASS_API_KEY: 'olk_test',
        COPASS_SANDBOX_ID: 'sb1',
        COPASS_CONTEXT_WINDOW_INITIAL_TURNS: JSON.stringify([{ role: 'user' }]),
      }),
    ).toThrow(/must be \{role: string, content: string\}/);
  });

  it('throws on unknown role in initial turns', () => {
    expect(() =>
      loadConfig({
        COPASS_API_KEY: 'olk_test',
        COPASS_SANDBOX_ID: 'sb1',
        COPASS_CONTEXT_WINDOW_INITIAL_TURNS: JSON.stringify([
          { role: 'robot', content: 'beep' },
        ]),
      }),
    ).toThrow(/must be "user" \| "assistant" \| "system"/);
  });
});
