import { marked } from 'marked'
import { useMemo } from 'react'
import type { Message as MessageModel } from '../core/threads/model.ts'
import { AlertIcon } from './icons.tsx'

/*
 * Markdown → sanitized HTML.
 *
 * `marked` does not sanitize (the option was removed in v5) and there is no DOMPurify
 * here, so the allowlist below is the whole defence: everything the parser can emit is
 * kept, everything else is unwrapped or dropped, and every attribute is named explicitly.
 */

const ALLOWED_TAGS = new Set([
  'A',
  'BLOCKQUOTE',
  'BR',
  'CODE',
  'DEL',
  'EM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HR',
  'LI',
  'OL',
  'P',
  'PRE',
  'STRONG',
  'TABLE',
  'TBODY',
  'TD',
  'TH',
  'THEAD',
  'TR',
  'UL',
])

/** Removed outright, contents and all. Anything else unknown is just unwrapped. */
const DROPPED_TAGS = new Set([
  'AUDIO',
  'BASE',
  'BUTTON',
  'EMBED',
  'FORM',
  'IFRAME',
  'IMG',
  'INPUT',
  'LINK',
  'MATH',
  'META',
  'NOSCRIPT',
  'OBJECT',
  'SCRIPT',
  'SELECT',
  'STYLE',
  'SVG',
  'TEMPLATE',
  'TEXTAREA',
  'VIDEO',
])

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(['href', 'title']),
  CODE: new Set(['class']),
  TD: new Set(['align']),
  TH: new Set(['align']),
}

const SAFE_HREF = /^(https?:\/\/|mailto:|#)/i
const LANGUAGE_CLASS = /^language-[\w+#.-]*$/

const scrub = (root: Element): void => {
  for (const el of Array.from(root.children)) {
    if (DROPPED_TAGS.has(el.tagName)) {
      el.remove()
      continue
    }

    scrub(el)

    if (!ALLOWED_TAGS.has(el.tagName)) {
      const parent = el.parentNode
      if (parent) while (el.firstChild) parent.insertBefore(el.firstChild, el)
      el.remove()
      continue
    }

    const allowed = ALLOWED_ATTRS[el.tagName]
    for (const name of el.getAttributeNames()) {
      if (!allowed?.has(name)) el.removeAttribute(name)
    }

    if (el.tagName === 'CODE') {
      const cls = el.getAttribute('class')
      if (cls !== null && !LANGUAGE_CLASS.test(cls)) el.removeAttribute('class')
    }

    if (el.tagName === 'A') {
      const href = el.getAttribute('href')?.trim() ?? ''
      if (SAFE_HREF.test(href)) {
        // The webview cannot navigate away from the app, so use-panel-window.ts
        // intercepts clicks on [data-external] and hands the href to the OS opener.
        el.setAttribute('data-external', 'true')
        el.setAttribute('rel', 'noreferrer noopener')
        el.setAttribute('target', '_blank')
      } else {
        el.removeAttribute('href')
      }
    }
  }
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Stop descending here — a caret inside these would inherit the wrong box. */
const CARET_STOP = new Set(['A', 'CODE', 'HR', 'PRE', 'TABLE'])

/** Trailing "\n" text nodes between blocks are not content — skip them. */
const lastMeaningfulChild = (node: Node): ChildNode | null => {
  let child = node.lastChild
  while (child && child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim() === '') {
    child = child.previousSibling
  }
  return child
}

/** Park the blinking caret at the end of the last line rather than on its own row. */
const appendCaret = (body: HTMLElement): void => {
  let target: Element = body
  for (;;) {
    const last = lastMeaningfulChild(target)
    if (!last || last.nodeType !== Node.ELEMENT_NODE) break
    const element = last as Element
    if (CARET_STOP.has(element.tagName)) break
    target = element
  }
  const caret = body.ownerDocument.createElement('span')
  caret.className = 'pa-caret'
  target.appendChild(caret)
}

export const renderMarkdown = (text: string, caret = false): string => {
  if (typeof DOMParser === 'undefined') return escapeHtml(text)
  const html = marked(text, { async: false, gfm: true, breaks: true })
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  scrub(doc.body)
  if (caret) appendCaret(doc.body)
  return doc.body.innerHTML
}

export interface MessageProps {
  message: MessageModel
  /** Draw the caret after the text — this turn is still arriving. */
  streaming?: boolean
}

/** One conversation turn. */
export function Message({ message, streaming = false }: MessageProps) {
  const html = useMemo(
    () =>
      message.role === 'assistant' && !message.error ? renderMarkdown(message.text, streaming) : '',
    [message.role, message.text, message.error, streaming],
  )

  if (message.error) {
    return (
      <div className="pa-msg pa-msg--error">
        <div className="pa-msg-text">
          <AlertIcon className="pa-msg-error-icon" />
          <div className="pa-msg-error-body">
            <span>{message.error}</span>
            {/* The vendor's own words, verbatim and selectable — for copying into a bug
                report, not for reading twice. */}
            {message.errorDetail ? (
              <pre className="pa-error-detail">{message.errorDetail}</pre>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  if (message.role === 'user') {
    return (
      <div className="pa-msg pa-msg--user">
        <div className="pa-msg-text">{message.text}</div>
      </div>
    )
  }

  if (!message.text) {
    return (
      <div className="pa-msg pa-msg--assistant">
        <div className="pa-thinking">
          <span className="pa-spinner" />
          <span>Thinking…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="pa-msg pa-msg--assistant">
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: scrub() above is an allowlist sanitizer */}
      <div className="pa-md" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
