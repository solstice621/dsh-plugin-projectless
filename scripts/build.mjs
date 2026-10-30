/** Build the Node plugin and Harness's lazily registered browser factory. */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const compiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
await rm('lib', { recursive: true, force: true })
for (const config of ['tsconfig.host.json', 'tsconfig.client.json']) {
  const result = spawnSync(process.execPath, [compiler, '-p', config], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
await mkdir('lib', { recursive: true })
await build({
  entryPoints: ['src/host.ts'], outfile: 'lib/host.js', bundle: true,
  format: 'esm', platform: 'node', target: 'node24', packages: 'external',
  sourcemap: true, sourcesContent: true,
})
await build({
  entryPoints: ['src/client.ts'], outfile: 'lib/client.js', bundle: true,
  format: 'cjs', platform: 'browser', target: 'es2022', external: ['react', '@deepseek-ai/dsh-client-ui-primitives'],
  sourcemap: true, sourcesContent: true,
  banner: { js: 'window.__ModuleLoader__.load({ id: "dsh-plugin-projectless", factory: (require) => { var module = { exports: {} }; var exports = module.exports;' },
  footer: { js: 'return module.exports; } });' },
})
