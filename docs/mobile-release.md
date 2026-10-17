# Mobile app release checklist

How to get the SchoolSyncer app (`apps/mobile`) into the App Store and Google
Play, and how to ship each update. The code is ready. Everything under "What
the owner must create" needs a person with a company card and ID, and cannot
be done from the repository.

| | iOS | Android |
|---|---|---|
| App name | SchoolSyncer | SchoolSyncer |
| Identifier | bundle ID `pk.schoolsyncer.app` | package `pk.schoolsyncer.app` |
| Store version | `expo.version` in `apps/mobile/app.json` (now `1.0.0`) | same |
| Build number | `buildNumber`, managed by EAS | `versionCode`, managed by EAS |
| Privacy policy | `<web portal>/privacy` | same |

The bundle ID and package **cannot be changed** once the app is published.
Check them before the first upload.

## What the owner must create

### Accounts

- [ ] **Expo account** (free) at expo.dev. Create an organisation (e.g. `schoolsyncer`) so the project is not tied to one person.
- [ ] **Apple Developer Program**, as an organisation (USD 99 a year). You need a D-U-N-S number for the company, and Apple's checks can take one to two weeks. Enrol at developer.apple.com/programs.
- [ ] **Google Play Console**, as an organisation (USD 25 once). Google checks the developer's identity and may ask for a D-U-N-S number. New personal accounts must run a closed test with 12 testers for 14 days before going to production; organisation accounts are exempt, which is another reason to enrol as one.
- [ ] A mailbox for privacy requests. `apps/web/src/app/privacy/page.tsx` uses `privacy@schoolsyncer.pk`. Create it or change the address there.
- [ ] A support URL or email for the store listings.

### Store listings

- [ ] **App Store Connect**: create the app (My Apps > + > New App) with bundle ID `pk.schoolsyncer.app`. Register the bundle ID first under Certificates, IDs & Profiles, or let `eas build` do it. Note the **Apple ID** of the app (a number, under App Information) for `eas submit`.
- [ ] **Play Console**: create the app (Create app), default language English, "App", "Free".
- [ ] Short description (80 characters) and full description. Use the same wording on both stores, for example: "See your child's attendance, homework, results and timetable, and pay school fees online."
- [ ] Category: Education.
- [ ] Privacy policy URL: `https://<web portal>/privacy`. This page must be live on the production web portal first.
- [ ] Content rating questionnaires (Play: IARC; Apple: age rating). The app has no user-generated public content, no ads and no gambling. Expect a rating of Everyone (Play) and 4+ (Apple).
- [ ] Target audience (Play): the app is for **parents and teachers** (adults), students are a secondary user. Choose 18+ as the target age group unless student logins are part of the launch, in which case Families policy rules apply. Decide before submitting.
- [ ] **App review sign-in**: both stores need a working login. Make a demo school (or use the seeded demo school on production) with a parent account that has a child, attendance, a result and an unpaid voucher. Put the school code, login and password in App Review Information (Apple) and App access (Play). Set the demo payment mode so a reviewer cannot pay real money.

### Screenshots and graphics

- [ ] App icon: `apps/mobile/assets/images/icon.png` (1024x1024). Apple rejects icons with transparency: check the file has no transparent pixels.
- [ ] Play feature graphic: 1024x500 PNG or JPG.
- [ ] iPhone screenshots: 6.9" display (1320x2868 or 1290x2796), at least 3. Apple scales these for smaller phones.
- [ ] iPad screenshots: 13" display (2064x2752), at least 3, because `ios.supportsTablet` is `true`. To skip iPads entirely, set it to `false` in `app.json` **before the first upload**; it cannot be turned off later.
- [ ] Android phone screenshots: at least 2, 16:9 or 9:16, e.g. 1080x1920.
- [ ] Suggested screens: sign-in, My children, a child's attendance, a report card, the fee voucher with Pay.

### Privacy forms

Answer both from what the app actually does. These are the answers for the current code; review them if features change.

- [ ] **Google Play Data safety**:
  - Data is encrypted in transit: yes. Users can request deletion: yes (privacy page and the school).
  - Collected: personal info (name, email address, phone number, user IDs), financial info (payment history; card and wallet details are entered on the gateway's page, not in the app), app activity (in-app actions), app info and performance (crash logs if crash reporting is added later; none today), device or other IDs: no.
  - Photos: student photos are shown, not collected by the app.
  - Shared with third parties: payment details with the payment gateway (JazzCash, Easypaisa, 1Bill) when a parent pays.
  - Purpose: app functionality and account management. Not used for advertising or analytics.
- [ ] **Apple App Privacy** ("nutrition label"): the same data types, all "Linked to the user", none "Used to track you". No tracking, so no App Tracking Transparency prompt.
- [ ] **Account deletion**: Apple requires in-app deletion only for apps that let people create accounts. SchoolSyncer accounts are created by the school, so the privacy page's deletion section is the answer; give its URL in the Play "Data deletion" question.
- [ ] **Export compliance**: `ios.config.usesNonExemptEncryption` is `false` in `app.json` (the app only uses HTTPS), so App Store Connect will not ask for encryption documents per build.

## One-time setup in the repository

Run these from `apps/mobile`. Install the CLI once: `npm install -g eas-cli`.

```bash
cd apps/mobile
eas login                      # the Expo account above
eas init                       # links the project: adds extra.eas.projectId and owner to app.json; commit that change
```

Set the addresses the app is built with (they are inlined at build time, see
`apps/mobile/.env.example`). Use the production API and web portal; never
`localhost`.

```bash
eas env:create --environment production --name EXPO_PUBLIC_API_URL --value https://api.example.pk/api --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_WEB_URL --value https://app.example.pk --visibility plaintext
# The same two for --environment preview (usually a staging server) and --environment development.
```

Build numbers live on EAS (`"appVersionSource": "remote"` in `eas.json`) and
go up by one with every production build (`"autoIncrement": true`). Nothing
to edit by hand. To start from a particular number:

```bash
eas build:version:set --platform ios
eas build:version:set --platform android
```

Signing: on the first build EAS offers to create the Android keystore and the
iOS distribution certificate and provisioning profile. Say yes and let EAS keep
them. **Back up the Android keystore** (`eas credentials --platform android` >
Download): losing it means you can never update the Play app.

## Build profiles (`apps/mobile/eas.json`)

| Profile | Use | Output |
|---|---|---|
| `development` | Developers, with the dev menu and fast refresh (`expo-dev-client`) | iOS simulator build, Android debug APK |
| `preview` | Testing a release candidate on real phones before the stores | Android APK to install directly; iOS ad-hoc build (register test devices with `eas device:create`) |
| `production` | The stores | Android App Bundle (.aab), iOS .ipa |

## Releasing a version

1. Decide the new version (e.g. `1.1.0`) and set it in `apps/mobile/app.json` (`expo.version`) and `apps/mobile/package.json`.
2. Check the API side: any endpoint change follows `docs/api-compatibility.md` (additive only, deprecate before removing). Deploy the API **before** the app if the app needs a new endpoint.
3. Run the checks:
   ```bash
   pnpm --filter mobile typecheck
   pnpm --filter mobile lint
   pnpm --filter mobile test
   ```
4. Build a preview and try it on a real phone against staging:
   ```bash
   cd apps/mobile
   eas build --platform android --profile preview
   eas build --platform ios --profile preview
   ```
5. Build for the stores:
   ```bash
   eas build --platform all --profile production
   ```
6. Submit:
   ```bash
   eas submit --platform ios --profile production --latest
   eas submit --platform android --profile production --latest
   ```
   - iOS asks for the App Store Connect app's Apple ID the first time; add it to `eas.json` as `submit.production.ios.ascAppId` to skip the question.
   - Android: Google requires the **very first** .aab to be uploaded by hand in the Play Console (Testing > Internal testing > Create release). After that, `eas submit` works with a Google service account key: create one in Google Cloud with access to the Play Console app, and add it with `eas credentials --platform android` (or `submit.production.android.serviceAccountKeyPath` in `eas.json`, never committed). Builds go to the **internal** track as a draft; promote them in the Play Console.
7. Release: on iOS submit for review and release; on Play, promote from internal to production, ideally as a staged rollout (e.g. 20%).
8. When the release is live in both stores, set **Latest version** in the console (**Mobile app**) so older builds see the "Update available" banner. Raise the **Minimum version** only as described in `docs/api-compatibility.md`.
9. Tag the commit: `git tag mobile-v1.1.0 && git push --tags`, so the build can be reproduced for old-build testing.

## The pilot school

- Ship the first version to the internal track (Play) and TestFlight (iOS) and invite the pilot parents there first; TestFlight needs each tester's email, Play internal testing up to 100 Google accounts.
- Once the pilot parents are happy, publish to production. The version gate then moves them to new versions: banner first, then the minimum when needed.
