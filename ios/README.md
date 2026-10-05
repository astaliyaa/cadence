# Cadence for iOS

A native SwiftUI Navidrome client in the style of Apple Music: Home, Library and Search tabs, a mini player, and a full-screen player. The full-screen player has an animated artwork background, synced lyrics, the queue, AirPlay, and Apple Music motion artwork. Playback is gapless (`AVQueuePlayer`), with lock-screen and Control Center controls, background audio and scrobbling.

Requires iOS 18 or later. On iOS 26 the mini player uses the Liquid Glass tab bar accessory.

## No Mac required

The Xcode project is generated from [`project.yml`](project.yml) with [XcodeGen](https://github.com/yonaskolb/XcodeGen), and everything is built by GitHub Actions on macOS runners ([`.github/workflows/ios.yml`](../.github/workflows/ios.yml)):

- **Every push** that touches `ios/` compiles the app. Compile errors show up as annotations on the run.
- **Pushes to `main`**, once the signing secrets below are set, also archive a signed build and upload it to **TestFlight**. Install it from the TestFlight app on your iPhone.

## One-time signing setup (all from Windows)

You need an Apple Developer Program membership. Everything happens in a browser or in **Git Bash**, which includes OpenSSL. Keep the `signing/` folder private; `.gitignore` already excludes it.

### 1. Register the app's ID
[developer.apple.com → Certificates, IDs & Profiles → Identifiers](https://developer.apple.com/account/resources/identifiers/list) → **+** → *App IDs* → *App*.
- Explicit Bundle ID: something like `com.yourname.cadence`.
- No extra capabilities are needed.

### 2. Make a distribution certificate
Create a private key and a signing request in Git Bash, from the repo root:

```bash
mkdir -p signing && openssl req -new -newkey rsa:2048 -nodes -keyout signing/dist.key -out signing/dist.csr -subj "/CN=Cadence Distribution/C=US"
```

Then in the browser: **Certificates → + → Apple Distribution**, upload `signing/dist.csr`, and download the certificate as `signing/distribution.cer`. Then convert it to a password-protected `.p12`:

```bash
openssl x509 -inform DER -in signing/distribution.cer -out signing/dist.pem
```

```bash
openssl pkcs12 -export -inkey signing/dist.key -in signing/dist.pem -out signing/dist.p12 -passout pass:CHOOSE-A-PASSWORD -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1
```

### 3. Make a provisioning profile
**Profiles → + → App Store Connect** (under Distribution). Pick your App ID and the certificate from step 2. Download it as `signing/Cadence.mobileprovision`.

### 4. Create the app in App Store Connect
[appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **Apps → + → New App** → iOS.
- Choose the bundle ID from step 1.
- The name has to be unique on the App Store (for example "Cadence for Navidrome").
- The SKU can be anything.

### 5. Create an App Store Connect API key
**Users and Access → Integrations → App Store Connect API → Team Keys → +**, access **App Manager**.
- Download the `.p8` file. You can only download it once.
- Note the **Key ID** and the **Issuer ID** shown above the table.

### 6. Add the secrets to GitHub
Repository → **Settings → Secrets and variables → Actions**:

| Kind | Name | Value |
|---|---|---|
| Variable | `IOS_BUNDLE_ID` | the bundle ID from step 1 |
| Secret | `IOS_TEAM_ID` | your Team ID (Membership page, 10 characters) |
| Secret | `IOS_DIST_CERT_P12` | output of `base64 -w0 signing/dist.p12` |
| Secret | `IOS_DIST_CERT_PASSWORD` | the password from step 2 |
| Secret | `IOS_PROFILE` | output of `base64 -w0 signing/Cadence.mobileprovision` |
| Secret | `ASC_KEY_ID` | Key ID from step 5 |
| Secret | `ASC_ISSUER_ID` | Issuer ID from step 5 |
| Secret | `ASC_KEY_P8` | the full contents of the `.p8` file |

### 7. Ship a build
Push to `main`, or run the **iOS** workflow manually from the Actions tab. When it's green, open App Store Connect:
1. Go to **TestFlight → Internal Testing**.
2. Add yourself as a tester.
3. Accept the invite in the **TestFlight** app on your iPhone.

Every later push to `main` shows up there as a new build.

## Notes

- **Plain-http servers:** many home Navidrome servers use plain `http` on the LAN, so the app allows it. iOS asks for Local Network permission the first time you connect.
- **Motion artwork:** off by default. Turn it on in Settings, where the same caveats as the desktop app apply. Because it relies on Apple's web-player token, it's fine for TestFlight internal testing, but it would not pass App Store review.
