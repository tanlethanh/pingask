import { AppProvider, useApp } from './app-context.tsx'
import { LauncherPage } from './pages/launcher.tsx'
import { SettingsPage } from './pages/settings.tsx'
import { ThreadPage } from './pages/thread.tsx'

/**
 * Whichever page the shell's state adds up to. Each page reads what it needs from the
 * shell and owns the rest itself, so leaving a page is never followed by a line resetting
 * what it had — unmounting is how that state is cleared.
 */
function CurrentPage() {
  const { page } = useApp()
  if (page === 'settings') return <SettingsPage />
  if (page === 'thread') return <ThreadPage />
  return <LauncherPage />
}

export function App() {
  return (
    <AppProvider>
      <CurrentPage />
    </AppProvider>
  )
}
