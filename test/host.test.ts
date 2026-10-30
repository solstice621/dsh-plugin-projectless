/** Keyless Host behavior: real directories, normal Session requests, and owned RPC lifetime. */
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import { afterEach, test } from 'node:test'
import { access, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PeerId, PeerScope, Principal } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionCreateValue } from '@deepseek-ai/dsh-api-session-controller/types'
import { createFetchRoute, createHandler, createProjectlessChat, type CreateSession } from '../src/host.ts'
import { CHANNEL, ENDPOINT, parseChat } from '../src/protocol.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap {
    fixtureViewer: { readonly kind: 'fixture-viewer' }
  }
}

const fixtures: string[] = []
afterEach(async () => {
  for (const path of fixtures.splice(0)) await rm(path, { recursive: true, force: true })
})
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-projectless-host-'))
  fixtures.push(root)
  return join(root, 'Chats')
}
function peer(principal: Principal = { kind: 'owner' }): PeerScope {
  const abort = new AbortController()
  return {
    id: 'fixture-peer' as PeerId, ctx: new Context(), principal,
    signal: abort.signal, interactions: 'none', dispose: async () => { abort.abort() },
  }
}
function sessionValue(id = 'fixture-session'): SessionCreateValue {
  return { sessionId: id as SessionId }
}
function actionId(): string { return globalThis.crypto.randomUUID() }
function signal(): AbortSignal { return new AbortController().signal }

function rpcRequest(body: unknown, contentType = 'application/json'): Request {
  return new Request('http://fixture' + CHANNEL + '/' + ENDPOINT, {
    method: 'POST', headers: { 'content-type': contentType }, body: JSON.stringify(body),
  })
}

test('the real shared Connection route rejects non-owners, preserves RPC identity, and removes its contribution', async () => {
  const ctx = new Context()
  // Authentication happens before shared dispatch; this test supplies admitted Peers.
  const connection = new HostConnectionService(ctx, [], {} as never)
  let called = 0
  const handle: ConnectionRpcHandler = async (endpoint, payload, _signal, owner) => {
    assert.equal(endpoint, 'create')
    assert.equal(owner.principal.kind, 'owner')
    called++
    return { ok: true, value: payload }
  }
  const route = createFetchRoute(handle, connection.browserPeer)
  const remove = connection.fetch.register(route)
  const shared = connection.createSharedFetchHandler('/api')
  const body = { type: 'client-request', rpcId: actionId(), method: ENDPOINT, payload: { requestId: actionId() } }
  try {
    const guest = connection.createPeer({ principal: { kind: 'fixture-viewer' } })
    const denied = await shared.fetch(rpcRequest(body), guest)
    assert.equal(denied.status, 403)
    assert.equal(called, 0)
    const response = await shared.fetch(rpcRequest(body), connection.browserPeer)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { type: 'server-response', rpcId: body.rpcId,
      result: { ok: true, value: body.payload } })
    assert.equal(called, 1)
    await remove()
    assert.equal((await shared.fetch(rpcRequest(body), connection.browserPeer)).status, 404)
    assert.equal(called, 1)
  } finally {
    await remove()
    await ctx.fiber.dispose()
  }
})

test('malformed JSON, wrong media types, invalid envelopes, and mismatched methods never create a Session', async () => {
  const route = createFetchRoute(async () => { assert.fail('invalid transport input reached creation') }, peer())
  const valid = { type: 'client-request', rpcId: actionId(), method: ENDPOINT, payload: { requestId: actionId() } }
  assert.equal((await route.fetch(rpcRequest(valid, 'text/plain'))).status, 415)
  assert.equal((await route.fetch(new Request('http://fixture' + route.path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
  }))).status, 400)
  assert.equal((await route.fetch(rpcRequest({ ...valid, rpcId: 123 }))).status, 400)
  const response = await route.fetch(rpcRequest({ ...valid, method: 'another/create' }))
  assert.equal(response.status, 200)
  const envelope = await response.json()
  assert.equal(envelope.rpcId, valid.rpcId)
  assert.equal(envelope.result.error.code, 'projectless/invalid-request')
})

test('Session creation receives only the allocated cwd and no project or prompt', async () => {
  const root = await fixture()
  let seenCwd: string | undefined
  const chat = await createProjectlessChat(root, async request => {
    assert.deepEqual(Object.keys(request), ['cwd'])
    seenCwd = request.cwd
    return sessionValue()
  }, signal())
  assert.equal(chat.cwd, seenCwd)
  assert.equal(chat.sessionId, 'fixture-session')
  await access(chat.cwd)
})

test('Session refusal preserves its allocated directory instead of deleting possible user files', async () => {
  const root = await fixture()
  let directory: string | undefined
  await assert.rejects(createProjectlessChat(root, async request => {
    directory = request.cwd
    throw new Error('session fixture refused')
  }, signal()), /session fixture refused/)
  assert.notEqual(directory, undefined)
  await access(directory!)
})

test('a request cancelled before allocation creates no directory or Session', async () => {
  const root = await fixture()
  const abort = new AbortController()
  abort.abort(new Error('caller cancelled'))
  await assert.rejects(createProjectlessChat(root, async () => {
    assert.fail('cancelled request reached Session creation')
  }, abort.signal), /caller cancelled/)
  await assert.rejects(access(root))
})

test('concurrent transport retries and later replays return one original Session', async () => {
  const root = await fixture()
  let count = 0
  const operations = createHandler({ workspaceRoot: root, maxCachedRequests: 4 }, async () => {
    count += 1
    return sessionValue('session-' + count)
  }, new AbortController())
  const payload = { requestId: actionId() }
  const owner = peer()
  const results = await Promise.all(Array.from({ length: 12 }, () => operations.handle('create', payload, signal(), owner)))
  assert.equal(count, 1)
  assert.ok(results.every(result => result.ok))
  const successful = results[0]!
  assert.equal(successful.ok, true)
  if (!successful.ok) assert.fail('creation refused')
  const replay = await operations.handle('create', payload, signal(), owner)
  assert.deepEqual(replay, successful)
  assert.equal(count, 1)
  const chat = parseChat(successful.value)
  const dates = await readdir(root)
  assert.equal((await readdir(join(root, dates[0]!))).length, 1)
  await operations.dispose()
  await access(chat.cwd)
})

test('wire callers cannot choose cwd or claim owner privileges', async () => {
  const root = await fixture()
  const operations = createHandler({ workspaceRoot: root, maxCachedRequests: 4 }, async () => {
    assert.fail('invalid request reached Session creation')
  }, new AbortController())
  const invalid = await operations.handle('create', { requestId: actionId(), cwd: '/' }, signal(), peer())
  assert.equal(invalid.ok, false)
  if (invalid.ok) assert.fail('invalid request accepted')
  assert.equal(invalid.error.code, 'projectless/invalid-request')
  const forbidden = await operations.handle('create', { requestId: actionId() }, signal(), peer({ kind: 'fixture-viewer' }))
  assert.equal(forbidden.ok, false)
  if (forbidden.ok) assert.fail('viewer request accepted')
  assert.equal(forbidden.error.code, 'projectless/forbidden')
  await assert.rejects(access(root))
  await operations.dispose()
})

test('a failed creation can be retried after its cause is repaired', async () => {
  const root = await fixture()
  let count = 0
  const create: CreateSession = async () => {
    count += 1
    if (count === 1) throw new Error('temporary Session failure')
    return sessionValue()
  }
  const operations = createHandler({ workspaceRoot: root, maxCachedRequests: 2 }, create, new AbortController())
  const payload = { requestId: actionId() }
  const first = await operations.handle('create', payload, signal(), peer())
  assert.equal(first.ok, false)
  const second = await operations.handle('create', payload, signal(), peer())
  assert.equal(second.ok, true)
  assert.equal(count, 2)
  await operations.dispose()
})

test('cache capacity rejects extra concurrent work and reclaims settled entries', async () => {
  const root = await fixture()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<SessionCreateValue>()
  let count = 0
  const operations = createHandler({ workspaceRoot: root, maxCachedRequests: 1 }, async () => {
    count += 1
    if (count === 1) { entered.resolve(); return release.promise }
    return sessionValue('next-session')
  }, new AbortController())
  const first = operations.handle('create', { requestId: actionId() }, signal(), peer())
  await entered.promise
  const second = await operations.handle('create', { requestId: actionId() }, signal(), peer())
  assert.equal(second.ok, false)
  if (second.ok) assert.fail('capacity was not enforced')
  assert.equal(second.error.code, 'projectless/busy')
  release.resolve(sessionValue())
  await first
  const next = await operations.handle('create', { requestId: actionId() }, signal(), peer())
  assert.equal(next.ok, true)
  assert.equal(count, 2)
  await operations.dispose()
})

test('unloading drains Session creation that has already begun, then refuses new work', async () => {
  const root = await fixture()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<SessionCreateValue>()
  const operations = createHandler({ workspaceRoot: root, maxCachedRequests: 2 }, async () => {
    entered.resolve()
    return release.promise
  }, new AbortController())
  const request = operations.handle('create', { requestId: actionId() }, signal(), peer())
  await entered.promise
  let finished = false
  const disposed = operations.dispose().then(() => { finished = true })
  await Promise.resolve()
  assert.equal(finished, false)
  release.resolve(sessionValue())
  const result = await request
  await disposed
  assert.equal(result.ok, true)
  const refused = await operations.handle('create', { requestId: actionId() }, signal(), peer())
  assert.equal(refused.ok, false)
})
