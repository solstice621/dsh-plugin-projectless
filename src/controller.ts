/** Client action owner: deduplicate clicks and preserve retry identity across lost responses. */
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { CHANNEL, ENDPOINT, parseChat, type CreateRequestId, type ProjectlessChat, type ProjectlessFailure } from './protocol.ts'

/** State rendered by every projectless-chat launcher. */
export type ActionState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'busy' }
  | { readonly phase: 'error'; readonly failure: ProjectlessFailure }

/** Stateful action with an observable snapshot suitable for the Harness slot renderer. */
export class ProjectlessController {
  private state: ActionState = { phase: 'idle' }
  private readonly listeners = new Set<() => void>()
  private readonly rpc: Pick<ClientConnectionRpc, 'call'>
  private readonly open: (sessionId: SessionId, cwd: string, signal: AbortSignal) => void | Promise<void>
  private requestId: CreateRequestId | undefined
  private created: ProjectlessChat | undefined
  private pending: Promise<void> | undefined
  private abort: AbortController | undefined
  private disposed = false

  /**
   * Bind the serving Host and normal Harness Session navigation.
   * @param rpc - authenticated Connection caller.
   * @param open - normal Session opening operation.
   */
  constructor(rpc: Pick<ClientConnectionRpc, 'call'>, open: (sessionId: SessionId, cwd: string, signal: AbortSignal) => void | Promise<void>) {
    this.rpc = rpc
    this.open = open
  }

  /** @returns the immutable current action state. */
  getSnapshot = (): ActionState => this.state

  /**
   * Observe future state changes.
   * @param listener - notification called after the snapshot changes.
   * @returns an unsubscribe function.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Start a chat, or retry the previous interrupted operation without a second click race.
   * @returns settlement of the retained action; failures are represented in the snapshot.
   */
  start(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.pending !== undefined) return this.pending
    this.requestId ??= globalThis.crypto.randomUUID() as CreateRequestId
    this.abort = new AbortController()
    this.publish({ phase: 'busy' })
    const operation = this.run(this.requestId, this.abort.signal)
    this.pending = operation
    void operation.then(() => { if (this.pending === operation) this.pending = undefined })
    return operation
  }

  /** Cancel navigation and release observers when the plugin unloads. */
  dispose(): void {
    this.disposed = true
    this.abort?.abort(new Error('projectless: client plugin unloaded'))
    this.listeners.clear()
  }

  private async run(requestId: CreateRequestId, signal: AbortSignal): Promise<void> {
    try {
      if (this.created === undefined) {
        const response = await this.rpc.call(CHANNEL, ENDPOINT, { requestId }, signal)
        signal.throwIfAborted()
        if (!response.ok) {
          this.requestId = undefined
          this.publish({ phase: 'error', failure: response.error })
          return
        }
        this.created = parseChat(response.value)
      }
      signal.throwIfAborted()
      await this.open(this.created.sessionId, this.created.cwd, signal)
      signal.throwIfAborted()
      this.created = undefined
      this.requestId = undefined
      this.publish({ phase: 'idle' })
    } catch (error) {
      if (this.disposed || signal.aborted) return
      const message = error instanceof Error ? error.message : String(error)
      this.publish({ phase: 'error', failure: {
        code: message === 'projectless/invalid-response' ? message : 'projectless/transport',
        message,
      } })
    }
  }

  private publish(state: ActionState): void {
    if (this.disposed) return
    this.state = state
    for (const listener of Array.from(this.listeners)) listener()
  }
}
