/** Exercise the published manifest with Harness's own compatibility evaluator. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

test('DSH accepts supported 0.2 releases and later 0.2 prereleases without version exemptions', () => {
  for (const version of ['0.2.1-rc.3', '0.2.1-rc.5', '0.2.1-rc.6', '0.2.1', '0.2.2-alpha.2', '0.2.2', '0.2.99']) {
    assert.equal(evaluatePluginCompatibility(manifest, {}, version), undefined, version)
  }
})

test('the declaration rejects older APIs and the next minor including its prereleases', () => {
  for (const version of ['0.2.0', '0.2.1-alpha.99', '0.2.1-rc.2', '0.3.0-0', '0.3.0-alpha.1', '0.3.0', '1.0.0']) {
    const issue = evaluatePluginCompatibility(manifest, {}, version)
    assert.ok(issue, version)
    assert.equal(issue.exempted, false)
    assert.deepEqual(issue.requirements, { 'engines.dsh': manifest.engines.dsh })
  }
})

test('exact development pins cannot narrow the independently declared runtime range', () => {
  const dshPackages = Object.keys(manifest.peerDependencies).filter(name => name.startsWith('@deepseek-ai/dsh-'))
  const developmentPeers = Object.fromEntries(dshPackages.map(name => [name, manifest.devDependencies[name]]))
  assert.equal(evaluatePluginCompatibility({ ...manifest, peerDependencies: developmentPeers }, {}, '0.2.1-rc.6'), undefined)
  for (const name of dshPackages) assert.equal(manifest.peerDependencies[name], manifest.engines.dsh)
})
