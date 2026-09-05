const REPO = 'tanlethanh/pingask'

/** Apple GPU string is the only honest signal a browser gives about Apple Silicon. */
const isAppleSilicon = () => {
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ''
    return /apple\s*m\d|apple gpu/i.test(String(renderer))
  } catch {
    return true
  }
}

const dmgFor = (assets, arch) =>
  assets.find((a) => a.name.endsWith('.dmg') && a.name.includes(arch))?.browser_download_url

const CHECK =
  '<svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true"><path d="m2.5 7.4 3 3 6-6.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'

const copy = document.getElementById('copy')
if (copy) {
  const icon = copy.innerHTML
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById('curlcmd').textContent.trim())
      copy.innerHTML = CHECK
      copy.classList.add('done')
      setTimeout(() => {
        copy.innerHTML = icon
        copy.classList.remove('done')
      }, 1600)
    } catch {
      copy.setAttribute('aria-label', 'Copy it by hand, the clipboard is blocked here')
    }
  })
}
// Point the buttons at the real asset when GitHub answers; the markup already links to
// the releases page, so a rate limit or an offline visitor still gets a working button.
;(async () => {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`).catch(() => null)
  if (!res?.ok) return

  const { tag_name: tag, assets = [] } = await res.json()
  // Releases ship one universal DMG; the per-arch lookups stay as a fallback in case a
  // future build splits them again.
  const universal = dmgFor(assets, 'universal')
  const arm = universal ?? dmgFor(assets, 'aarch64')
  const intel = universal ?? dmgFor(assets, 'x64')
  const preferred = (isAppleSilicon() ? arm : intel) ?? arm ?? intel
  if (!preferred) return

  for (const id of ['download', 'download2']) {
    const el = document.getElementById(id)
    if (el) el.href = preferred
  }

  const other = preferred === arm ? intel : arm
  const meta = document.getElementById('dlmeta')
  if (!meta) return
  const label = universal ? 'Apple Silicon & Intel' : preferred === arm ? 'Apple Silicon' : 'Intel'
  meta.textContent = `${tag ? `${tag} · ` : ''}${label} · macOS 11+ · free, MIT`
  if (other && other !== preferred) {
    meta.insertAdjacentHTML(
      'beforeend',
      ` · <a href="${other}">${preferred === arm ? 'Intel' : 'Apple Silicon'} build</a>`,
    )
  }
})()
