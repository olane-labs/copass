/**
 * Dispatch tests for management tool handlers — every handler covered.
 *
 * Each handler maps a validated input into a
 * `ctx.client.<resource>.<method>(...)` call. These tests verify the
 * mapping is correct — when the SDK refactors a method signature or
 * moves a resource, the matching handler test fails.
 *
 * Mirrors the Python copass_management dispatch test suite.
 */
import { describe, it, expect, vi } from 'vitest';
import { addUserMcpSource } from '../src/tools/add_user_mcp_source.js';
import { connectLinear } from '../src/tools/connect_linear.js';
import { createAgent } from '../src/tools/create_agent.js';
import { createTrigger } from '../src/tools/create_trigger.js';
import { getAgent } from '../src/tools/get_agent.js';
import { getRunTrace } from '../src/tools/get_run_trace.js';
import { getSource } from '../src/tools/get_source.js';
import { grantSandboxConnection } from '../src/tools/grant_sandbox_connection.js';
import { listAgentTools } from '../src/tools/list_agent_tools.js';
import { listAgents } from '../src/tools/list_agents.js';
import { listApiKeys } from '../src/tools/list_api_keys.js';
import { listApps } from '../src/tools/list_apps.js';
import { listConnectedAccounts } from '../src/tools/list_connected_accounts.js';
import { listRuns } from '../src/tools/list_runs.js';
import { listSandboxConnections } from '../src/tools/list_sandbox_connections.js';
import { listSandboxes } from '../src/tools/list_sandboxes.js';
import { listSources } from '../src/tools/list_sources.js';
import { listTriggerComponents } from '../src/tools/list_trigger_components.js';
import { listTriggers } from '../src/tools/list_triggers.js';
import { pauseTrigger } from '../src/tools/pause_trigger.js';
import { provisionSource } from '../src/tools/provision_source.js';
import { resumeTrigger } from '../src/tools/resume_trigger.js';
import { revokeSandboxConnection } from '../src/tools/revoke_sandbox_connection.js';
import { revokeUserMcpSource } from '../src/tools/revoke_user_mcp_source.js';
import { startIntegrationConnect } from '../src/tools/start_integration_connect.js';
import { testUserMcpSource } from '../src/tools/test_user_mcp_source.js';
import { updateAgentModelSettings } from '../src/tools/update_agent_model_settings.js';
import { updateAgentPrompt } from '../src/tools/update_agent_prompt.js';
import { updateAgentToolSources } from '../src/tools/update_agent_tool_sources.js';
import { updateAgentTools } from '../src/tools/update_agent_tools.js';
import { updateSource } from '../src/tools/update_source.js';
import { updateTrigger } from '../src/tools/update_trigger.js';
import { wireIntegrationToAgent } from '../src/tools/wire_integration_to_agent.js';
import type { ToolContext } from '../src/registrar.js';

function makeCtx(): ToolContext {
  const client = {
    apiKeys: { list: vi.fn().mockResolvedValue([]) },
    integrations: {
      catalog: vi.fn().mockResolvedValue({ apps: [] }),
      listAccounts: vi.fn().mockResolvedValue({ accounts: [] }),
      connect: vi.fn().mockResolvedValue({ source_id: 'src-1' }),
    },
    sandboxes: { list: vi.fn().mockResolvedValue({ sandboxes: [], count: 0 }) },
    sandboxConnections: {
      create: vi.fn().mockResolvedValue({ connection_id: 'conn-1' }),
      list: vi.fn().mockResolvedValue({ connections: [], count: 0 }),
      revoke: vi.fn().mockResolvedValue({ revoked: true }),
    },
    sources: {
      register: vi.fn().mockResolvedValue({ data_source_id: 'ds-1' }),
      list: vi.fn().mockResolvedValue({ sources: [], count: 0 }),
      retrieve: vi.fn().mockResolvedValue({ data_source_id: 'ds-1' }),
      update: vi.fn().mockResolvedValue({ data_source_id: 'ds-1' }),
      connectLinear: vi.fn().mockResolvedValue({ data_source_id: 'ds-linear' }),
      registerUserMcp: vi.fn().mockResolvedValue({ data_source_id: 'ds-mcp-1' }),
      testUserMcp: vi.fn().mockResolvedValue({ reachable: true }),
      revokeUserMcp: vi.fn().mockResolvedValue({ revoked: true }),
    },
    agents: {
      create: vi.fn().mockResolvedValue({ slug: 'new-bot' }),
      list: vi.fn().mockResolvedValue({ agents: [], count: 0 }),
      retrieve: vi.fn().mockResolvedValue({ slug: 'bot' }),
      update: vi.fn().mockResolvedValue({ slug: 'bot' }),
      updateModelSettings: vi.fn().mockResolvedValue({ slug: 'bot' }),
      updateToolSources: vi.fn().mockResolvedValue({ slug: 'bot' }),
      wireIntegration: vi.fn().mockResolvedValue({
        wired: true, mode: 'explicit', sources_added: [], tool_count: 5, message: 'ok',
      }),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      listRuns: vi.fn().mockResolvedValue({ runs: [], count: 0 }),
      getRun: vi.fn().mockResolvedValue({ run_id: 'run-1' }),
      listTriggerComponents: vi.fn().mockResolvedValue({ components: [] }),
      triggers: {
        create: vi.fn().mockResolvedValue({ trigger_id: 'trg-1' }),
        list: vi.fn().mockResolvedValue({ triggers: [], count: 0 }),
        updateById: vi.fn().mockResolvedValue({ trigger_id: 'trg-1' }),
      },
    },
  };
  return { client: client as unknown as ToolContext['client'], sandboxId: 'sb-1', userId: 'u-1' };
}

describe('management tool handlers — full dispatch coverage', () => {
  it('listApps -> integrations.catalog', async () => {
    const ctx = makeCtx();
    await listApps(ctx, { q: 'slack', limit: 10 });
    expect(ctx.client.integrations.catalog).toHaveBeenCalled();
  });

  it('listConnectedAccounts -> integrations.listAccounts', async () => {
    const ctx = makeCtx();
    await listConnectedAccounts(ctx, { app_slug: 'slack' });
    expect(ctx.client.integrations.listAccounts).toHaveBeenCalled();
  });

  it('startIntegrationConnect -> integrations.connect', async () => {
    const ctx = makeCtx();
    await startIntegrationConnect(ctx, {
      app_slug: 'slack',
      success_redirect_uri: 'https://app.example/ok',
      error_redirect_uri: 'https://app.example/err',
    });
    expect(ctx.client.integrations.connect).toHaveBeenCalled();
  });

  it('listSandboxes -> sandboxes.list', async () => {
    const ctx = makeCtx();
    await listSandboxes(ctx, {});
    expect(ctx.client.sandboxes.list).toHaveBeenCalled();
  });

  it('grantSandboxConnection -> sandboxConnections.create', async () => {
    const ctx = makeCtx();
    await grantSandboxConnection(ctx, { user_id: 'u-2', role: 'viewer' });
    expect(ctx.client.sandboxConnections.create).toHaveBeenCalled();
  });

  it('listSandboxConnections -> sandboxConnections.list', async () => {
    const ctx = makeCtx();
    await listSandboxConnections(ctx, {});
    expect(ctx.client.sandboxConnections.list).toHaveBeenCalled();
  });

  it('revokeSandboxConnection -> sandboxConnections.revoke', async () => {
    const ctx = makeCtx();
    await revokeSandboxConnection(ctx, { connection_id: 'conn-1' });
    expect(ctx.client.sandboxConnections.revoke).toHaveBeenCalled();
  });

  it('listApiKeys -> apiKeys.list', async () => {
    const ctx = makeCtx();
    await listApiKeys(ctx, {});
    expect(ctx.client.apiKeys.list).toHaveBeenCalled();
  });

  it('provisionSource -> sources.register', async () => {
    const ctx = makeCtx();
    await provisionSource(ctx, { provider: 'manual', name: 'demo' });
    expect(ctx.client.sources.register).toHaveBeenCalled();
  });

  it('listSources -> sources.list', async () => {
    const ctx = makeCtx();
    await listSources(ctx, {});
    expect(ctx.client.sources.list).toHaveBeenCalled();
  });

  it('getSource -> sources.retrieve', async () => {
    const ctx = makeCtx();
    await getSource(ctx, { data_source_id: 'ds-1' });
    expect(ctx.client.sources.retrieve).toHaveBeenCalled();
  });

  it('updateSource -> sources.update', async () => {
    const ctx = makeCtx();
    await updateSource(ctx, { data_source_id: 'ds-1', name: 'renamed' });
    expect(ctx.client.sources.update).toHaveBeenCalled();
  });

  it('connectLinear -> sources.connectLinear', async () => {
    const ctx = makeCtx();
    await connectLinear(ctx, { api_key: 'lin_abc' });
    expect(ctx.client.sources.connectLinear).toHaveBeenCalled();
  });

  it('addUserMcpSource -> sources.registerUserMcp', async () => {
    const ctx = makeCtx();
    await addUserMcpSource(ctx, {
      name: 'my-mcp',
      base_url: 'https://mcp.example',
      auth_kind: 'none',
    });
    expect(ctx.client.sources.registerUserMcp).toHaveBeenCalled();
  });

  it('testUserMcpSource -> sources.testUserMcp', async () => {
    const ctx = makeCtx();
    await testUserMcpSource(ctx, { data_source_id: 'ds-mcp-1' });
    expect(ctx.client.sources.testUserMcp).toHaveBeenCalled();
  });

  it('revokeUserMcpSource -> sources.revokeUserMcp', async () => {
    const ctx = makeCtx();
    await revokeUserMcpSource(ctx, { data_source_id: 'ds-mcp-1' });
    expect(ctx.client.sources.revokeUserMcp).toHaveBeenCalled();
  });

  it('createAgent -> agents.create', async () => {
    const ctx = makeCtx();
    await createAgent(ctx, { slug: 'new-bot', name: 'New', system_prompt: 'help' });
    expect(ctx.client.agents.create).toHaveBeenCalled();
  });

  it('listAgents -> agents.list', async () => {
    const ctx = makeCtx();
    await listAgents(ctx, {});
    expect(ctx.client.agents.list).toHaveBeenCalled();
  });

  it('getAgent -> agents.retrieve', async () => {
    const ctx = makeCtx();
    await getAgent(ctx, { slug: 'bot' });
    expect(ctx.client.agents.retrieve).toHaveBeenCalled();
  });

  it('updateAgentPrompt -> agents.update', async () => {
    const ctx = makeCtx();
    await updateAgentPrompt(ctx, { agent_slug: 'bot', system_prompt: 'new' });
    expect(ctx.client.agents.update).toHaveBeenCalled();
  });

  it('updateAgentTools -> agents.update', async () => {
    const ctx = makeCtx();
    await updateAgentTools(ctx, { agent_slug: 'bot', tool_allowlist: ['discover'] });
    expect(ctx.client.agents.update).toHaveBeenCalled();
  });

  it('updateAgentToolSources -> agents.updateToolSources', async () => {
    const ctx = makeCtx();
    await updateAgentToolSources(ctx, { agent_slug: 'bot', tool_sources: ['slack'] });
    expect(ctx.client.agents.updateToolSources).toHaveBeenCalled();
  });

  it('updateAgentModelSettings -> agents.updateModelSettings', async () => {
    const ctx = makeCtx();
    await updateAgentModelSettings(ctx, {
      agent_slug: 'bot', backend: 'anthropic', model: 'claude-opus-4-7',
    });
    expect(ctx.client.agents.updateModelSettings).toHaveBeenCalled();
  });

  it('wireIntegrationToAgent -> agents.wireIntegration', async () => {
    const ctx = makeCtx();
    await wireIntegrationToAgent(ctx, { agent_slug: 'bot', app_slug: 'slack' });
    expect(ctx.client.agents.wireIntegration).toHaveBeenCalled();
  });

  it('listAgentTools -> agents.listTools', async () => {
    const ctx = makeCtx();
    await listAgentTools(ctx, {});
    expect(ctx.client.agents.listTools).toHaveBeenCalledWith('sb-1');
  });

  it('listRuns -> agents.listRuns', async () => {
    const ctx = makeCtx();
    await listRuns(ctx, { agent_slug: 'bot', limit: 5 });
    expect(ctx.client.agents.listRuns).toHaveBeenCalled();
  });

  it('getRunTrace -> agents.getRun', async () => {
    const ctx = makeCtx();
    await getRunTrace(ctx, { run_id: 'run-1' });
    expect(ctx.client.agents.getRun).toHaveBeenCalled();
  });

  it('listTriggerComponents -> agents.listTriggerComponents', async () => {
    const ctx = makeCtx();
    await listTriggerComponents(ctx, { app: 'slack' });
    expect(ctx.client.agents.listTriggerComponents).toHaveBeenCalled();
  });

  it('createTrigger -> agents.triggers.create', async () => {
    const ctx = makeCtx();
    await createTrigger(ctx, {
      agent_slug: 'bot',
      data_source_id: 'ds-1',
      event_type_filter: '*',
    });
    expect(ctx.client.agents.triggers.create).toHaveBeenCalled();
  });

  it('listTriggers -> agents.triggers.list', async () => {
    const ctx = makeCtx();
    await listTriggers(ctx, { agent_slug: 'bot' });
    expect(ctx.client.agents.triggers.list).toHaveBeenCalled();
  });

  it('pauseTrigger -> agents.triggers.updateById', async () => {
    const ctx = makeCtx();
    await pauseTrigger(ctx, { trigger_id: 'trg-1' });
    expect(ctx.client.agents.triggers.updateById).toHaveBeenCalled();
  });

  it('resumeTrigger -> agents.triggers.updateById', async () => {
    const ctx = makeCtx();
    await resumeTrigger(ctx, { trigger_id: 'trg-1' });
    expect(ctx.client.agents.triggers.updateById).toHaveBeenCalled();
  });

  it('updateTrigger -> agents.triggers.updateById', async () => {
    const ctx = makeCtx();
    await updateTrigger(ctx, { trigger_id: 'trg-1', status: 'active' });
    expect(ctx.client.agents.triggers.updateById).toHaveBeenCalled();
  });
});
