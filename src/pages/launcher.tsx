import { type CSSProperties, type KeyboardEvent, useCallback, useState } from 'react'
import { useApp } from '../app-context.tsx'
import type { Thread } from '../core/threads/model.ts'
import type { Removed } from '../core/threads/repository.ts'
import { useQueryFocus } from '../hooks/use-query-focus.ts'
import { useShortcuts } from '../hooks/use-shortcuts.ts'
import { Footer } from '../ui/footer.tsx'
import { keyHints } from '../ui/hints.ts'
import { HistoryList } from '../ui/history-list.tsx'
import { Input } from '../ui/input.tsx'
import { ModelPicker } from '../ui/model-picker.tsx'
import { Spotlight } from '../ui/spotlight.tsx'

/**
 * The panel at rest: ask something, or pick up a thread from the recents.
 *
 * The highlighted row and the undo stack are this page's own — neither means anything
 * anywhere else, and unmounting is what clears them.
 *
 * Capped shorter than the other pages (.pa-panel--launcher): 640 is sized for content you
 * sit and read, and a list of one-line rows filling it made the window a wall.
 */
export function LauncherPage() {
  const app = useApp()
  const { ask, models, threads, question, inputRef } = app
  const { searching } = threads

  /** -1 when nothing is highlighted. */
  const [selectedIndex, setSelectedIndex] = useState(-1)
  /**
   * Deletions waiting to be undone, newest last. An undo offered after the panel has been
   * away and come back is a surprise rather than a safety net, and this page not
   * outliving that visit is what guarantees it.
   */
  const [undoable, setUndoable] = useState<Removed[]>([])

  const list = searching ? threads.suggestions : threads.recent

  // Streaming disables the field, which drops focus, so re-take it when the turn ends.
  useQueryFocus(inputRef, !ask.streaming)

  // Typing invalidates the highlighted row, so the two move together rather than through
  // an effect that watches `question`.
  const changeQuestion = (value: string) => {
    app.setQuestion(value)
    setSelectedIndex(-1)
  }

  const openThread = useCallback(
    (thread: Thread) => {
      ask.open(thread)
      app.setQuestion('')
      app.goToThread()
      inputRef.current?.focus()
    },
    [ask.open, app.setQuestion, app.goToThread, inputRef],
  )

  const deleteThread = (thread: Thread) => {
    void threads.remove(thread).then((removed) => {
      if (removed) setUndoable((stack) => [...stack, removed])
    })
    // Keep the highlight on a row that still exists.
    const remaining = list.length - 1
    setSelectedIndex((index) => (remaining <= 0 ? -1 : Math.min(index, remaining - 1)))
  }

  const undoDelete = () => {
    const last = undoable.at(-1)
    if (!last) return
    setUndoable((stack) => stack.slice(0, -1))
    void threads.restore(last)
  }

  useShortcuts([
    // ⌘⌫ only bites while a row is highlighted: in a text field it means
    // delete-to-line-start, and a highlighted row is the signal that the list, not the
    // field, is what the user is working in.
    {
      key: 'Backspace',
      meta: true,
      when: selectedIndex >= 0,
      run: () => {
        const thread = list[selectedIndex]
        if (thread) deleteThread(thread)
      },
    },
    // ⌘Z is the field's own undo whenever the field has content; thread-undo only claims
    // it when there is nothing typed to undo instead.
    {
      key: 'z',
      meta: true,
      when: question.length === 0 && undoable.length > 0,
      run: undoDelete,
    },
    // Nothing left to back out of: Esc closes the window.
    { key: 'Escape', run: () => void app.dismiss() },
  ])

  const onQuestionKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (list.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((index) => Math.min(index + 1, list.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((index) => Math.max(index - 1, -1))
    } else if (event.key === 'Enter' && selectedIndex >= 0) {
      const thread = list[selectedIndex]
      if (thread) {
        event.preventDefault()
        openThread(thread)
      }
    }
  }

  const submit = () => {
    const highlighted = selectedIndex >= 0 ? list[selectedIndex] : undefined
    if (highlighted) {
      openThread(highlighted)
      return
    }
    // ask() bails on an empty question and on a second Enter mid-turn; navigating on
    // either would leave the panel showing a thread page with nothing in it.
    if (!searching || ask.streaming) return

    const text = question
    app.setQuestion('')
    void ask.ask(text)
    // With no model resolved, ask() only records an error — there is no turn to read, so
    // this stays where it is and the footer's warning keeps saying why.
    if (models.active) app.goToThread()
  }

  return (
    <Spotlight
      page="launcher"
      input={
        <Input
          ref={inputRef}
          value={question}
          onChange={changeQuestion}
          onSubmit={submit}
          onKeyDown={onQuestionKeyDown}
          disabled={ask.streaming}
          placeholder="Ask anything…"
        />
      }
      body={
        <div
          className="pa-listbox"
          /*
           * Hold the idle list's footprint while the query narrows it, so the OS window
           * stops resizing on every keystroke — but not once the query matches nothing,
           * where the reserve would hold open an empty box.
           */
          data-reserve={searching && list.length > 0 ? '' : undefined}
          style={{ '--pa-rows': threads.recent.length } as CSSProperties}
        >
          <HistoryList
            items={list}
            selectedIndex={selectedIndex}
            onSelect={openThread}
            onDelete={deleteThread}
            // Not "No matching threads": nothing matching is the normal state on the way
            // to asking something new, so the row names the key that does it.
            emptyLabel={
              searching ? (
                <>
                  Enter <kbd className="pa-kbd pa-kbd--lg">⏎</kbd> to ask in new thread
                </>
              ) : undefined
            }
          />
        </div>
      }
      footer={
        <Footer
          hints={keyHints({
            streaming: ask.streaming,
            hasTranscript: false,
            typing: searching,
            rowSelected: selectedIndex >= 0,
            canUndo: undoable.length > 0,
          })}
          model={
            <ModelPicker
              models={models.options}
              selected={models.active}
              label={models.activeLabel}
              onSelect={(ref) => void app.save({ model: ref })}
              onDone={() => inputRef.current?.focus()}
            />
          }
          onOpenSettings={app.openSettings}
          warning={app.providerWarning}
        />
      }
      onHeightChange={app.onHeightChange}
    />
  )
}
