import { useEffect, useState } from 'react'
import { appVersion } from '../platform/index.ts'

/**
 * The running bundle's version. One IPC call per mount, `undefined` until it lands.
 *
 * A failure also leaves it `undefined` and the caller simply draws nothing: the version
 * label is an aside, and an aside must never turn into an error row.
 */
export const useVersion = (): string | undefined => {
  const [version, setVersion] = useState<string>()

  useEffect(() => {
    let cancelled = false
    void appVersion()
      .then((value) => {
        if (!cancelled) setVersion(value)
      })
      .catch((error: unknown) => {
        console.error('Failed to read app version', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return version
}
