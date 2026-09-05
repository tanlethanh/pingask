import { useEffect, useRef } from 'react'
import type { Message as MessageModel } from '../core/threads/model.ts'
import { Message } from './message.tsx'

/** How close to the bottom still counts as "pinned to the bottom". */
const STICK_SLACK = 28

export interface TranscriptProps {
  messages: readonly MessageModel[]
  /** The last assistant turn is still arriving — draw the caret, keep sticking. */
  streaming?: boolean
}

/** The conversation. Scrolls internally, sticks to the bottom while streaming. */
export function Transcript({ messages, streaming = false }: TranscriptProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  /** False as soon as the user scrolls up — auto-scroll must not fight them. */
  const stuck = useRef(true)

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const observer = new ResizeObserver(() => {
      if (!stuck.current) return
      const scroller = scrollerRef.current
      if (scroller) scroller.scrollTop = scroller.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  // A new turn re-arms the stick, so an answer always starts in view.
  useEffect(() => {
    stuck.current = true
    const scroller = scrollerRef.current
    if (!scroller || messages.length === 0) return
    scroller.scrollTop = scroller.scrollHeight
  }, [messages.length])

  const handleScroll = () => {
    const el = scrollerRef.current
    if (!el) return
    stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_SLACK
  }

  const lastIndex = messages.length - 1

  return (
    <div
      className="pa-transcript pa-fade-in"
      ref={scrollerRef}
      onScroll={handleScroll}
      role="log"
      aria-live="polite"
      aria-label="Conversation"
    >
      <div className="pa-transcript-inner" ref={contentRef}>
        {messages.map((message, index) => (
          <Message
            key={message.id}
            message={message}
            streaming={streaming && index === lastIndex && message.role === 'assistant'}
          />
        ))}
      </div>
    </div>
  )
}
