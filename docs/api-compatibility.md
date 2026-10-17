# API compatibility policy

The web portal deploys with the API, so it is always in step. The mobile app is
different: parents update when they feel like it, and a store release takes
days to reach everyone. So the API has to keep working for app builds that are
weeks or months old. This page sets the rules that make that safe, and explains
how to retire old builds with the version gate.

## How the version gate works

- Every request from the app carries three headers:
  - `X-App-Version`: the store version, e.g. `1.4.0` (iOS `CFBundleShortVersionString`, Android `versionName`).
  - `X-App-Build`: the build number (iOS `buildNumber`, Android `versionCode`). It is for logs and support only; nothing is gated on it.
  - `X-App-Platform`: `ios`, `android` or `web` (the browser preview).
- `GET /api/app/version` is public and returns, per platform, `minVersion`,
  `latestVersion`, `storeUrl` and `message`. The app calls it when it starts
  and whenever it comes back to the foreground.
  - Below `minVersion`: a full-screen "Update required" with a button to the
    store. It cannot be dismissed.
  - Below `latestVersion`: an "Update available" banner the parent can
    dismiss. It shows at most once a day.
  - If the check fails (offline, server down) the app carries on as normal.
- The API refuses requests from builds below the minimum with
  **426 Upgrade Required**:

  ```json
  { "statusCode": 426, "code": "APP_UPDATE_REQUIRED", "message": "...", "minVersion": "1.2.0", "storeUrl": "https://..." }
  ```

  The app shows the "Update required" screen for this response from any
  request, so a build that missed the check still stops cleanly.
- Only requests with `X-App-Platform: ios` or `android` **and** a readable
  `X-App-Version` are checked. The web portal, the app's web preview, payment
  gateway callbacks, scripts and builds older than the headers are never
  refused. `/api/app/version` and `/api/health` answer every build.
- The values come from the console (**Mobile app**, platform owners only;
  support staff can see them). Every change and reset is in the console audit
  log (`app_version.update`, `app_version.reset`). With nothing saved in the
  console, the server's env defaults apply: `APP_MIN_VERSION_IOS`,
  `APP_LATEST_VERSION_IOS`, `APP_STORE_URL_IOS`, the same with `_ANDROID`, and
  `APP_UPDATE_MESSAGE` (see `apps/api/.env.example`). A change applies straight
  away on the instance that saved it and within 30 seconds on the others.

Versions are one to three whole numbers (`2`, `2.1`, `2.1.3`) and compare part
by part (`1.10.0` is newer than `1.9.0`). Do not use pre-release suffixes such
as `1.2.0-beta` for store builds: the gate ignores versions it cannot read.

## How long old versions stay supported

- **Supported** means: the build works fully and the API keeps every endpoint
  and field it uses.
- A store version stays supported for **at least 90 days after the next
  version is live in both stores**. For the pilot, with few parents, this can
  be shortened to 30 days if every pilot parent has been told to update.
- The two most recent minor versions (for example 1.4.x and 1.3.x) are always
  supported, whatever their age.
- A build may be retired early only for a security problem, or if it can
  corrupt data (for example a payment bug). Write down why in the console
  message and in the release notes.

## Rules for changing endpoints

Any endpoint the mobile app calls is a public contract. The app's calls are
all in `apps/mobile/src` (search for `api<` and `useApi<`).

1. **Additive changes only.** Safe:
   - adding an endpoint;
   - adding a field to a response;
   - adding an optional field to a request (with a default that keeps the old
     behaviour);
   - adding a new value to an enum the app only displays, if the app shows
     unknown values sensibly.
2. **Breaking changes are not allowed in place.** These need a new endpoint (or
   a new optional parameter) alongside the old one:
   - removing or renaming a field, endpoint or query parameter;
   - changing a field's type, units or meaning (rupees to paisa, a date to a
     date-time, a list to a paged object);
   - making an optional request field required, or tightening validation the
     app's existing forms could fail;
   - changing status codes or error shapes the app branches on (401, 403, 426,
     `issues`, `message`).
3. **Deprecate before removing.**
   - Mark the old endpoint or field `@deprecated` in the code with the date and
     the app version that stopped using it.
   - Ship the app version that moves to the new endpoint.
   - Keep the old one until every supported version has moved off it, i.e.
     until the minimum version (step 4 below) is at or above the version that
     stopped using it.
   - Only then remove it.
4. **Never change auth and session behaviour for old builds without a gate.**
   Token format, the `mustChangePassword` flow and the change-password
   response are used by every build.
5. **Test old builds.** Before an API release that touches an endpoint the app
   uses, run the previous store build (an EAS preview build of the last
   release tag) against a staging API.

## Raising the minimum safely

Raising the minimum locks out every phone below it until it updates, so:

1. Make sure the new version is **live in both stores** and has finished any
   staged rollout on Google Play. A parent sent to the store with nothing new
   to install is stuck.
2. Set **latest** first, leave minimum alone, and let the "Update available"
   banner run for at least a week (the support window above sets the real
   timeline).
3. Check who is still on old builds. The `X-App-Version` and `X-App-Build`
   headers are on every request, so the reverse proxy or API logs show the
   spread of versions; for the pilot, ask the school.
4. Tell the pilot school (WhatsApp announcement) the day before, with the
   message parents will see.
5. Raise the **minimum** for one platform at a time in the console, with a
   short message saying why ("Fee payments moved to a new screen: please
   update"). The console warns before saving a higher minimum.
6. Watch for 426 responses and support calls for a day. If something is wrong,
   lower the minimum again: phones go back to working the next time they open
   the app, or immediately with **Check again** on the update screen.

The minimum should never be above the oldest version still inside the support
window, except for the early-retirement reasons above.
