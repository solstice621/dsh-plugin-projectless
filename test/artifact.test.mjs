/** The published browser entry follows Harness's lazy module-loader protocol. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import * as React from 'react'

test('loading the browser script only registers a factory; materialization exports a Cordis client plugin', async () => {
  const script = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const rows = []
  let required = 0
  runInNewContext(script, { window: { __ModuleLoader__: { load: row => { rows.push(row) } } } })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'dsh-plugin-projectless')
  assert.equal(required, 0)
  const plugin = rows[0].factory(name => {
    required += 1
    if (name === 'react') return React
    assert.equal(name, '@deepseek-ai/dsh-client-ui-primitives')
    return {}
  })
  assert.ok(required >= 1)
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(Array.from(plugin.inject), ['connection', 'slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace', 'uiConversation', 'conversation'])
})
