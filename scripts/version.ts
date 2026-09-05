// The app version lives in four files that must never drift apart. Run with no
// argument to print the version (exit 1 if they disagree), or with a version to
// rewrite them all. CI uses the read mode to prove a pushed tag matches the tree.

const files = [
  { path: 'package.json', find: /^(\s*"version":\s*")([^"]+)(")/m },
  { path: 'src-tauri/tauri.conf.json', find: /^(\s*"version":\s*")([^"]+)(")/m },
  { path: 'src-tauri/Cargo.toml', find: /^(version = ")([^"]+)(")/m },
  // The lockfile carries the crate's own version, and CI builds with --locked.
  { path: 'src-tauri/Cargo.lock', find: /^(name = "pingask"\nversion = ")([^"]+)(")/m },
] as const

const next = process.argv[2]

if (next && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(next)) {
  console.error(`not a semver version: ${next}`)
  process.exit(1)
}

const current = await Promise.all(
  files.map(async (file) => {
    const source = await Bun.file(file.path).text()
    const version = source.match(file.find)?.[2]
    if (!version) {
      console.error(`no version field in ${file.path}`)
      process.exit(1)
    }
    return { source, version }
  }),
)

if (next) {
  await Promise.all(
    files.map((file, i) =>
      Bun.write(file.path, current[i]!.source.replace(file.find, `$1${next}$3`)),
    ),
  )
  console.log(next)
  process.exit(0)
}

const version = current[0]!.version
if (current.some((file) => file.version !== version)) {
  for (const [i, file] of current.entries()) console.error(`${files[i]!.path}: ${file.version}`)
  console.error('version mismatch — run `bun run version <x.y.z>`')
  process.exit(1)
}

console.log(version)
