# NanoGlyph Android App Links

Android verifies `https://ghagui.github.io/NanoGlyph-Share/` against a file
served from the host root:

`https://ghagui.github.io/.well-known/assetlinks.json`

That root is outside this project site. Create the public repository
`GHagui/GHagui.github.io` and add:

- `.nojekyll`
- `.well-known/assetlinks.json`, based on `assetlinks.json.template`
- an optional root `index.html`

Replace both placeholders with colon-separated SHA-256 certificate
fingerprints:

1. The certificate used to sign the directly distributed APK.
2. The Google Play App Signing certificate shown in Play Console.

Verify the deployed association:

```bash
adb shell pm verify-app-links --re-verify io.github.ghagui.nanoglyph
adb shell pm get-app-links io.github.ghagui.nanoglyph
adb shell am start -W -a android.intent.action.VIEW \
  -d 'https://ghagui.github.io/NanoGlyph-Share/#PAYLOAD'
```

Do not publish placeholder fingerprints. An invalid root file makes verified
App Links fail for every NanoGlyph installation.
