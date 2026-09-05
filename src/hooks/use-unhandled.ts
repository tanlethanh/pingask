import { useEffect } from 'react'
import { toAskError } from '../core/ask/stream.ts'

/**
 * Catch what escapes.
 *
 * A rejected promise nobody awaited is still a failed turn, and the AI SDK produces
 * exactly this shape: `streamText` exposes result promises (`text`, `steps`, `usage`) that
 * reject when a stream produces nothing, and a caller reading only `fullStream`, as
 * askStream does, never handles them.
 *
 * `preventDefault()` takes responsibility for the rejection, so the webview stops logging
 * its own bare line and the report below is the only one.
 */
export const useUnhandled = (onFailure: (error: unknown) => void): void => {
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault()
      // An abort is how the app cancels a turn; it is not a failure to show anyone.
      if (toAskError(event.reason).kind === 'aborted') return
      onFailure(event.reason)
    }

    // A synchronous throw that reached the top. Same treatment, minus preventDefault:
    // swallowing those would hide real crashes from the console entirely.
    const onError = (event: ErrorEvent) => {
      onFailure(event.error ?? event.message)
    }

    window.addEventListener('unhandledrejection', onRejection)
    window.addEventListener('error', onError)
    return () => {
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('error', onError)
    }
  }, [onFailure])
}
