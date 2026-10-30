/** Check each compiler face independently so Host and Client service types stay separate. */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const compiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
for (const config of ['tsconfig.host.json', 'tsconfig.client.json']) {
  const result = spawnSync(process.execPath, [compiler, '-p', config, '--noEmit'], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
