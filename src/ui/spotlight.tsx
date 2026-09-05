import { type ReactNode, useEffect, useRef } from 'react'
import type { Page } from '../hooks/use-navigation.ts'

export interface SpotlightProps {
  /** Each page owns a block in styles.css — the height cap above all. */
  page: Page
  /** The query field. Always pinned at the top; also the window drag region. */
  input: ReactNode
  /** Suggestions, transcript or recent threads — whatever the current state shows. */
  body?: ReactNode
  footer?: ReactNode
  /**
   * Measured panel height in CSS pixels, already clamped by `--pa-max-height`.
   * Wire this to the OS window resize — it is the grow-to-fit number (PLAN #9).
   */
  onHeightChange?: (px: number) => void
}

/**
 * The panel itself. The native window is transparent and undecorated, so the rounded
 * background, border and shadow are painted here.
 */
export function Spotlight({ page, input, body, footer, onHeightChange }: SpotlightProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const notify = useRef(onHeightChange)

  useEffect(() => {
    notify.current = onHeightChange
  })

  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    let last = -1
    const report = () => {
      const px = Math.ceil(el.getBoundingClientRect().height)
      if (px === last || px === 0) return
      last = px
      notify.current?.(px)
    }
    const observer = new ResizeObserver(report)
    observer.observe(el)
    report()
    return () => observer.disconnect()
  }, [])

  return (
    <div className={`pa-panel pa-panel--${page}`} ref={panelRef}>
      {/*
       * Only rendered when there is something to put in it: the settings view has no
       * query field, and an empty header left a dead 56px band above its title.
       * data-tauri-drag-region is a plain DOM attribute — no Tauri import needed.
       */}
      {input ? (
        <div className={body ? 'pa-header pa-header--divided' : 'pa-header'} data-tauri-drag-region>
          {input}
        </div>
      ) : null}
      {body ? <div className="pa-body">{body}</div> : null}
      {footer ? <div className="pa-footer-slot">{footer}</div> : null}
    </div>
  )
}
