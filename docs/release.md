# Release runbook

Releases are built by GitHub Actions from a pushed tag. `.github/workflows/release.yml` builds a
universal macOS bundle, signs and notarizes it, then publishes the DMG, the updater `.tar.gz` and
`latest.json` to a GitHub release. The one-time credential setup below is manual because it needs an
Apple Developer account and a private key that never enters the repo.

## Ship a version

```bash
bun run version 0.2.0            # rewrites package.json, Cargo.toml, Cargo.lock, tauri.conf.json
git commit -am "release: 0.2.0"
git tag -a v0.2.0 -m "v0.2.0"      # annotated, so --follow-tags pushes it
git push --follow-tags
```

The workflow refuses to build if the tag does not match the version in the tree, so bump first.
A tag with a hyphen (`v0.3.0-beta.1`) is published as a prerelease, which keeps it out of
`releases/latest` and therefore out of the updater feed.

Run the workflow manually (Actions → Release → Run workflow) to build and sign without publishing —
the bundles land as workflow artifacts.

## CI

`.github/workflows/ci.yml` runs on every push to `main`/`v2` and every PR:

| Job | What it proves |
| --- | --- |
| `app` | Versions in lockstep, `bun run check`, `bun test`, frontend bundles |
| `rust` | `cargo check --locked` on macOS, the release target |
| `landing` | The marketing site still builds |

## One-time: updater signing keys

```bash
bunx tauri signer generate -w ~/.tauri/pingask.key
```

Keep the private key out of the repo. Put the **public** key into `src-tauri/tauri.conf.json` under
`plugins.updater.pubkey`, and the private key into the repo secrets (below). For a local build:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/pingask.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="…"
```

## One-time: Apple credentials

Requires a paid Apple Developer account. Signing and notarization use separate credentials: a
Developer ID certificate signs, an App Store Connect API key notarizes.

1. Create a **Developer ID Application** certificate and install it in the login keychain.
2. Export it as a `.p12` with a password: Keychain Access → **login** → **My Certificates** →
   right-click the certificate → Export.
3. App Store Connect → **Users and Access** → **Integrations** → **App Store Connect API** → generate
   a team key with the **Developer** role. Note the **Key ID** and **Issuer ID**, and download the
   `.p8` — Apple serves it exactly once.

The API key is preferred over an Apple ID plus app-specific password: it is not tied to a personal
account, and revoking it does not touch anything else. Tauri accepts either
(`APPLE_ID` + `APPLE_PASSWORD` + `APPLE_TEAM_ID`, or the API key trio) and picks the Apple ID pair
first if both are present.

For a local build, export the identity instead of the `.p12`:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_TEAM_ID="TEAMID"
export APPLE_API_KEY="KEYID"
export APPLE_API_ISSUER="issuer-uuid"
export APPLE_API_KEY_PATH="$HOME/private/AuthKey_KEYID.p8"
```

Tauri notarizes automatically once those are present and the bundle is signed.

## One-time: repository secrets

Settings → Secrets and variables → Actions:

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `~/.tauri/pingask.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its passphrase (empty string if none) |
| `APPLE_CERTIFICATE` | `base64 -i cert.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` export password |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_TEAM_ID` | 10-character team ID |
| `APPLE_API_KEY` | App Store Connect **Key ID** |
| `APPLE_API_ISSUER` | App Store Connect **Issuer ID** (a UUID) |
| `APPLE_API_KEY_P8` | contents of the downloaded `AuthKey_<KEYID>.p8` |

`TAURI_SIGNING_PRIVATE_KEY` is required — without it the build cannot produce an update signature and
the workflow fails early. The Apple secrets are optional: the workflow warns and ships an unsigned
bundle, which Gatekeeper blocks on any machine but the build machine. The bundler imports the `.p12`
into a throwaway keychain itself, so no `import-codesign-certs` step is needed; the workflow writes
`APPLE_API_KEY_P8` to a file under `RUNNER_TEMP` because the notarizer wants a path, and deletes it
when the job ends.

## Local build

```bash
bun run check && bun test
bun run build           # -> src-tauri/target/release/bundle/{macos,dmg}
```

Verify before shipping:

```bash
codesign -dv --verbose=4 "src-tauri/target/release/bundle/macos/PingAsk.app"
spctl -a -vvv -t install "src-tauri/target/release/bundle/macos/PingAsk.app"
xcrun stapler validate "src-tauri/target/release/bundle/macos/PingAsk.app"
```

`spctl` must say **accepted / Notarized Developer ID**. If it says "rejected", notarization did not
complete — check `xcrun notarytool log`. The release workflow runs these same three checks against
the universal bundle and fails the run if any of them does.

## Update feed

The updater reads `latest.json`, published as an asset on every release and served from
`https://github.com/tanlethanh/pingask/releases/latest/download/latest.json` — the endpoint already
in `plugins.updater.endpoints`. The workflow generates it:

```json
{
  "version": "0.2.0",
  "notes": "…",
  "pub_date": "2026-09-05T00:00:00Z",
  "platforms": {
    "darwin-aarch64": { "signature": "<contents of the .sig file>", "url": "https://…/PingAsk.app.tar.gz" },
    "darwin-x86_64":  { "signature": "…", "url": "https://…/PingAsk.app.tar.gz" }
  }
}
```

Both keys point at the one universal `.tar.gz`. The updater looks up `darwin-{arch}` exactly and has
no `darwin-universal` fallback, which is why both entries exist.

## Checklist

- [ ] `bun run version <x.y.z>` committed, tag pushed
- [ ] Release workflow green
- [ ] `spctl` step reports Notarized Developer ID
- [ ] `latest.json` reachable at the endpoint above
- [ ] Fresh-machine install opens without a Gatekeeper warning
