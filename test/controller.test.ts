/** Client lifecycle and retry behavior without an API key or browser transport. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ProjectlessController } from '../src/controller.ts'
import { CHANNEL, ENDPOINT } from '../src/protocol.ts'

function success(): ConnectionRpcResult<unknown> {
  return { ok: true, value: {
    sessionId: 'fixture-session', cwd: '/fixture/chat',
    workDirectory: '/fixture/chat/work', outputDirectory: '/fixture/chat/outputs',
  } }
}

test('rapid clicks share one action and open only the created Session', async () => {
  const response = Promise.withResolvers<ConnectionRpcResult<unknown>>()
  const opened: SessionId[] = []
  let calls = 0
  const controller = new ProjectlessController({ call: async (channel, endpoint, payload) => {
    calls += 1
    assert.equal(channel, CHANNEL)
    assert.equal(endpoint, ENDPOINT)
    assert.equal(typeof payload, 'object')
    assert.deepEqual(Object.keys(payload as object), ['requestId'])
    return response.promise
  } }, id => { opened.push(id) })
  const first = controller.start()
  const second = controller.start()
  assert.equal(first, second)
  assert.equal(calls, 1)
  assert.equal(controller.getSnapshot().phase, 'busy')
  assert.deepEqual(opened, [])
  response.resolve(success())
  await first
  assert.deepEqual(opened, ['fixture-session'])
  assert.equal(controller.getSnapshot().phase, 'idle')
  controller.dispose()
})

test('a lost transport response retains its action identity for a safe retry', async () => {
  const payloads: unknown[] = []
  let count = 0
  const controller = new ProjectlessController({ call: async (_channel, _endpoint, payload) => {
    payloads.push(payload)
    count += 1
    if (count === 1) throw new Error('connection reset after Host creation')
    return success()
  } }, () => {})
  await controller.start()
  assert.equal(controller.getSnapshot().phase, 'error')
  await controller.start()
  assert.deepEqual(payloads[0], payloads[1])
  assert.equal(controller.getSnapshot().phase, 'idle')
  controller.dispose()
})

test('a definite Host refusal gets a fresh action after the operator repairs it', async () => {
  const payloads: unknown[] = []
  const controller = new ProjectlessController({ call: async (_channel, _endpoint, payload) => {
    payloads.push(payload)
    return payloads.length === 1
      ? { ok: false, error: { code: 'projectless/directory', message: 'fixture root blocked', details: {} } }
      : success()
  } }, () => {})
  await controller.start()
  const failed = controller.getSnapshot()
  assert.equal(failed.phase, 'error')
  if (failed.phase !== 'error') assert.fail('failure not shown')
  assert.equal(failed.failure.code, 'projectless/directory')
  await controller.start()
  assert.notDeepEqual(payloads[0], payloads[1])
  controller.dispose()
})

test('unloading while a reply is pending prevents late navigation and notifications', async () => {
  const response = Promise.withResolvers<ConnectionRpcResult<unknown>>()
  let notifications = 0
  let opened = false
  const controller = new ProjectlessController({ call: async () => response.promise }, () => { opened = true })
  controller.subscribe(() => { notifications += 1 })
  const pending = controller.start()
  assert.equal(notifications, 1)
  controller.dispose()
  response.resolve(success())
  await pending
  assert.equal(opened, false)
  assert.equal(notifications, 1)
})

test('invalid Host values never reach Session navigation', async () => {
  let opened = false
  const controller = new ProjectlessController({ call: async () => ({ ok: true, value: { sessionId: 'missing-directories' } }) },
    () => { opened = true })
  await controller.start()
  assert.equal(opened, false)
  const state = controller.getSnapshot()
  assert.equal(state.phase, 'error')
  if (state.phase !== 'error') assert.fail('invalid response not shown')
  assert.equal(state.failure.code, 'projectless/invalid-response')
  controller.dispose()
})

test('retrying asynchronous navigation failure reopens the saved Session without creating another', async () => {
  let calls = 0
  let attempts = 0
  const controller = new ProjectlessController({ call: async () => { calls += 1; return success() } }, async () => {
    attempts += 1
    if (attempts === 1) throw new Error('view temporarily unavailable')
  })
  await controller.start()
  assert.equal(controller.getSnapshot().phase, 'error')
  await controller.start()
  assert.equal(calls, 1)
  assert.equal(attempts, 2)
  assert.equal(controller.getSnapshot().phase, 'idle')
  controller.dispose()
})
