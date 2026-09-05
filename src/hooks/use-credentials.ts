import { useCallback, useEffect, useMemo, useState } from 'react'
import { authorize } from '../core/auth/oauth.ts'
import { ensureFresh } from '../core/auth/refresh.ts'
import { createCredentialStore } from '../core/auth/store.ts'
import type { Ports } from '../core/ports.ts'
import { getProvider } from '../core/providers/registry.ts'
import type { Credential, CredentialMap, ProviderId } from '../core/providers/types.ts'

export interface UseCredentials {
  credentials: CredentialMap
  /**
   * auth.json has been read. False for the first frames after launch, when every
   * provider looks unconfigured because nothing has been loaded yet.
   */
  loaded: boolean
  /** The provider currently mid-connect. Its settings row goes busy. */
  busyProviderId?: ProviderId
  error?: string
  connect: (providerId: ProviderId, apiKey?: string) => Promise<void>
  disconnect: (providerId: ProviderId) => Promise<void>
  /**
   * The credential to send, refreshed if it was about to expire. Safe to call before
   * every request: it is a no-op for api-key and keyless providers.
   */
  ensure: (providerId: ProviderId) => Promise<Credential>
  clearError: () => void
}

export const useCredentials = (ports: Ports): UseCredentials => {
  const store = useMemo(() => createCredentialStore(ports.authStore), [ports])
  const [credentials, setCredentials] = useState<CredentialMap>({})
  const [loaded, setLoaded] = useState(false)
  const [busyProviderId, setBusyProviderId] = useState<ProviderId | undefined>()
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    let alive = true
    void store.all().then((all) => {
      if (!alive) return
      setCredentials(all)
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [store])

  const connect = useCallback(
    async (providerId: ProviderId, apiKey?: string) => {
      const provider = getProvider(providerId)
      setBusyProviderId(providerId)
      setError(undefined)
      try {
        let credential: Credential
        if (provider.auth.kind === 'apiKey') {
          const key = apiKey?.trim()
          if (!key) throw new Error('Enter an API key.')
          credential = { type: 'api', key }
        } else if (provider.auth.kind === 'oauth') {
          // Blocks until the browser round-trip completes or the listener times out.
          credential = await authorize(provider.auth, ports)
        } else {
          credential = { type: 'none' }
        }
        await store.set(providerId, credential)
        setCredentials((current) => ({ ...current, [providerId]: credential }))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setBusyProviderId(undefined)
      }
    },
    [ports, store],
  )

  const disconnect = useCallback(
    async (providerId: ProviderId) => {
      await store.remove(providerId)
      setCredentials((current) => {
        const next = { ...current }
        delete next[providerId]
        return next
      })
    },
    [store],
  )

  const ensure = useCallback(
    async (providerId: ProviderId): Promise<Credential> => {
      const provider = getProvider(providerId)
      const current = credentials[providerId] ?? { type: 'none' }
      const fresh = await ensureFresh(providerId, current, provider.auth, ports, store)
      if (fresh !== current) setCredentials((all) => ({ ...all, [providerId]: fresh }))
      return fresh
    },
    [credentials, ports, store],
  )

  return {
    credentials,
    loaded,
    busyProviderId,
    error,
    connect,
    disconnect,
    ensure,
    clearError: useCallback(() => setError(undefined), []),
  }
}
