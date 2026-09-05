import { useMemo } from 'react'
import type { Ports } from '../core/ports.ts'
import { createPorts } from '../platform/index.ts'

/** The real Ports, built once for the life of the app. */
export const usePorts = (): Ports => useMemo(() => createPorts(), [])
