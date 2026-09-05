# pingask.app landing

Static HTML/CSS/JS, built with Vite, deployed to Vercel at **pingask.app**.

```bash
bun install
bun run dev      # http://localhost:5173
bun run build    # -> dist/
```

## Files

| Path | Why |
|---|---|
| `index.html` | The whole page. SEO meta, OpenGraph, `SoftwareApplication` + `FAQPage` JSON-LD. |
| `src/style.css` | Dark theme matching the app panel. Flat surfaces, hairlines, no gradients or glows. No webfonts, system stack only. |
| `src/main.js` | Resolves the latest DMG from the GitHub Releases API, picks arm64 vs x64, copy button. |
| `public/install.sh` | Canonical installer, served at `pingask.app/install.sh`. |
| `public/demo.png` | Hero screenshot: the panel alone, trimmed off its plate with transparent rounded corners (34px radius at 2x). Replace it the same way, and update the `width`/`height` in `index.html` to match. |
| `vercel.json` | `text/plain` for the install script, immutable asset caching, security headers. |

## Deploy

1. `vercel link` in this directory (or import the repo in the dashboard and set **Root Directory** to `landing`).
2. Framework preset: **Vite**. Build `vite build`, output `dist`. Already in `vercel.json`.
3. Add the domain `pingask.app` (and `www.pingask.app` redirecting to it) under Project → Domains, then point DNS at Vercel.
4. Verify `curl -fsSL pingask.app/install.sh | head` returns the script as plain text, not HTML.

## Keywords targeted

Primary: *AI Spotlight for Mac*, *Mac AI launcher*, *ask AI with a keyboard shortcut*, *Raycast AI alternative*, *open source macOS AI app*.
Secondary: *bring your own API key*, *ChatGPT / Claude / OpenRouter / Ollama on Mac*, *no subscription*, *local, no telemetry*.
They appear in the title, H1, lede, feature headings and FAQ answers. The FAQ is the keyword surface, which is why it is also marked up as `FAQPage`.
