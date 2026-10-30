/** Select the directory interaction actually provided by this Harness host. */
export interface DirectoryChoiceOperations {
  /** Electron's native bridge, when this client runs inside Desktop. */
  readonly desktop?: { pick: () => Promise<string | null> }
  /** Read-only capability probe; success means the host serves browser listings. */
  readonly probeBrowse: () => Promise<unknown>
  /** Host OS chooser for local Web deployments without an Electron bridge. */
  readonly pickNative: () => Promise<string | null>
}

/**
 * Keep native cancellation distinct from the request to open an in-page browser.
 * @param operations - public Desktop bridge and Workspace UI operations.
 * @returns a chosen path, null for cancellation, or undefined for browser mode.
 */
export async function directoryChoice(operations: DirectoryChoiceOperations): Promise<string | null | undefined> {
  if (operations.desktop !== undefined) return operations.desktop.pick()
  try {
    await operations.probeBrowse()
  } catch (reason) {
    const rpcError = reason !== null && typeof reason === 'object' && 'rpcError' in reason
      ? reason.rpcError as { code?: unknown; details?: { capability?: unknown } } | undefined : undefined
    if (rpcError?.code === 'directory-picker/unavailable' && rpcError.details?.capability === 'native') {
      return operations.pickNative()
    }
    // An unreadable initial folder still permits entering another path in the browser.
    if (rpcError?.code !== 'directory-picker/unreadable') throw reason
  }
  return undefined
}
