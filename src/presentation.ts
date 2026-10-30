/** Observe when an ungrouped blank Session needs the no-workspace composer. */
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

/** Metadata used to decide whether the native blank-chat prerequisite applies. */
export type PresentationSession = Pick<SessionSummary, 'id' | 'blank' | 'cwd' | 'origin' | 'retainedBy'>

/**
 * Identify a selected ordinary blank Session outside every registered Workspace.
 * @param sessions - current catalog and local main-view ownership.
 * @param workspaces - authoritative Workspace membership, after its first baseline.
 * @returns whether an editable blank-chat renderer is needed.
 */
export function needsProjectlessComposer(
  sessions: { readonly byId: Readonly<Record<string, PresentationSession>> },
  workspaces: Pick<WorkspaceSnapshot, 'phase' | 'items'>,
): boolean {
  if (workspaces.phase !== 'ready') return false
  return Object.values(sessions.byId).some(session =>
    (session.retainedBy.mainView ?? 0) > 0
    && session.blank && session.origin !== 'subagent'
    && session.cwd !== undefined && session.cwd !== ''
    && !workspaces.items.some(workspace => workspace.sessionIds.includes(session.id)))
}

/** Public slot disposers may finish their Cordis cleanup asynchronously. */
export type PresentationDisposer = () => void | Promise<void>

/** Serialize renderer registration and removal across navigation and plugin teardown. */
export class ProjectlessPresentation {
  private readonly sessions: HostObservable<SessionListState>
  private readonly workspaces: HostObservable<WorkspaceSnapshot>
  private readonly enable: () => PresentationDisposer
  private readonly unsubscribe: (() => void)[]
  private release: PresentationDisposer | undefined
  private pending: Promise<void> = Promise.resolve()
  private stopped = false

  /**
   * Observe selected Sessions and Workspace membership without retaining a Session.
   * @param sessions - public Session catalog source.
   * @param workspaces - public Workspace list source.
   * @param enable - register the blank-chat renderer and return its disposer.
   * @param report - report background setup or cleanup failures.
   */
  constructor(
    sessions: HostObservable<SessionListState>, workspaces: HostObservable<WorkspaceSnapshot>,
    enable: () => PresentationDisposer, report: (error: unknown) => void,
  ) {
    this.sessions = sessions
    this.workspaces = workspaces
    this.enable = enable
    const changed = () => { void this.sync().catch(report) }
    this.unsubscribe = [sessions.subscribe(changed), workspaces.subscribe(changed)]
    changed()
  }

  /**
   * Apply the latest selection after all earlier renderer cleanup has settled.
   * @returns completion of this reconciliation, including registration failures.
   */
  sync(): Promise<void> {
    const next = this.pending.catch(() => {}).then(async () => {
      const wanted = !this.stopped && needsProjectlessComposer(
        this.sessions.getSnapshot(), this.workspaces.getSnapshot())
      if (wanted && this.release === undefined) {
        this.release = this.enable()
      } else if (!wanted && this.release !== undefined) {
        const release = this.release
        this.release = undefined
        await release()
      }
    })
    this.pending = next
    return next
  }

  /**
   * Stop observing and remove the renderer after any outstanding cleanup.
   * @returns settlement of renderer removal; repeated disposal is harmless.
   */
  dispose(): Promise<void> {
    if (!this.stopped) {
      this.stopped = true
      for (const unsubscribe of this.unsubscribe) unsubscribe()
    }
    return this.sync()
  }
}
