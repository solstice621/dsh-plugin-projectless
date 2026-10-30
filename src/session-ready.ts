/** Await the new Session's normal live announcement without reloading all history. */
import type { ISessions, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

type Catalog = Pick<ISessions, 'list' | 'refresh'>

/**
 * Use the already-published row, briefly join its live announcement if needed,
 * and recover a missing announcement with the public catalog refresh.
 * @param sessions - public Session catalog and recovery operation.
 * @param id - identity returned by the authenticated creation route.
 * @param cwd - directory to verify before opening the Session.
 * @param signal - selection/plugin lifetime.
 * @param announcementMs - maximum live-event wait before recovery.
 * @returns the authoritative matching row; never manufactures catalog entries.
 */
export async function sessionReady(
  sessions: Catalog, id: SessionId, cwd: string, signal: AbortSignal, announcementMs = 100,
): Promise<SessionSummary> {
  signal.throwIfAborted()
  let row: SessionSummary | undefined = sessions.list.getSnapshot().byId[id]
  if (row === undefined) {
    row = await new Promise<SessionSummary | undefined>((resolve, reject) => {
      let unsubscribe = () => {}
      let timer: ReturnType<typeof setTimeout> | undefined
      let settled = false
      const finish = (value?: SessionSummary, aborted = false) => {
        if (settled) return
        settled = true
        unsubscribe()
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        if (aborted) reject(signal.reason)
        else resolve(value)
      }
      const abort = () => { finish(undefined, true) }
      const check = () => {
        const value = sessions.list.getSnapshot().byId[id]
        if (value !== undefined) finish(value)
      }
      signal.addEventListener('abort', abort, { once: true })
      unsubscribe = sessions.list.subscribe(check)
      if (settled) { unsubscribe(); return }
      timer = setTimeout(() => { finish() }, announcementMs)
      // Subscribe before the second read, so an announcement cannot land in a gap.
      if (signal.aborted) abort()
      else check()
    })
  }
  signal.throwIfAborted()
  if (row === undefined) {
    await sessions.refresh()
    signal.throwIfAborted()
    row = sessions.list.getSnapshot().byId[id]
  }
  if (row === undefined || row.cwd !== cwd) throw new Error('Harness has not listed the allocated chat yet; retry opening it')
  return row
}
