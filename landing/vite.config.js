import { defineConfig } from 'vite'

// Static site: one HTML entry, assets in public/ served from the root so
// pingask.app/install.sh keeps working.
export default defineConfig({
  build: { outDir: 'dist', assetsDir: 'assets' },
  server: { port: 5173 },
})
