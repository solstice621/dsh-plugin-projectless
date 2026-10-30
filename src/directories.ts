/** Allocate persistent chat directories without changing the process working directory. */
import { lstat, mkdir, mkdtemp, realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

/** Paths belonging to one newly allocated chat. */
export interface ChatDirectory {
  readonly cwd: string
  readonly workDirectory: string
  readonly outputDirectory: string
}

/**
 * Allocate a distinct directory under the Host's local calendar date.
 * Existing directories are retained on failure and are never automatically deleted.
 * @param workspaceRoot - absolute parent directory configured by the operator.
 * @param now - creation instant, interpreted in the Host's local timezone.
 * @returns canonical cwd and the two pre-created child directories.
 */
export async function createChatDirectory(workspaceRoot: string, now = new Date()): Promise<ChatDirectory> {
  if (!isAbsolute(workspaceRoot)) throw new Error('projectless: workspaceRoot must be an absolute path')
  if (!Number.isFinite(now.getTime())) throw new Error('projectless: invalid creation time')
  await mkdir(workspaceRoot, { recursive: true, mode: 0o700 })
  const root = await realpath(workspaceRoot)
  const day = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
    + '-' + String(now.getDate()).padStart(2, '0')
  const dateDirectory = join(root, day)
  try {
    await mkdir(dateDirectory, { mode: 0o700 })
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'EEXIST') throw error
    const info = await lstat(dateDirectory)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('projectless: the date directory must be a real directory')
    }
  }
  const cwd = await mkdtemp(join(dateDirectory, 'chat-'))
  const workDirectory = join(cwd, 'work')
  const outputDirectory = join(cwd, 'outputs')
  await mkdir(workDirectory, { mode: 0o700 })
  await mkdir(outputDirectory, { mode: 0o700 })
  return { cwd, workDirectory, outputDirectory }
}
