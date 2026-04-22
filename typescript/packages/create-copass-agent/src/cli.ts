#!/usr/bin/env node
import { cp, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const USAGE = `Usage: npx create-copass-agent <project-name>

Scaffolds a Hono + Claude Agent SDK + @copass/mcp agent with an embedded
chat UI. If you've already run \`copass login\` and \`copass setup\`, the
generated .env is auto-populated from your CLI config and nearby refs.json.`;

function slugify(input: string): string {
  return input
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

interface AutoPopulateResult {
  found: {
    sandboxId: boolean;
    projectId: boolean;
    apiUrl: boolean;
  };
}

/**
 * Best-effort populate `.env` from the Copass CLI's stored state.
 * - nearest ancestor `.olane/refs.json` → `sandbox_id`, `project_id`
 * - `~/.olane/config.json` → `api_url` (if the user is on a non-default host)
 *
 * `COPASS_API_KEY` is NEVER auto-populated. The user creates one explicitly
 * with `copass apikey create --name <name>` (the key is shown once, printed
 * to stdout, and they paste it into `.env`). Reading the CLI's session
 * `access_token` as the API key is wrong — it's a short-lived Supabase JWT,
 * not the long-lived `olk_...` credential the SDK expects.
 *
 * `ANTHROPIC_API_KEY` is always left blank — the user must supply it.
 * Missing values are left as placeholders so the file is always usable.
 */
async function autoPopulateEnv(dest: string): Promise<AutoPopulateResult> {
  let apiUrl: string | null = null;
  let sandboxId: string | null = null;
  let projectId: string | null = null;

  const cliConfigPath = join(homedir(), '.olane', 'config.json');
  if (existsSync(cliConfigPath)) {
    try {
      const raw = JSON.parse(await readFile(cliConfigPath, 'utf8'));
      if (typeof raw?.api_url === 'string' && raw.api_url.length > 0) {
        apiUrl = raw.api_url;
      }
    } catch {
      /* config unreadable — leave placeholders */
    }
  }

  // Walk up from the scaffold dir looking for .olane/refs.json.
  // `copass setup` writes refs into the project root where the dev ran it.
  let cursor = dirname(dest);
  const root = resolve('/');
  while (cursor && cursor !== root) {
    const refsPath = join(cursor, '.olane', 'refs.json');
    if (existsSync(refsPath)) {
      try {
        const refs = JSON.parse(await readFile(refsPath, 'utf8'));
        if (typeof refs?.sandbox_id === 'string') sandboxId = refs.sandbox_id;
        if (typeof refs?.project_id === 'string') projectId = refs.project_id;
      } catch {
        /* continue walking */
      }
      if (sandboxId) break;
    }
    cursor = dirname(cursor);
  }

  const lines: string[] = [];
  lines.push('# Copass — required');
  lines.push(
    '# Create a long-lived key (shown once):  copass apikey create --name my-app',
  );
  lines.push('COPASS_API_KEY=');
  lines.push(
    sandboxId
      ? `COPASS_SANDBOX_ID=${sandboxId}`
      : 'COPASS_SANDBOX_ID=  # from .olane/refs.json (run `copass setup`)',
  );
  lines.push('');
  lines.push('# Copass — optional');
  if (apiUrl) lines.push(`COPASS_API_URL=${apiUrl}`);
  else lines.push('# COPASS_API_URL=https://ai.copass.id');
  if (projectId) lines.push(`COPASS_PROJECT_ID=${projectId}`);
  else lines.push('# COPASS_PROJECT_ID=proj_...');
  lines.push('');
  lines.push('# Anthropic (Claude) — required for the agent loop');
  lines.push('ANTHROPIC_API_KEY=  # from https://console.anthropic.com');
  lines.push('');
  lines.push('# Server');
  lines.push('PORT=3000');
  lines.push('');

  await writeFile(join(dest, '.env'), lines.join('\n'));

  return {
    found: {
      sandboxId: Boolean(sandboxId),
      projectId: Boolean(projectId),
      apiUrl: Boolean(apiUrl),
    },
  };
}

async function main(): Promise<void> {
  const [nameArg, ...rest] = process.argv.slice(2);

  if (!nameArg || nameArg === '--help' || nameArg === '-h' || rest.length > 0) {
    process.stdout.write(USAGE + '\n');
    process.exit(nameArg === '--help' || nameArg === '-h' ? 0 : 1);
  }

  const pkgName = slugify(nameArg);
  if (!pkgName) {
    process.stderr.write(`Error: "${nameArg}" is not a valid project name.\n`);
    process.exit(1);
  }

  const dest = resolve(process.cwd(), nameArg);

  if (existsSync(dest)) {
    process.stderr.write(`Error: directory "${nameArg}" already exists.\n`);
    process.exit(1);
  }

  const here = fileURLToPath(new URL('.', import.meta.url));
  const templateDir = resolve(here, '..', 'template');

  if (!existsSync(templateDir)) {
    process.stderr.write(
      `Error: template dir not found at ${templateDir}. This is an installation issue.\n`,
    );
    process.exit(1);
  }

  process.stdout.write(`Creating ${pkgName} in ${dest}...\n`);
  await cp(templateDir, dest, { recursive: true });

  const gitignoreSrc = join(dest, 'gitignore');
  const gitignoreDst = join(dest, '.gitignore');
  if (existsSync(gitignoreSrc)) {
    await rename(gitignoreSrc, gitignoreDst);
  }

  const pkgPath = join(dest, 'package.json');
  const pkgJson = await readFile(pkgPath, 'utf8');
  await writeFile(pkgPath, pkgJson.replace('PLACEHOLDER_NAME', pkgName));

  const { found } = await autoPopulateEnv(dest);

  const populated: string[] = [];
  if (found.sandboxId) populated.push('COPASS_SANDBOX_ID');
  if (found.projectId) populated.push('COPASS_PROJECT_ID');

  process.stdout.write('\n');
  if (populated.length > 0) {
    process.stdout.write(`Auto-populated from .olane/refs.json: ${populated.join(', ')}\n`);
  } else {
    process.stdout.write(
      'No .olane/refs.json found in a parent directory. Run `copass setup` to create one.\n',
    );
  }
  process.stdout.write('\nNext steps:\n');
  process.stdout.write(`  cd ${nameArg}\n`);
  process.stdout.write('  # Two secrets still need to go into .env by hand:\n');
  process.stdout.write('  #   COPASS_API_KEY    — run `copass apikey create --name my-app` (shown once)\n');
  process.stdout.write('  #   ANTHROPIC_API_KEY — https://console.anthropic.com\n');
  process.stdout.write('  pnpm install     # or npm install\n');
  process.stdout.write('  pnpm dev         # then open http://localhost:3000\n');
}

main().catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
