# BLOFY PLAYER — Android TV Google Play reviewer access

**Not yet submitted:** Replace the placeholders below with an *actually working*, approved, durable test Xtream account. Do **not** commit passwords, signed URLs, or reviewer secrets to a repository.

## Console entry (English)

In **Play Console → Policy and programs → App content → Sign-in details (App access) → Manage → Add new instructions** use the following template. Verify the exact controls against the uploaded **versionCode 2000074**, not a development screenshot.

**Instruction title:** BLOFY PLAYER — Android TV Review Access

**Instructions:**

> This is a media player for user-provided, authorized playlists. A dedicated, reusable demo Xtream account is provided below for Google Play review; it has no one-time code, no extra approval, and no region restrictions.
>
> 1. Launch BLOFY PLAYER on an Android TV device using the TV remote. Select **Add / Manage Playlists** (or the corresponding Arabic label).
> 2. Select **+ Xtream** and fill in the server address, username and password using the TV keyboard.
> 3. Choose **Save and Connect**, wait until the initial demo catalog finishes loading, then open **Live TV**, **Movies** and **Series** from the home screen to inspect navigation and playback.
> 4. Use Up/Down/Left/Right, OK and Back throughout. If the login screen shows an activation/QR code, the reviewer must also have a reusable way to pass that activation step **without contacting support**; include those instructions and any needed reviewer code here.
> 5. All demo content is explicitly licensed/authorized for testing and the demo remains accessible globally throughout review and for future audits.

**Server URL:** `[ADD REVIEWER DEMO SERVER HTTPS URL]`

**Username:** `[ADD REUSABLE REVIEWER USERNAME]`

**Password:** `[ADD REUSABLE REVIEWER PASSWORD]`

**Activation instructions if required:** `[ADD THE SELF-SERVICE REUSABLE TV ACTIVATION METHOD / CODE]`

## Required acceptance test before sending

- Test with a **new Android TV device identity**, an empty app data directory, from outside the developer's LAN.
- Login and activation instructions must work *without a personal phone, manual approval, customer support, temporary OTP, QR image generated per session, IP allowlist, or renewal*.
- Reviewers must be able to browse and play authorized demo videos, TV categories and series episodes using only D-pad controls.
- Keep the account alive and unchanged for subsequent reviews. Do not add real user data or copyrighted media without permission.
- If there is any region-specific blocking or paywall, reviewer access must bypass it only for the demo tenant and without exposing customer content.
- Google requires credentials and instructions in **English**. If QR is the only route, use a reusable static URL and detailed instructions.

**Do not claim the login issue is resolved until these steps have actually passed on the store-version app.**
