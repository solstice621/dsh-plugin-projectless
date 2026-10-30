/** Browser-safe request and response vocabulary for projectless chats. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Shared authenticated Connection channel. */
export const CHANNEL = '/api'
/** Exact endpoint owned by this plugin, ahead of the shared Remote fallback. */
export const ENDPOINT = 'projectless-chat/create'

/** Identifies one user action across transport retries. */
export type CreateRequestId = Branded<'ProjectlessCreateRequestId'>

/** One chat backed by its own durable working directory. */
export interface ProjectlessChat {
  readonly sessionId: SessionId
  readonly cwd: string
  readonly workDirectory: string
  readonly outputDirectory: string
}

/** A failure that the UI can translate without interpreting error messages. */
export interface ProjectlessFailure {
  readonly code: string
  readonly message: string
}

/**
 * Validate the caller's action identity; callers cannot supply a directory or project.
 * @param payload - decoded Connection payload.
 * @returns a validated action identity, or undefined for an invalid request.
 */
export function parseCreateRequest(payload: unknown): CreateRequestId | undefined {
  if (typeof payload !== 'object' || payload === null || !('requestId' in payload)) return undefined
  if (Object.keys(payload).length !== 1 || typeof payload.requestId !== 'string') return undefined
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.requestId)) return undefined
  return payload.requestId as CreateRequestId
}

/**
 * Validate a chat response received from a Host before navigating to its Session.
 * @param value - decoded success value.
 * @returns the validated chat.
 */
export function parseChat(value: unknown): ProjectlessChat {
  if (typeof value !== 'object' || value === null
    || !('sessionId' in value) || typeof value.sessionId !== 'string' || value.sessionId.length === 0
    || !('cwd' in value) || typeof value.cwd !== 'string' || value.cwd.length === 0
    || !('workDirectory' in value) || typeof value.workDirectory !== 'string' || value.workDirectory.length === 0
    || !('outputDirectory' in value) || typeof value.outputDirectory !== 'string' || value.outputDirectory.length === 0) {
    throw new Error('projectless/invalid-response')
  }
  return {
    sessionId: value.sessionId as SessionId,
    cwd: value.cwd,
    workDirectory: value.workDirectory,
    outputDirectory: value.outputDirectory,
  }
}
