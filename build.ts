// Release bundle for Tauri. Assets must resolve relative to the tauri://localhost
// origin, hence publicPath './'. See PLAN.md spike S2.
import { rm } from 'node:fs/promises'

await rm('./dist', { recursive: true, force: true })

const result = await Bun.build({
  entrypoints: ['./index.html'],
  outdir: './dist',
  publicPath: './',
  minify: true,
  sourcemap: 'none',
  target: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' },
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

console.log(`built ${result.outputs.length} files -> dist/`)
