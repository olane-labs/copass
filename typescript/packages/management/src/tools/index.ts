import type { ToolHandler } from '../registrar.js';
import { addUserMcpSource } from './add_user_mcp_source.js';
import { createAgent } from './create_agent.js';
import { getAgent } from './get_agent.js';
import { getRunTrace } from './get_run_trace.js';
import { getSource } from './get_source.js';
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
import { updateAgentPrompt } from './update_agent_prompt.js';
import { updateAgentToolSources } from './update_agent_tool_sources.js';
import { updateAgentTools } from './update_agent_tools.js';
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
  add_user_mcp_source: addUserMcpSource,
  wire_integration_to_agent: wireIntegrationToAgent,
};

export {
  addUserMcpSource,
  createAgent,
  getAgent,
  getRunTrace,
  getSource,
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
  updateAgentPrompt,
  updateAgentToolSources,
  updateAgentTools,
  wireIntegrationToAgent,
};
