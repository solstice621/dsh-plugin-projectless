/** Menu actions must keep the no-workspace sentinel out of Workspace operations. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { ADD, NONE, menuAction, workspaceChoices } from '../src/menu-model.ts'
import { en, zh } from '../src/locales.ts'

function workspace(id: string, title: string, path: string): WorkspaceView {
  return { workspaceId: id as WorkspaceId, title, path, sessionIds: [], createdAt: '', updatedAt: '' }
}

test('the no-workspace action has its own identity and stale Workspace choices are refused', () => {
  const items = [workspace('real-project', 'Project', '/fixture/project')]
  assert.deepEqual(menuAction(NONE, items), { kind: 'none' })
  assert.deepEqual(menuAction(ADD, items), { kind: 'add' })
  assert.deepEqual(menuAction('real-project', items), { kind: 'workspace', id: 'real-project' })
  assert.equal(menuAction('removed-project', items), undefined)
  assert.equal(menuAction('real-project', []), undefined)
  assert.equal(zh.none, '不在项目中工作')
  assert.equal(en.none, 'No workspace')
  assert.equal(items.length, 1)
})

test('the picker preserves Workspace ordering and distinguishes duplicate localized titles without mutating the registry', () => {
  const items = Object.freeze([
    Object.freeze(workspace('second', 'Same', '/fixture/two')),
    Object.freeze(workspace('first', 'Same', '/fixture/one')),
    Object.freeze(workspace('default', 'Default token', '/fixture/default')),
  ])
  const rows = workspaceChoices(items, title => title === 'Default token' ? '默认工作区' : title)
  assert.deepEqual(rows, [
    { id: 'second', label: 'Same · /fixture/two', path: '/fixture/two' },
    { id: 'first', label: 'Same · /fixture/one', path: '/fixture/one' },
    { id: 'default', label: '默认工作区', path: '/fixture/default' },
  ])
  assert.equal(items[2].title, 'Default token')
  assert.equal(rows.some(row => String(row.id) === NONE), false)
})
