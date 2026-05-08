import type { ToolHandler } from '../registrar.js';
import { addUserMcpSource } from './add_user_mcp_source.js';
import { connectLinear } from './connect_linear.js';
import { createAgent } from './create_agent.js';
import { createTrigger } from './create_trigger.js';
import { getAgent } from './get_agent.js';
import { getRunTrace } from './get_run_trace.js';
import { getSource } from './get_source.js';
import { grantSandboxConnection } from './grant_sandbox_connection.js';
import { listAgentTools } from './list_agent_tools.js';
import { listAgents } from './list_agents.js';
import { listApiKeys } from './list_api_keys.js';
import { listApps } from './list_apps.js';
import { listConnectedAccounts } from './list_connected_accounts.js';
import { listRuns } from './list_runs.js';
import { listSandboxConnections } from './list_sandbox_connections.js';
import { listSandboxes } from './list_sandboxes.js';
import { listSources } from './list_sources.js';
import { listTriggerComponents } from './list_trigger_components.js';
import { listTriggers } from './list_triggers.js';
import { pauseTrigger } from './pause_trigger.js';
import { provisionSource } from './provision_source.js';
import { purgeSourceContext } from './purge_source_context.js';
import { resumeTrigger } from './resume_trigger.js';
import { revokeSandboxConnection } from './revoke_sandbox_connection.js';
import { revokeUserMcpSource } from './revoke_user_mcp_source.js';
import { startIntegrationConnect } from './start_integration_connect.js';
import { testUserMcpSource } from './test_user_mcp_source.js';
import { updateAgentModelSettings } from './update_agent_model_settings.js';
import { updateAgentPrompt } from './update_agent_prompt.js';
import { updateAgentToolSources } from './update_agent_tool_sources.js';
import { updateAgentTools } from './update_agent_tools.js';
import { updateSource } from './update_source.js';
import { updateTrigger } from './update_trigger.js';
import { wireIntegrationToAgent } from './wire_integration_to_agent.js';

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  list_sandboxes: listSandboxes,
  list_sources: listSources,
  get_source: getSource,
  list_agents: listAgents,
  get_agent: getAgent,
  list_triggers: listTriggers,
  list_runs: listRuns,
  get_run_trace: getRunTrace,
  list_trigger_components: listTriggerComponents,
  list_apps: listApps,
  list_connected_accounts: listConnectedAccounts,
  list_api_keys: listApiKeys,
  list_agent_tools: listAgentTools,
  list_sandbox_connections: listSandboxConnections,
  create_agent: createAgent,
  update_agent_prompt: updateAgentPrompt,
  update_agent_tools: updateAgentTools,
  update_agent_tool_sources: updateAgentToolSources,
  update_agent_model_settings: updateAgentModelSettings,
  add_user_mcp_source: addUserMcpSource,
  wire_integration_to_agent: wireIntegrationToAgent,
  provision_source: provisionSource,
  purge_source_context: purgeSourceContext,
  update_source: updateSource,
  start_integration_connect: startIntegrationConnect,
  connect_linear: connectLinear,
  test_user_mcp_source: testUserMcpSource,
  revoke_user_mcp_source: revokeUserMcpSource,
  create_trigger: createTrigger,
  pause_trigger: pauseTrigger,
  resume_trigger: resumeTrigger,
  update_trigger: updateTrigger,
  grant_sandbox_connection: grantSandboxConnection,
  revoke_sandbox_connection: revokeSandboxConnection,
};

export {
  addUserMcpSource,
  connectLinear,
  createAgent,
  createTrigger,
  getAgent,
  getRunTrace,
  getSource,
  grantSandboxConnection,
  listAgentTools,
  listAgents,
  listApiKeys,
  listApps,
  listConnectedAccounts,
  listRuns,
  listSandboxConnections,
  listSandboxes,
  listSources,
  listTriggerComponents,
  listTriggers,
  pauseTrigger,
  provisionSource,
  purgeSourceContext,
  resumeTrigger,
  revokeSandboxConnection,
  revokeUserMcpSource,
  startIntegrationConnect,
  testUserMcpSource,
  updateAgentModelSettings,
  updateAgentPrompt,
  updateAgentToolSources,
  updateAgentTools,
  updateSource,
  updateTrigger,
  wireIntegrationToAgent,
};
