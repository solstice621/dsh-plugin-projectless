/** Cordis Client plugin: add No workspace to the existing Workspace picker. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ProjectlessController } from './controller.ts'
import { ProjectlessConversationPanel } from './conversation.ts'
import { ProjectlessPresentation } from './presentation.ts'
import { directoryChoice } from './directory-choice.ts'
import { sessionReady } from './session-ready.ts'
import { ProjectlessWorkspacePicker, type PickerInjected } from './workspace-picker.ts'
import { NS, en, zh, type ProjectlessKey } from './locales.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Connection's published client service interface. */
    connection: ConnectionHandle
  }
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Workspace picker copy. */
    'projectless-chat': ProjectlessKey
  }
}
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** Retain a newly allocated Session until main-view navigation takes ownership. */
    projectlessSelection: unknown
  }
}

/** Services supplied by the standard Desktop/Web composition. */
export const inject = ['connection', 'slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace', 'uiConversation', 'conversation']

/**
 * Extend the original Workspace picker and bind its no-workspace selection.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'projectless: dictionaries')
  let presentation: ProjectlessPresentation | undefined
  let sourceId: SessionId | undefined
  let initialDraft: string | undefined
  const current = () => Object.values(ctx.sessions.list.getSnapshot().byId).find(row => (row.retainedBy.mainView ?? 0) > 0)
  const report = (error: unknown) => { console.error('projectless: Conversation renderer failed', error) }
  ctx.slots.inject('main.conversation', () => {
    const currentPresentation = new ProjectlessPresentation(ctx.sessions.list, ctx.workspaces.list,
      () => ctx.slots.register({ name: 'main.conversation', priority: -100, locale: NS }, ProjectlessConversationPanel), report)
    presentation = currentPresentation
    return () => {
      if (presentation === currentPresentation) presentation = undefined
      void currentPresentation.dispose().catch(report)
    }
  })
  const controller = new ProjectlessController(ctx.connection.rpc, async (sessionId, cwd, signal) => {
    await sessionReady(ctx.sessions, sessionId, cwd, signal)
    // A later user navigation owns the main view, even if Host creation finished afterward.
    if (current()?.id !== sourceId) return
    await ctx.sessions.using(sessionId, { source: 'projectlessSelection', signal }, async reference => {
      signal.throwIfAborted()
      if (current()?.id !== sourceId) return
      if (initialDraft) {
        const initialized = ctx.conversation.input.requestDraftInitialization(reference.binding, { prompt: initialDraft, whenDraftExists: 'keep' })
        if (initialized === 'blocked') throw new Error('The destination draft is busy; retry opening it')
      }
      ctx.uiWorkspace.openSession(sessionId)
      await presentation?.sync()
      signal.throwIfAborted()
    })
  })
  ctx.effect(() => () => { controller.dispose() }, 'projectless: pending selection')
  const chooseNone = async (): Promise<boolean> => {
    const selected = current()
    const workspaces = ctx.workspaces.list.getSnapshot()
    if (selected?.blank && selected.origin !== 'subagent' && selected.cwd
      && workspaces.phase === 'ready' && !workspaces.items.some(workspace => workspace.sessionIds.includes(selected.id))) return true
    if (controller.getSnapshot().phase !== 'busy') {
      sourceId = selected?.id
      const binding = sourceId === undefined ? undefined : ctx.sessions.binding(sourceId)
      const input = binding === undefined ? undefined : ctx.conversation.input.for(binding.ctx).state.getSnapshot()
      initialDraft = input?.phase === 'plain' || input?.phase === 'claimed' ? input.draft : undefined
    }
    await controller.start()
    return controller.getSnapshot().phase === 'idle'
  }
  const actions: PickerInjected = {
    chooseNone,
    pickDirectory: () => {
      // The same optional Desktop bridge used by Harness's native directory-flow plugin.
      const desktop = (globalThis as typeof globalThis & { __DSH_DIRECTORY_PICKER__?: { pick: () => Promise<string | null> } }).__DSH_DIRECTORY_PICKER__
      return directoryChoice({ desktop, probeBrowse: () => ctx.uiWorkspace.listDirectory(current()?.cwd),
        pickNative: () => ctx.uiWorkspace.pickDirectory() })
    },
    createWorkspace: input => ctx.workspaces.create(input),
    listDirectory: (path, signal) => ctx.uiWorkspace.listDirectory(path, signal),
    createDirectory: (path, name) => ctx.uiWorkspace.createDirectory(path, name),
    defaultWorkspaceName: () => ctx.locale.bind('workspace')('workspace.defaultName'),
    hooks: { projectlessAction: controller },
  }
  ctx.slots.inject('conversation.hero.workspace', () => ctx.slots.register({
    name: 'conversation.hero.workspace', priority: -100, locale: NS, inject: () => actions,
  }, ProjectlessWorkspacePicker))
}
