import { useApp } from '../app-context.tsx'
import { modelSupportsThinking } from '../core/ask/options.ts'
import { getProvider, listProviders } from '../core/providers/registry.ts'
import type { ProviderId } from '../core/providers/types.ts'
import { useShortcuts } from '../hooks/use-shortcuts.ts'
import { useVersion } from '../hooks/use-version.ts'
import { confirmDestructive, quit } from '../platform/index.ts'
import { Footer } from '../ui/footer.tsx'
import { SettingsPanel } from '../ui/settings/panel.tsx'
import { Spotlight } from '../ui/spotlight.tsx'

/**
 * Settings. No query field, so the panel's header slot is empty and the sheet's own head
 * carries the window drag region instead. Both confirmations live here because both are
 * this page's actions: nothing else in the app disconnects a provider or quits.
 */
export function SettingsPage() {
  const app = useApp()
  const { credentials, models, settings } = app
  const version = useVersion()

  // Esc belongs to the recorder while it is capturing — it cancels the chord there.
  useShortcuts([{ key: 'Escape', when: !app.recordingHotkey, run: app.closeSettings }])

  // Throws away a stored credential — a key to fetch again, or a sign-in to redo. The
  // icon buttons carry no colour to warn about that, so the confirmation does.
  const disconnectProvider = async (id: ProviderId) => {
    const provider = getProvider(id)
    const isKey = provider.auth.kind === 'apiKey'
    const ok = await confirmDestructive({
      title: isKey ? `Remove ${provider.label} API key?` : `Disconnect ${provider.label}?`,
      message: isKey
        ? 'The key is deleted from auth.json. You will need to paste it again to use this provider.'
        : 'The stored sign-in is deleted. You will need to connect again to use this provider.',
      okLabel: isKey ? 'Remove' : 'Disconnect',
    })
    if (ok) await credentials.disconnect(id)
  }

  // The one way out that Esc and the global shortcut do not offer — both only hide the
  // window. The button sits where the gear does, so muscle memory must not end a session
  // that is mid-answer.
  const quitApp = async () => {
    const ok = await confirmDestructive({
      title: 'Quit Pingask?',
      message: 'The app closes and the global shortcut stops working until you open it again.',
      okLabel: 'Quit',
    })
    if (ok) await quit()
  }

  return (
    <Spotlight
      page="settings"
      input={null}
      body={
        <SettingsPanel
          keybinding={settings.keybinding}
          onKeybindingChange={(accelerator) => void app.save({ keybinding: accelerator })}
          onRecordingChange={app.setRecordingHotkey}
          models={models.options}
          selectedModel={models.active}
          onSelectModel={(ref) => void app.save({ model: ref })}
          thinking={settings.thinking}
          onThinkingChange={(on) => void app.save({ thinking: on })}
          thinkingSupported={
            models.active !== undefined && modelSupportsThinking(models.models, models.active)
          }
          providers={listProviders()}
          credentials={credentials.credentials}
          onConnect={(id: ProviderId, apiKey?: string) => void credentials.connect(id, apiKey)}
          onDisconnect={(id: ProviderId) => void disconnectProvider(id)}
          busyProviderId={credentials.busyProviderId}
          error={credentials.error}
          onClose={app.closeSettings}
        />
      }
      footer={
        <Footer
          hints={[{ keys: ['esc'], label: 'back' }]}
          version={version}
          onQuit={() => void quitApp()}
        />
      }
      onHeightChange={app.onHeightChange}
    />
  )
}
