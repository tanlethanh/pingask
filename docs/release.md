# Release runbook

Signing, notarization and auto-update. These steps need credentials that only the maintainer has, so
they are documented rather than scripted into CI.

## One-time: updater signing keys

```bash
bunx tauri signer generate -w ~/.tauri/pingask.key
```

Keep the private key out of the repo. Put the **public** key into `src-tauri/tauri.conf.json` under
`plugins.updater.pubkey`, and expose the private key to builds as:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/pingask.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="…"
```

## One-time: Apple credentials

Requires a paid Apple Developer account.

1. Create a **Developer ID Application** certificate and install it in the login keychain.
2. Create an app-specific password at appleid.apple.com.
3. Export for the build:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
```

Tauri notarizes automatically when `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` are all present.

## Build

```bash
bun run check && bun test
bun run build           # -> src-tauri/target/release/bundle/{macos,dmg}
```

Verify before shipping:

```bash
codesign -dv --verbose=4 "src-tauri/target/release/bundle/macos/Pingask.app"
spctl -a -vvv -t install "src-tauri/target/release/bundle/macos/Pingask.app"
xcrun stapler validate "src-tauri/target/release/bundle/macos/Pingask.app"
```

`spctl` must say **accepted / Notarized Developer ID**. If it says "rejected", notarization did not
complete — check `xcrun notarytool log`.

## Update feed

The updater reads a static JSON manifest. Publish it anywhere with HTTPS (a GitHub release asset is
fine) and point `plugins.updater.endpoints` at it:

```json
{
  "version": "2.0.1",
  "notes": "…",
  "pub_date": "2026-09-05T00:00:00Z",
  "platforms": {
    "darwin-aarch64": { "signature": "<contents of the .sig file>", "url": "https://…/Pingask.app.tar.gz" },
    "darwin-x86_64":  { "signature": "…", "url": "https://…/Pingask.app.tar.gz" }
  }
}
```

The `.sig` files are emitted next to the bundles when `TAURI_SIGNING_PRIVATE_KEY` is set.

## Checklist

- [ ] `bun run check` and `bun test` clean
- [ ] Version bumped in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`
- [ ] `spctl` reports Notarized Developer ID
- [ ] Manifest published and reachable over HTTPS
- [ ] Fresh-machine install opens without a Gatekeeper warning
