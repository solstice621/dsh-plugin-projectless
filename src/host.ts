/** Cordis Host plugin: create an ungrouped Session with an automatically allocated cwd. */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-client-connection'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type { ConnectionFetchRoute, ConnectionRpcHandler, ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import type { PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionCreateRequest, SessionCreateValue } from '@deepseek-ai/dsh-api-session-controller/types'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { createChatDirectory, type ChatDirectory } from './directories.ts'
import { CHANNEL, ENDPOINT, parseCreateRequest, type CreateRequestId, type ProjectlessChat } from './protocol.ts'

/** Plugin display name. */
export const name = 'projectless-chat'
/** Services supplied by the Desktop/Web composition. */
export const inject = ['connection', 'sessionController']

/** Operator configuration; does not change Session permissions or model settings. */
export interface Config {
  readonly workspaceRoot: string
  readonly maxCachedRequests: number
}

/** Validate configurable directory and bounded transport-retry retention. */
export const Config: Schema<Config> = Schema.object({
  workspaceRoot: Schema.string().default(join(homedir(), 'Documents', 'DeepSeek Harness', 'Chats')),
  maxCachedRequests: Schema.number().min(1).max(4096).default(128),
})

interface CachedCreation {
  readonly promise: Promise<ProjectlessChat>
  settled: boolean
}

/** A Session creator supplied by Harness or an integration fixture. */
export type CreateSession = (request: SessionCreateRequest) => Promise<SessionCreateValue>

/**
 * Allocate a directory and create a blank Session without a workspaceId.
 * Once Session creation starts, it is allowed to finish even if the caller disconnects.
 * @param workspaceRoot - configured parent for new chat directories.
 * @param createSession - Harness's ordinary Session creation operation.
 * @param signal - cancellation checked before committing Session creation.
 * @returns the new Session and its directories.
 */
export async function createProjectlessChat(
  workspaceRoot: string, createSession: CreateSession, signal: AbortSignal,
): Promise<ProjectlessChat> {
  signal.throwIfAborted()
  let directory: ChatDirectory
  try {
    directory = await createChatDirectory(workspaceRoot)
  } catch (cause) {
    throw new ProjectlessError('projectless/directory', messageOf(cause), { workspaceRoot }, cause)
  }
  signal.throwIfAborted()
  try {
    const { sessionId } = await createSession({ cwd: directory.cwd })
    return { sessionId, ...directory }
  } catch (cause) {
    throw new ProjectlessError('projectless/session', messageOf(cause), { cwd: directory.cwd }, cause)
  }
}

/**
 * Build an authenticated RPC handler with bounded, process-local retry deduplication.
 * Failed creations can be retried; completed successes retain their original Session.
 * @param config - validated operator configuration.
 * @param createSession - Harness Session creation operation.
 * @param lifetime - owning plugin's cancellation signal.
 * @returns a handler and an asynchronous teardown that drains outstanding creations.
 */
export function createHandler(config: Config, createSession: CreateSession, lifetime: AbortController): {
  readonly handle: ConnectionRpcHandler
  readonly dispose: () => Promise<void>
} {
  const cache = new Map<CreateRequestId, CachedCreation>()
  const handle: ConnectionRpcHandler = async (endpoint, payload, signal, peer) => {
    if (peer.principal.kind !== 'owner') return failure('projectless/forbidden', 'Only the Host owner can create a chat')
    if (endpoint !== 'create') return failure('projectless/not-found', 'Unknown projectless endpoint')
    const requestId = parseCreateRequest(payload)
    if (requestId === undefined) return failure('projectless/invalid-request', 'Expected one UUID requestId')
    try {
      lifetime.signal.throwIfAborted()
      signal.throwIfAborted()
      let item = cache.get(requestId)
      if (item === undefined) {
        for (const [id, entry] of cache) {
          if (cache.size < config.maxCachedRequests) break
          if (entry.settled) cache.delete(id)
        }
        if (cache.size >= config.maxCachedRequests) return failure('projectless/busy', 'Chat creation is busy; try again')
        const combined = AbortSignal.any([signal, lifetime.signal])
        const promise = createProjectlessChat(config.workspaceRoot, createSession, combined)
        item = { promise, settled: false }
        cache.set(requestId, item)
        const retained = item
        void promise.then(() => { retained.settled = true }, () => {
          if (cache.get(requestId) === retained) cache.delete(requestId)
        })
      }
      return { ok: true, value: await item.promise }
    } catch (error) {
      if (error instanceof ProjectlessError) return failure(error.code, error.message, error.details)
      return failure('projectless/cancelled', messageOf(error))
    }
  }
  return {
    handle,
    dispose: async () => {
      lifetime.abort(new Error('projectless: plugin unloaded'))
      await Promise.allSettled(Array.from(cache.values(), item => item.promise))
      cache.clear()
    },
  }
}

/**
 * Adapt Connection's validated RPC envelope to its exact, owner-only Fetch seam.
 * In rc.3 the generic channel registrar loses the caller's webServer scope;
 * the public exact-route registry uses the already mounted authenticated /api carrier.
 * @param handle - bounded Session creation operation.
 * @param owner - Connection's owner Peer; only authenticated owners reach this route.
 * @returns the route contribution, removed with its owning plugin.
 */
export function createFetchRoute(handle: ConnectionRpcHandler, owner: PeerScope): ConnectionFetchRoute {
  return {
    path: CHANNEL + '/' + ENDPOINT, methods: ['POST'], requestBody: 'buffered',
    fetch: async request => {
      const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (mediaType !== 'application/json') return new Response('Expected application/json', { status: 415 })
      let body: unknown
      try { body = await request.json() } catch { return new Response('Invalid JSON', { status: 400 }) }
      const parsed = clientRequestSchema.safeParse(body)
      if (!parsed.success) return new Response('Invalid RPC envelope', { status: 400 })
      const { rpcId, method, payload } = parsed.data
      const result = method === ENDPOINT
        ? await handle('create', payload, request.signal, owner)
        : failure('projectless/invalid-request', 'RPC method does not match the projectless endpoint')
      return Response.json({ type: 'server-response', rpcId, result })
    },
  }
}

/**
 * Register the exact Host route and release it with its owning plugin.
 * @param ctx - Harness Host context.
 * @param config - validated plugin options.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = Config(config)
  if (!isAbsolute(resolved.workspaceRoot)) throw new Error('projectless: workspaceRoot must be an absolute path')
  if (!Number.isSafeInteger(resolved.maxCachedRequests)) throw new Error('projectless: maxCachedRequests must be an integer')
  const operations = createHandler(resolved, request => ctx.sessionController.create(request), new AbortController())
  ctx.effect(() => operations.dispose, 'projectless: outstanding creations')
  ctx.effect(() => ctx.connection.fetch.register(createFetchRoute(operations.handle, ctx.connection.browserPeer)), 'projectless: owner-only RPC route')
}

class ProjectlessError extends Error {
  readonly code: string
  readonly details: object
  constructor(code: string, message: string, details: object, cause: unknown) {
    super(message, { cause })
    this.code = code
    this.details = details
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function failure(code: string, message: string, details: object = {}): ConnectionRpcResult<never> {
  return { ok: false, error: { code, message, details } }
}
