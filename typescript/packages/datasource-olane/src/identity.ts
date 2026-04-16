import { ConfigManager } from '@olane/os';

/**
 * Read the Copass ID persisted alongside an OS instance config.
 *
 * Returns `null` if either the instance or the `copassId` field is missing.
 */
export async function getInstanceCopassId(instanceName: string): Promise<string | null> {
  const config = await ConfigManager.getOSConfig(instanceName);
  if (!config?.copassId) return null;
  return config.copassId as string;
}

/**
 * Attach a Copass ID to an existing OS instance config.
 *
 * Returns `false` if the instance has not been started yet (no config exists).
 * The caller decides how to surface that to the user.
 */
export async function setInstanceCopassId(
  instanceName: string,
  copassId: string,
): Promise<boolean> {
  const config = await ConfigManager.getOSConfig(instanceName);
  if (!config) return false;
  await ConfigManager.updateOSConfig({ ...config, copassId });
  return true;
}
