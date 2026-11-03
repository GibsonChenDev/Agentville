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
- `.github/workflows/release.yml` — push a tag `vX.Y.Z` to build the universal macOS `.dmg` and the Windows `-setup.exe` and attach them to the GitHub release for that tag (a draft is created if none exists; see "Releasing a new version" below). To rebuild one platform for an existing tag: Actions → Release → Run workflow → enter the tag and choose `macos` or `windows`.

## Releasing a new version

1. **Bump the app version first** — in one PR, set the same `X.Y.Z` in `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml` (and the `agentville` entry of `Cargo.lock`), `apps/desktop/package.json`, the root `package.json` and the two matching entries of `package-lock.json`. The installers, the version in Settings and Windows' upgrade check all use this number, not the tag.
2. Merge it, then tag that commit on `main`: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. The release gets `Agentville_universal.dmg` and `Agentville_x64-setup.exe`. File names carry no version, so `https://github.com/GibsonChenDev/Agentville/releases/latest/download/Agentville_universal.dmg` (and `…_x64-setup.exe`) always downloads the newest build.

A tag pushed before the bump builds installers that call themselves the previous version. To redo it: delete that release's assets, move the tag to the bumped commit (`git tag -f vX.Y.Z <commit> && git push -f origin vX.Y.Z`), and the workflow rebuilds and uploads to the same release.

## Updating an installed app

- **macOS**: quit Agentville, open the new `.dmg` and drag `Agentville.app` into Applications → **Replace**. macOS doesn't compare versions. Your character, coins, layouts and history stay: they live under the identifier `com.agentville.desktop` (`~/Library/Application Support/com.agentville.desktop` and the matching web data), which never changes. Unsigned builds need right-click → Open (or System Settings → Privacy & Security → Open Anyway) once per download.
- **Windows**: run the new `-setup.exe`. The per-user installer finds the existing install by its identifier. A **newer** version offers "uninstall before installing" (the default) and keeps your data in `%APPDATA%` / `%LOCALAPPDATA%\com.agentville.desktop`; the **same** version offers reinstall or uninstall; an **older** one warns that a newer version is installed. Close Agentville first (the installer asks if it's running). Unsigned builds show SmartScreen → More info → Run anyway.
- There's no auto-updater yet; users download the new installer themselves.

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
