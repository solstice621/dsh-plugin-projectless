/** Browser directory picker backed by Harness's public directory operations. */
import { createElement as h, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react'
import { Button, Modal, IconFolderCloseRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DirectoryListing } from '@deepseek-ai/dsh-host-directory-picker/types'
import type { ProjectlessKey } from './locales.ts'

/** Host operations and owner-controlled directory adoption. */
export interface DirectoryDialogProps {
  readonly open: boolean
  readonly initialPath?: string
  readonly busy: boolean
  readonly error?: string
  readonly listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>
  readonly createDirectory: (path: string, name: string) => Promise<string>
  readonly onPick: (path: string) => void
  readonly onClose: () => void
  readonly t: (key: ProjectlessKey) => string
}

/**
 * Browse, enter a path, or create a directory before adopting it as a Workspace.
 * @param props - directory APIs and the owning menu's lifetime.
 * @returns a cancellable directory dialog; stale directory reads are discarded.
 */
export function DirectoryDialog(props: DirectoryDialogProps): ReactElement {
  const [listing, setListing] = useState<DirectoryListing>()
  const [path, setPath] = useState('')
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const request = useRef<AbortController>()
  const lifetime = useRef(0)
  const busy = props.busy || creating
  const t = props.t
  const browse = (target?: string) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError(undefined)
    void props.listDirectory(target, controller.signal).then(value => {
      if (controller.signal.aborted) return
      setListing(value)
      setPath(value.path)
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
  }
  useEffect(() => {
    lifetime.current++
    if (props.open) { setListing(undefined); setFolderName(''); browse(props.initialPath) }
    return () => { lifetime.current++; request.current?.abort() }
  }, [props.open, props.initialPath, props.listDirectory])
  const createFolder = async () => {
    if (listing === undefined || busy || folderName.trim() === '') return
    const generation = lifetime.current
    setCreating(true)
    setError(undefined)
    try {
      const created = await props.createDirectory(listing.path, folderName.trim())
      if (generation !== lifetime.current) return
      setFolderName('')
      browse(created)
    } catch (reason) {
      if (generation === lifetime.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally { if (generation === lifetime.current) setCreating(false) }
  }
  return h(Modal, { open: props.open, title: t('pickTitle'), closeLabel: t('cancel'),
    onClose: () => { if (!busy) props.onClose() },
    footer: h('div', { style: { display: 'flex', gap: 8 } },
      h(Button, { variant: 'outline', disabled: busy, onClick: props.onClose }, t('cancel')),
      h(Button, { variant: 'primary', disabled: busy || loading || listing === undefined || error !== undefined,
        onClick: () => { if (listing !== undefined) props.onPick(listing.path) } }, t('selectDirectory'))),
  },
  h('form', { style: { display: 'flex', gap: 8 }, onSubmit: (event: FormEvent) => { event.preventDefault(); if (!busy && path.trim()) browse(path.trim()) } },
    h('input', { 'aria-label': t('path'), 'data-modal-autofocus': '', value: path, disabled: busy,
      onChange: event => { setPath(event.currentTarget.value) }, style: { flex: 1, minWidth: 0, padding: 8, color: 'inherit', background: 'transparent', border: '1px solid var(--dsw-alias-border-l3)', borderRadius: 8 } }),
    h(Button, { type: 'submit', variant: 'outline', disabled: busy || path.trim() === '' }, t('go'))),
  h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' } },
    h(Button, { size: 'sm', disabled: busy || loading || !listing?.crumbs.at(-2),
      onClick: () => { const parent = listing?.crumbs.at(-2); if (parent) browse(parent.path) } }, t('up')),
    h('label', null, h('input', { type: 'checkbox', checked: showHidden, onChange: event => { setShowHidden(event.currentTarget.checked) } }), ' ', t('showHidden'))),
  loading ? h('div', { role: 'status' }, t('loading')) : null,
  h('div', { 'data-projectless-directory-path': listing?.path, style: { minHeight: 140, maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column' } },
    ...(listing?.entries.filter(entry => showHidden || !entry.hidden) ?? []).map(entry => h(Button, { key: entry.path, disabled: busy || loading,
      style: { justifyContent: 'flex-start', flexShrink: 0 }, icon: h(IconFolderCloseRegular, { size: 16 }),
      onClick: () => { browse(entry.path) } }, entry.name))),
  listing?.truncated ? h('div', { role: 'status' }, t('truncated')) : null,
  h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
    h('input', { 'aria-label': t('folderName'), placeholder: t('folderName'), value: folderName, disabled: busy,
      onChange: event => { setFolderName(event.currentTarget.value) }, style: { flex: 1, minWidth: 0, padding: 8, color: 'inherit', background: 'transparent', border: '1px solid var(--dsw-alias-border-l3)', borderRadius: 8 } }),
    h(Button, { variant: 'outline', disabled: busy || loading || listing === undefined || folderName.trim() === '', onClick: () => { void createFolder() } }, t('newFolder'))),
  error || props.error ? h('div', { role: 'alert', style: { marginTop: 8, color: 'var(--dsw-alias-state-error-primary)', overflowWrap: 'anywhere' } }, error ?? props.error) : null)
}
