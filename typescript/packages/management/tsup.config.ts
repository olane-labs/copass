import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/adapters/mcp.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  target: 'es2022',
  external: ['@copass/core', '@modelcontextprotocol/sdk', 'zod'],
  // Inject `__dirname` / `__filename` shims into both ESM and CJS
  // bundles so `specs.ts` can resolve its bundled `dist/specs/v1/` dir
  // from a single uniform `__dirname` reference. Without this, esbuild
  // emits `Function("return import.meta.url")()` in the CJS bundle as a
  // "dual-format compatibility" trick — that pattern throws on Node
  // ≥22.10 ("Cannot use 'import.meta' outside a module") whenever an
  // ESM consumer reaches it (e.g. `copass mcp` invoking `@copass/mcp`).
  shims: true,
});
