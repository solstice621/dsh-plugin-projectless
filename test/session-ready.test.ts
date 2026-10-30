import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ISessions, SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { sessionReady } from '../src/session-ready.ts'

const id = 'projectless-fixture' as SessionId
const cwd = '/fixture/chat'
const summary: SessionSummary = { id, cwd, displayTitle: 'Fixture', blank: true, retainedBy: {}, running: false, updatedAt: 0 }
function catalog(initial?: SessionSummary) {
  let row = initial
  let refreshes = 0
  const listeners = new Set<() => void>()
  const sessions: Pick<ISessions, 'list' | 'refresh'> = {
    list: {
      getSnapshot: () => ({ ids: row ? [id] : [], byId: row ? { [id]: row } : {}, phase: 'ready', projectionsBySession: {} }) as SessionListState,
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    refresh: async () => { refreshes++; row = summary },
  }
  return { sessions, publish: (next: SessionSummary) => { row = next; for (const listener of listeners) listener() },
    refreshes: () => refreshes, subscribers: () => listeners.size }
}

test('an already-announced Session opens without a full history-list request', async () => {
  const fixture = catalog(summary)
  assert.equal(await sessionReady(fixture.sessions, id, cwd, new AbortController().signal), summary)
  assert.equal(fixture.refreshes(), 0)
  assert.equal(fixture.subscribers(), 0)
})

test('a late live announcement wins without a refresh and releases the observer', async () => {
  const fixture = catalog()
  const ready = sessionReady(fixture.sessions, id, cwd, new AbortController().signal)
  assert.equal(fixture.subscribers(), 1)
  fixture.publish(summary)
  assert.equal(await ready, summary)
  assert.equal(fixture.refreshes(), 0)
  assert.equal(fixture.subscribers(), 0)
})

test('a missing announcement recovers with one authoritative refresh', async () => {
  const fixture = catalog()
  assert.equal(await sessionReady(fixture.sessions, id, cwd, new AbortController().signal, 1), summary)
  assert.equal(fixture.refreshes(), 1)
  assert.equal(fixture.subscribers(), 0)
})

test('cancellation stops the live-event wait without refreshing or keeping a listener', async () => {
  const fixture = catalog()
  const abort = new AbortController()
  const ready = sessionReady(fixture.sessions, id, cwd, abort.signal)
  abort.abort(new Error('selection disposed'))
  await assert.rejects(ready, /selection disposed/)
  assert.equal(fixture.refreshes(), 0)
  assert.equal(fixture.subscribers(), 0)
})

test('mismatched cwd and an absent recovery row cannot be opened', async () => {
  await assert.rejects(sessionReady(catalog({ ...summary, cwd: '/wrong' }).sessions, id, cwd, new AbortController().signal), /not listed/)
  const fixture = catalog()
  fixture.sessions.refresh = async () => {}
  await assert.rejects(sessionReady(fixture.sessions, id, cwd, new AbortController().signal, 1), /not listed/)
})
