/** Workspace-menu choices; the no-workspace choice is never a Workspace identity. */
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** Local action identity, never sent to Workspace APIs. */
export const NONE = 'projectless:none'
/** Local action opening the directory picker. */
export const ADD = 'projectless:add'

/** One real Workspace row, with enough path context to distinguish duplicate titles. */
export interface WorkspaceChoice {
  readonly id: WorkspaceId
  readonly label: string
  readonly path: string
}

/**
 * Preserve Host ordering and distinguish Workspaces that share a display name.
 * @param items - real Workspace records.
 * @param displayTitle - Harness's localized title projection.
 * @returns menu data for real Workspaces only.
 */
export function workspaceChoices(items: readonly WorkspaceView[], displayTitle: (title: string) => string): WorkspaceChoice[] {
  const titles = items.map(item => displayTitle(item.title))
  return items.map((item, index) => ({
    id: item.workspaceId, path: item.path,
    label: titles.filter(title => title === titles[index]).length > 1
      ? titles[index] + ' · ' + item.path : titles[index],
  }))
}

/**
 * Resolve a menu activation against the current registry.
 * @param id - activated menu row.
 * @param items - current real Workspaces.
 * @returns an explicit action, or absence for a stale/unknown choice.
 */
export function menuAction(id: string, items: readonly WorkspaceView[]):
  { kind: 'none' } | { kind: 'add' } | { kind: 'workspace'; id: WorkspaceId } | undefined {
  if (id === NONE) return { kind: 'none' }
  if (id === ADD) return { kind: 'add' }
  const workspace = items.find(item => item.workspaceId === id)
  return workspace === undefined ? undefined : { kind: 'workspace', id: workspace.workspaceId }
}
