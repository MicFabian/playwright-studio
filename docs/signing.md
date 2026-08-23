# Signing and notarizing the desktop app

Everything except the credentials is already wired up. Supply them and the same
build command produces installers other people can open; leave them out and the
build still works, it just produces an app only your machine trusts.

## Why the current builds are rejected

The app is signed, but with an **Apple Development** certificate. That is meant
for running on machines registered to your developer team. Gatekeeper refuses it
anywhere else:

```console
$ spctl --assess --type execute -v "Playwright Studio.app"
Playwright Studio.app: rejected
```

Distributing outside the App Store needs a **Developer ID Application**
certificate plus notarization. Those require a paid Apple Developer account
($99/year) — there is no way around that, and no way to fake it.

## macOS

### 1. Get a Developer ID certificate

In Xcode: **Settings → Accounts → Manage Certificates → + → Developer ID
Application**. Confirm it landed:

```bash
security find-identity -v -p codesigning | grep "Developer ID Application"
```

electron-builder picks it automatically once it exists — there is nothing to
configure locally.

### 2. Create an app-specific password

Notarization uploads the app to Apple. It cannot use your normal password.
Create one at [appleid.apple.com](https://appleid.apple.com) under **Sign-In and
Security → App-Specific Passwords**.

Your team id is the ten-character code in the [membership
details](https://developer.apple.com/account) page.

### 3. Build

```bash
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="ABCDE12345"

npm run desktop:build
```

Notarization takes a few minutes; the build waits for Apple to answer. Without
these three variables the step is skipped with a message saying so.

### 4. Check it worked

```bash
spctl --assess --type execute -v "release/mac-arm64/Playwright Studio.app"
# Playwright Studio.app: accepted
# source=Notarized Developer ID
```

`rejected` means the app is still signed with a development certificate.

## Windows

Set `WIN_CSC_LINK` to a base64-encoded `.pfx` (or a path to one) and
`WIN_CSC_KEY_PASSWORD` to its password. Without them the installer is unsigned
and SmartScreen warns on first run.

Note that SmartScreen reputation builds over time even with a valid
certificate, so early downloads may still be warned about.

## Linux

AppImages are not signed. Distributions rely on checksums instead, which the
release workflow publishes alongside the artifacts.

## Building in CI

The release workflow signs when these repository secrets exist, and builds
unsigned when they do not:

| Secret                         | What it holds                       |
| ------------------------------ | ----------------------------------- |
| `MACOS_CERTIFICATE`            | Developer ID `.p12`, base64 encoded |
| `MACOS_CERTIFICATE_PASSWORD`   | Password for that `.p12`            |
| `APPLE_ID`                     | Apple ID email                      |
| `APPLE_APP_SPECIFIC_PASSWORD`  | App-specific password from step 2   |
| `APPLE_TEAM_ID`                | Ten-character team id               |
| `WINDOWS_CERTIFICATE`          | Code signing `.pfx`, base64 encoded |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password for that `.pfx`            |

Export the certificate for CI with:

```bash
base64 -i DeveloperID.p12 | pbcopy
```

Then add it with `gh secret set MACOS_CERTIFICATE`.

The workflow imports the certificate into a temporary keychain that is discarded
with the runner, and deletes the decoded `.p12` immediately after import.

## What users see without signing

- **macOS**: "cannot be opened because it is from an unidentified developer".
  They can bypass it with right-click → Open, or `xattr -dr com.apple.quarantine`,
  but most people will not.
- **Windows**: a SmartScreen warning with a "Run anyway" behind **More info**.
- **Linux**: no warning; AppImages are not gated this way.
