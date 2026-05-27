import { describe, it, expect } from 'vitest';
import * as config from '../../src/index.js';

describe('@copass/config exports', () => {
  const keys = [
    'DISCOVER_DESCRIPTION',
    'MCP_DISCOVER_DESCRIPTION',
    'INTERPRET_DESCRIPTION',
    'SEARCH_DESCRIPTION',
    'DISCOVER_QUERY_PARAM',
    'INTERPRET_QUERY_PARAM',
    'SEARCH_QUERY_PARAM',
    'INTERPRET_ITEMS_PARAM',
    'PROJECT_ID_PARAM',
    'PRESET_PARAM',
    'COPASS_AGENT_MCP_SYSTEM_PROMPT',
    'COPASS_AGENT_SDK_SYSTEM_PROMPT',
  ] as const;

  for (const key of keys) {
    it(`exports ${key} as a non-empty string`, () => {
      const value = (config as Record<string, unknown>)[key];
      expect(typeof value).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
    });
  }

  it('DISCOVER_DESCRIPTION mentions window-awareness + new signal', () => {
    expect(config.DISCOVER_DESCRIPTION).toMatch(/window-aware/i);
    expect(config.DISCOVER_DESCRIPTION).toMatch(/new\s+signal/i);
  });

  it('DISCOVER_DESCRIPTION points drill-in at search (not interpret)', () => {
    expect(config.DISCOVER_DESCRIPTION).toMatch(/drill.*search|search.*drill/i);
    expect(config.DISCOVER_DESCRIPTION).not.toMatch(/interpret/i);
  });

  it('MCP_DISCOVER_DESCRIPTION does NOT mention auto-fire (MCP gives no such guarantee)', () => {
    expect(config.MCP_DISCOVER_DESCRIPTION).not.toMatch(/auto-fire|auto-inject/i);
    expect(config.MCP_DISCOVER_DESCRIPTION).not.toMatch(/interpret/i);
  });

  it('SEARCH_DESCRIPTION carries the per-turn hard rule', () => {
    expect(config.SEARCH_DESCRIPTION).toMatch(/every user turn/i);
    expect(config.SEARCH_DESCRIPTION).toMatch(/discover|search/);
  });

  it('MCP system prompt does not reference the removed interpret tool', () => {
    expect(config.COPASS_AGENT_MCP_SYSTEM_PROMPT).not.toMatch(/interpret/i);
  });

  it('SDK system prompt drills in via search, not interpret', () => {
    const prompt = config.COPASS_AGENT_SDK_SYSTEM_PROMPT;
    expect(prompt).toMatch(/discover/);
    expect(prompt).toMatch(/search/);
    expect(prompt).not.toMatch(/interpret/i);
  });
});
