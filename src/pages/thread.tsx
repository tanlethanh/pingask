import { useApp } from '../app-context.tsx'
import { useQueryFocus } from '../hooks/use-query-focus.ts'
import { useShortcuts } from '../hooks/use-shortcuts.ts'
import { Footer } from '../ui/footer.tsx'
import { keyHints } from '../ui/hints.ts'
import { Input } from '../ui/input.tsx'
import { ModelPicker } from '../ui/model-picker.tsx'
import { Spotlight } from '../ui/spotlight.tsx'
import { Transcript } from '../ui/transcript.tsx'

/**
 * One conversation, with the field turned into a follow-up box. Keeps the full panel
 * height: this is a page you read, and the transcript scrolls inside it once it outgrows
 * the cap.
 */
export function ThreadPage() {
  const app = useApp()
  const { ask, models, question, inputRef } = app

  // Streaming disables the field, which drops focus, so re-take it when the turn ends.
  useQueryFocus(inputRef, !ask.streaming)

  useShortcuts([
    // Esc unwinds one layer at a time. A streaming turn is the layer above the thread, so
    // stopping it leaves the answer so far on screen and only a second press goes back.
    { key: 'Escape', when: ask.streaming, run: ask.abort },
    // Back to an empty panel rather than out of the window: the thread was persisted when
    // its answer landed, so it is already in the recents behind this.
    { key: 'Escape', run: app.freshen },
  ])

  const submit = () => {
    const text = question
    app.setQuestion('')
    void ask.ask(text)
  }

  return (
    <Spotlight
      page="thread"
      input={
        <Input
          ref={inputRef}
          value={question}
          onChange={app.setQuestion}
          onSubmit={submit}
          disabled={ask.streaming}
          placeholder="Ask a follow-up…"
        />
      }
      body={<Transcript messages={ask.thread.messages} streaming={ask.streaming} />}
      footer={
        <Footer
          hints={keyHints({ streaming: ask.streaming, hasTranscript: true })}
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
