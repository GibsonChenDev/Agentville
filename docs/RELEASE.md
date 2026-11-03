# Release & distribution

Agentville installs on **macOS 12+** and **Windows 10/11**. The only external requirement is Claude Code itself, which the app can install with Anthropic's official installer on first launch (Claude Code is not bundled — it's Anthropic's software and keeps itself updated).

## Build locally

```bash
npm install
# macOS (Apple Silicon + Intel)
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run tauri build -- --target universal-apple-darwin --bundles app,dmg
# Windows (run on Windows)
npm run tauri build -- --bundles nsis
```

Outputs: `apps/desktop/src-tauri/target/**/bundle/dmg/*.dmg`, `…/bundle/nsis/*-setup.exe`.

- Windows installer: per-user install (no administrator rights), English/繁體中文 language selector, downloads the WebView2 runtime if it's missing (it ships with Windows 10/11).
- No Node.js or other runtime is bundled or required: the hook receiver is built into the app.

## Automated builds

- `.github/workflows/ci.yml` — on every push/PR: typecheck, unit tests, i18n check, Rust tests and a production build, on both macOS and Windows runners.
- `.github/workflows/release.yml` — push a tag `vX.Y.Z` to build the universal macOS `.dmg` and the Windows `-setup.exe` and attach them to the GitHub release for that tag (a draft is created if none exists). To rebuild one platform for an existing tag: Actions → Release → Run workflow → enter the tag and choose `macos` or `windows`.

## Code signing (needed before giving the app to others)

Unsigned builds trigger warnings: macOS Gatekeeper ("developer cannot be verified" → right-click → Open) and Windows SmartScreen ("More info → Run anyway").

**macOS** — not configured yet (releases are unsigned). When you have an Apple Developer Program membership (US$99/year):
1. Create a "Developer ID Application" certificate and export it as a `.p12`.
2. Add repository secrets: `APPLE_CERTIFICATE` (the `.p12` encoded with `base64 -i cert.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific password), `APPLE_TEAM_ID`.
3. In `.github/workflows/release.yml`, add those six as `env:` entries (`${{ secrets.NAME }}`) on the macOS job's tauri-action step. Only do this after the secrets exist — empty values make the build fail with "SecKeychainItemImport: Unable to decode the provided data".

**Windows** — an OV/EV code-signing certificate or Azure Trusted Signing. Configure `bundle.windows.certificateThumbprint` (local certificate) or a `signCommand` in `tauri.conf.json`, following https://v2.tauri.app/distribute/sign/windows/.

## Uninstall

1. Agentville → Settings → Monitoring setup → Advanced → **Remove hooks** (restores Claude Code's settings; a backup was written on install).
2. macOS: quit and move `Agentville.app` to the Trash. Windows: Settings → Apps → Agentville → Uninstall.
3. Optional — delete local data (settings, customizations, 14-day history):
   - macOS: `~/Library/Application Support/com.agentville.desktop/`
   - Windows: `%APPDATA%\com.agentville.desktop\`
