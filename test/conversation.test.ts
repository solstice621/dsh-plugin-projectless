/** Verify blank-chat eligibility and renderer lifetime across rapid navigation. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { needsProjectlessComposer, ProjectlessPresentation } from '../src/presentation.ts'

const id = 'projectless-fixture' as SessionId

function row(changes: Partial<SessionSummary> = {}): SessionSummary {
  return { id, displayTitle: 'Fixture', cwd: '/fixture/chat', blank: true,
    retainedBy: { mainView: 1 }, running: false, updatedAt: 0, ...changes }
}

function sessionState(session: SessionSummary): SessionListState {
  return { ids: [id], byId: { [id]: session }, phase: 'ready', projectionsBySession: {} }
}

function workspaceState(changes: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return { items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle',
    phase: 'ready', error: null, ...changes }
}

function observable<T>(initial: T) {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next: T) => { state = next; for (const listener of Array.from(listeners)) listener() },
    subscribers: () => listeners.size,
  }
}

test('only a selected ordinary blank chat outside a ready Workspace registry gets the editable renderer', () => {
  const blank = sessionState(row())
  assert.equal(needsProjectlessComposer(blank, workspaceState()), true)
  assert.equal(needsProjectlessComposer(blank, workspaceState({ phase: 'pending' })), false)
  const workspace: WorkspaceView = { workspaceId: 'fixture-workspace' as WorkspaceId,
    path: '/fixture/project', title: 'Project', sessionIds: [id], createdAt: '', updatedAt: '' }
  assert.equal(needsProjectlessComposer(blank, workspaceState({ items: [workspace] })), false)
  for (const changes of [{ blank: false }, { origin: 'subagent' as const }, { retainedBy: {} },
    { cwd: undefined }, { cwd: '' }]) {
    assert.equal(needsProjectlessComposer(sessionState(row(changes)), workspaceState()), false)
  }
  assert.equal(needsProjectlessComposer({ byId: {} }, workspaceState()), false)
})

test('rapid navigation waits for asynchronous slot removal before registering again, and unload releases observers', async () => {
  const sessions = observable(sessionState(row()))
  const workspaces = observable(workspaceState())
  const cleanupStarted = Promise.withResolvers<void>()
  const cleanupGate = Promise.withResolvers<void>()
  const errors: unknown[] = []
  let active = false
  let enabled = 0
  let removed = 0
  const presentation = new ProjectlessPresentation(sessions, workspaces, () => {
    assert.equal(active, false, 'The previous priority must be removed before registering another renderer')
    active = true
    enabled++
    return async () => {
      cleanupStarted.resolve()
      await cleanupGate.promise
      active = false
      removed++
    }
  }, error => { errors.push(error) })
  await presentation.sync()
  assert.equal(enabled, 1)
  sessions.set(sessionState(row({ blank: false })))
  await cleanupStarted.promise
  sessions.set(sessionState(row()))
  const returned = presentation.sync()
  await Promise.resolve()
  assert.equal(enabled, 1)
  cleanupGate.resolve()
  await returned
  assert.equal(enabled, 2)
  await Promise.all([presentation.dispose(), presentation.dispose()])
  assert.equal(removed, 2)
  assert.equal(active, false)
  assert.equal(sessions.subscribers(), 0)
  assert.equal(workspaces.subscribers(), 0)
  sessions.set(sessionState(row()))
  await presentation.sync()
  assert.equal(enabled, 2)
  assert.deepEqual(errors, [])
})
