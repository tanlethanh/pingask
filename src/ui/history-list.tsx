import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react'
import type { Thread } from '../core/threads/model.ts'
import { CloseIcon } from './icons.tsx'

const relativeTime = (timestamp: number): string => {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d`
  return `${Math.round(days / 7)}w`
}

/** A one-line preview: markdown syntax is noise at this size, so strip it. */
const plainText = (markdown: string): string =>
  markdown
    .replace(/```[\s\S]*?(```|$)/g, (block) => block.replace(/```\w*/g, '').trim())
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const previewOf = (thread: Thread): string => {
  const answer = thread.messages.find(
    (message) => message.role === 'assistant' && (message.text || message.error),
  )
  if (answer?.error) return answer.error
  return plainText(answer?.text ?? '').slice(0, 140)
}

export interface HistoryListProps {
  items: readonly Thread[]
  /** -1 when nothing is highlighted. The parent owns this. */
  selectedIndex: number
  onSelect: (thread: Thread) => void
  onDelete: (thread: Thread) => void
  /** Rendered when `items` is empty. Omit to render nothing at all. */
  emptyLabel?: ReactNode
}

/**
 * Keyboard-navigable thread list, used for both the filtered suggestions and the recents.
 * Focus stays in the query field, so this only reflects `selectedIndex` and keeps the
 * highlighted row in view.
 */
export function HistoryList({
  items,
  selectedIndex,
  onSelect,
  onDelete,
  emptyLabel,
}: HistoryListProps) {
  const rows = useRef<(HTMLDivElement | null)[]>([])
  const scroller = useRef<HTMLDivElement | null>(null)

  /*
   * Keep the highlighted row in view, scroll and highlight landing in the same frame —
   * otherwise arrowing past the edge of the list reads as two events.
   *
   * 1. Layout effect, not effect: a passive one lands after the browser has painted the
   *    new highlight, giving the old scroll position a frame of its own.
   * 2. A row that travels with the scroll arrives mid-fade, and so unhighlighted.
   *    `data-snap` drops the background transition and the forced style flush settles the
   *    highlight before it comes back off. A move that does not scroll keeps its fade.
   */
  useLayoutEffect(() => {
    const list = scroller.current
    const row = rows.current[selectedIndex]
    if (!list || !row) return
    const from = list.scrollTop
    row.scrollIntoView({ block: 'nearest' })
    if (list.scrollTop === from) return
    list.dataset.snap = ''
    void row.offsetHeight
    delete list.dataset.snap
  }, [selectedIndex])

  /*
   * While the arrows are driving, a hover fill parked under the pointer reads as a second
   * cursor, so `data-keys` drops the hover states until the pointer moves again. The
   * movement is measured rather than taken on faith: scrolling rows under a still cursor
   * synthesises a pointermove, which would clear the flag on the keypress that set it.
   */
  useEffect(() => {
    const at = { x: -1, y: -1 }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      if (scroller.current) scroller.current.dataset.keys = ''
    }
    const onPointerMove = (event: PointerEvent) => {
      if (event.clientX === at.x && event.clientY === at.y) return
      at.x = event.clientX
      at.y = event.clientY
      if (scroller.current) delete scroller.current.dataset.keys
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointermove', onPointerMove)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointermove', onPointerMove)
    }
  }, [])

  if (items.length === 0) {
    return emptyLabel ? <div className="pa-empty">{emptyLabel}</div> : null
  }

  return (
    <div className="pa-list pa-fade-in" ref={scroller}>
      {items.map((thread, index) => {
        const selected = index === selectedIndex
        const preview = previewOf(thread)
        return (
          <div
            key={thread.id}
            className={selected ? 'pa-list-item is-selected' : 'pa-list-item'}
            ref={(node) => {
              rows.current[index] = node
            }}
          >
            <button
              className="pa-list-main"
              type="button"
              aria-current={selected}
              onClick={() => onSelect(thread)}
            >
              <span className="pa-list-content">
                <span className="pa-list-title">{thread.title}</span>
                {preview ? <span className="pa-list-preview">{preview}</span> : null}
              </span>
              <span className="pa-list-meta">{relativeTime(thread.updatedAt)}</span>
            </button>
            <button
              className="pa-icon-btn"
              type="button"
              /* Out of the tab order: it is only visible under the pointer. The keyboard
                 route is ⌘⌫ on the highlighted row, bound in pages/launcher.tsx. */
              tabIndex={-1}
              aria-label={`Delete ${thread.title}`}
              onClick={(event) => {
                event.stopPropagation()
                onDelete(thread)
              }}
            >
              <CloseIcon />
            </button>
          </div>
        )
      })}
    </div>
  )
}
