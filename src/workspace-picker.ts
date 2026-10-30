/** The existing Workspace menu with one explicit no-workspace option. */
import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import { Button, Menu, Modal, IconFolderCloseRegular, IconPlusOutlineRegular, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { workspaceDisplayTitle } from '@deepseek-ai/dsh-api-workspace-controller/default-workspace'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { DirectoryListing } from '@deepseek-ai/dsh-host-directory-picker/types'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { ActionState } from './controller.ts'
import { DirectoryDialog } from './directory-dialog.ts'
import { ADD, NONE, menuAction, workspaceChoices } from './menu-model.ts'

/** Client operations and observable action state shared by each menu occurrence. */
export interface PickerInjected {
  readonly chooseNone: () => Promise<boolean>
  /** Undefined selects the composed browser interaction; null means native cancellation. */
  readonly pickDirectory: () => Promise<string | null | undefined>
  readonly createWorkspace: (input: { path: string }) => Promise<WorkspaceView>
  readonly listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>
  readonly createDirectory: (path: string, name: string) => Promise<string>
  readonly defaultWorkspaceName: () => string
  readonly hooks: { readonly projectlessAction: HostObservable<ActionState> }
}

/** Original menu owner props, standard sources, and plugin operations. */
export type PickerProps = PropsRuntime<'conversation.hero.workspace'> & PropsLocale<'projectless-chat'> & InjectFace<PickerInjected>

/**
 * Render real Workspaces and the no-workspace choice at the original menu anchor.
 * @param props - original picker owner and plugin operations.
 * @returns the menu plus directory/error dialogs.
 */
export function ProjectlessWorkspacePicker(props: PickerProps) {
  const snapshot = props.useWorkspaces(value => value)
  const current = props.useSessions(value => Object.values(value.byId).find(row => (row.retainedBy.mainView ?? 0) > 0))
  const state = props.useProjectlessAction(value => value)
  const [picking, setPicking] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [error, setError] = useState<string>()
  const [dismissedFailure, setDismissedFailure] = useState<ActionState>()
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const t = props.t
  const busy = picking || state.phase === 'busy'
  const noneSelected = current !== undefined && current.origin !== 'subagent' && !!current.cwd
    && snapshot.phase === 'ready' && !snapshot.items.some(item => item.sessionIds.includes(current.id))
  const getAnchorRect = useCallback(() => props.anchorRef?.current?.getBoundingClientRect() ?? null, [props.anchorRef])
  const items: MenuEntry[] = [
    ...workspaceChoices(snapshot.items, title => workspaceDisplayTitle(title, props.defaultWorkspaceName())).map(item => ({
      id: item.id, label: h('span', { title: item.path }, item.label), disabled: busy, icon: h(IconFolderCloseRegular, { size: 16 }),
    })),
  ]
  const adopt = async (path: string) => {
    if (picking) return
    setPicking(true)
    setError(undefined)
    try {
      const workspace = await props.createWorkspace({ path })
      if (!alive.current) return
      setBrowsing(false)
      props.onPick(workspace.workspaceId)
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally { if (alive.current) setPicking(false) }
  }
  const add = async () => {
    props.onClose()
    setError(undefined)
    setPicking(true)
    try {
      const path = await props.pickDirectory()
      if (!alive.current) return
      if (path === undefined) setBrowsing(true)
      else if (path !== null) {
        const workspace = await props.createWorkspace({ path })
        if (alive.current) props.onPick(workspace.workspaceId)
      }
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally { if (alive.current) setPicking(false) }
  }
  const chooseNone = async () => {
    setDismissedFailure(undefined)
    // A selection dismisses the menu immediately; a slow Host never holds it open.
    props.onClose()
    await props.chooseNone()
  }
  const failure = state.phase === 'error' && state !== dismissedFailure ? state.failure : undefined
  return h('div', { 'data-projectless-workspace-menu': '' },
    h(Menu, { open: props.open, anchor: null, items, selectedId: noneSelected ? NONE : props.selectedId,
      footer: [
        { id: ADD, label: t('addWorkspace'), disabled: busy, icon: h(IconPlusOutlineRegular, { size: 16 }) },
        { id: NONE, label: state.phase === 'busy' ? t('busy') : t('none'), disabled: busy, icon: h(IconFolderCloseRegular, { size: 16 }) },
      ],
      onClose: props.onClose, portal: true, getAnchorRect,
      onSelect: id => {
        if (busy) return
        const action = menuAction(id, snapshot.items)
        if (action?.kind === 'none') void chooseNone()
        else if (action?.kind === 'add') void add()
        else if (action?.kind === 'workspace') props.onPick(action.id)
      } }),
    h(DirectoryDialog, { open: browsing, initialPath: current?.cwd, busy: picking, error, t,
      listDirectory: props.listDirectory, createDirectory: props.createDirectory,
      onPick: path => { void adopt(path) }, onClose: () => { setBrowsing(false); setError(undefined) } }),
    h(Modal, { open: failure !== undefined || (error !== undefined && !browsing), title: t('failure'), closeLabel: t('cancel'),
      onClose: () => { setDismissedFailure(state); setError(undefined) },
      footer: failure === undefined ? undefined : h(Button, { variant: 'primary', onClick: () => { void chooseNone() } }, t('retry')),
    }, h('div', { role: 'alert', style: { overflowWrap: 'anywhere' } }, failure?.message ?? error)))
}
