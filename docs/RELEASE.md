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

Release builds also produce signed update bundles (`.app.tar.gz` / `-setup.exe` plus `.sig`), so a local `tauri build` needs the updater key in the environment (see "In-app updates"):

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/agentville-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat ~/.tauri/agentville-updater.password)"
```

- Windows installer: per-user install (no administrator rights), English/繁體中文 language selector, downloads the WebView2 runtime if it's missing (it ships with Windows 10/11).
- No Node.js or other runtime is bundled or required: the hook receiver is built into the app.

## Automated builds

- `.github/workflows/ci.yml` — on every push/PR: typecheck, unit tests, i18n check, Rust tests and a production build, on both macOS and Windows runners.
- `.github/workflows/release.yml` — push a tag `vX.Y.Z` to build the universal macOS `.dmg` and the Windows `-setup.exe` and attach them to the GitHub release for that tag (a draft is created if none exists; see "Releasing a new version" below). To rebuild one platform for an existing tag: Actions → Release → Run workflow → enter the tag and choose `macos` or `windows`.

## Releasing a new version

The tag is the only thing a release needs. The release workflow (`scripts/release-prep.mjs`) sets the app version from the tag in `tauri.conf.json`, `Cargo.toml`/`Cargo.lock` and the `package.json` files before building, so they never need a bump PR. The installers, the version in Settings, Windows' upgrade check and the in-app updater all get the tag's number. The versions in the repository only name local and CI dev builds.

1. **Tag `main`**: `git tag vX.Y.Z && git push origin vX.Y.Z`, or create the release on GitHub with a new tag. Both start the build.
2. **Notes** (recommended): `docs/release-notes/vX.Y.Z.md` in English and 繁體中文 ([format](release-notes/README.md)). They become the GitHub release text and what the in-app update dialog shows, in the user's language. The workflow looks for the file on `main` first, then in the tagged commit. Without it, the notes list the commit subjects since the previous release (English only) and the run shows a warning. To add or fix notes after tagging, merge the file into `main` and run Actions → Release → Run workflow with the tag. No need to move the tag.
3. When both jobs are done, check the release (installers, `Agentville_universal.app.tar.gz`, the `.sig` files and `latest.json`). A release the workflow created is a draft: **Publish** it. Installed apps see the update from their next launch, and nothing reaches users while it's a draft. A release you created yourself on GitHub is already published, so its files go live as soon as they're uploaded. Until then, the "latest" download links below return 404.
4. The release gets `Agentville_universal.dmg` and `Agentville_x64-setup.exe`. File names carry no version, so `https://github.com/GibsonChenDev/Agentville/releases/latest/download/Agentville_universal.dmg` (and `…_x64-setup.exe`) always downloads the newest build.

Use a new version for every release people may already have installed. Updates only reach apps whose version is lower, so rebuilding a published version with new code never reaches anyone who already has it.

To rebuild an existing release (e.g. after a workflow fix), use Actions → Release → Run workflow on `main` with the tag. The workflow and notes come from `main`, the code from the tag. Files with the same names are replaced.

## Updating an installed app

- **macOS**: quit Agentville, open the new `.dmg` and drag `Agentville.app` into Applications → **Replace**. macOS doesn't compare versions. Your character, coins, layouts and history stay: they live under the identifier `com.agentville.desktop` (`~/Library/Application Support/com.agentville.desktop` and the matching web data), which never changes. Unsigned builds need right-click → Open (or System Settings → Privacy & Security → Open Anyway) once per download.
- **Windows**: run the new `-setup.exe`. The per-user installer finds the existing install by its identifier. A **newer** version offers "uninstall before installing" (the default) and keeps your data in `%APPDATA%` / `%LOCALAPPDATA%\com.agentville.desktop`; the **same** version offers reinstall or uninstall; an **older** one warns that a newer version is installed. Close Agentville first (the installer asks if it's running). Unsigned builds show SmartScreen → More info → Run anyway.
- From the first version with the in-app updater onwards, users don't need to do this: see below. Anyone still on 0.3.0 or older updates by hand once.

## In-app updates

On launch (after the first-run welcome), the app fetches `https://github.com/GibsonChenDev/Agentville/releases/latest/download/latest.json`. If its version is newer than the running one, a dialog shows the release notes in the UI language with **Update now** / **Later**. Updating downloads the bundle with a progress bar (the player's character walks along it), checks its signature against the public key in `tauri.conf.json` → `plugins.updater.pubkey`, installs and relaunches. **Later** asks again on the next launch.

- macOS: the `.app` in place is replaced, then the app restarts. It fails if the app runs from the DMG or a read-only folder; move it to Applications first.
- Windows: the NSIS installer runs in passive mode (a small progress window, no questions, no administrator rights) and starts the new version.
- Dev builds (`npm run dev` / `tauri dev`) never check.

**Updater signing key** — separate from Apple/Windows code signing and free. Generated with `npx tauri signer generate`; the private key and its password are kept outside the repo (`~/.tauri/agentville-updater.key`, `~/.tauri/agentville-updater.password`) and as the repository secrets `TAURI_SIGNING_PRIVATE_KEY` (the key file's contents) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Back both up somewhere safe: **if the private key is lost, installed apps can never accept another update** — you'd have to ship a new public key and ask everyone to reinstall by hand.

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
