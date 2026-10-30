# Factory-reset recovery — preserve BLOFY canonical ID and license

## Why the number changes
The current Android source derives a fresh-install identity from `Settings.Secure.ANDROID_ID`, which can change after factory reset. Factory reset also wipes local preferences and Room/Keystore state. Even the same device cannot prove it is physically the same without an external credential or account. Never attempt IMEI, serial, MAC or hidden hardware tracking to bypass Android privacy controls.

## Intended behavior with this fix
- The original canonical BLOFY number lives **server-side**, with its original `status`, `trial_started_at`, `expires_at`, playlists, subscriptions and orders.
- An existing, authenticated installation can issue an independent **32-character, high-entropy, one-time** recovery key in the app's Account > Recovery page. Save the key outside the device before resetting.
- After a factory reset, opening BLOFY initially creates a disposable trial identity. The customer enters the saved recovery key in Account > Restore. The server binds a new, authenticated alias to the original number and revokes the old activation code. Android then receives the original number at its next activation check; it does **not extend the old subscription or trial**.
- The old number is not restored until the backend has answered successfully. The UI must verify the restored ID before showing success.

## Already factory-reset without a saved code (operator-assisted)

Only if **ownership has been independently confirmed** via an order or account record, a trusted administrator can use the protected recovery API. Provide the existing canonical BLOFY ID and the newly shown BLOFY device ID + six-digit activation code via a private administrator workflow. **Do not post these secrets or customer records in public GitHub issues or chats.**

Endpoint, enabled only after the matching backend is deployed:

`POST /api/v1/admin/device/recovery/restore`

Authenticated with the existing administrator Bearer token. JSON request:
```json
{
  "originalDeviceId": "BLOFY-AAAA-BBBB",
  "targetDeviceId": "BLOFY-CCCC-DDDD",
  "targetActivationCode": "<new six-digit activation code>",
  "confirmedOwnership": true,
  "reason": "Owner verified original order and customer account"
}
```

The API rejects an unverified request, missing/wrong fresh-device secret, a previously claimed alias, blocked/missing source account, an already-licensed target, or any target having its own subscription, paid order, playlist, customer or important saved state. The old canonical row is never overwritten. The operator should then ask the customer to open BLOFY and refresh its activation; the app should show the old ID.

## Rollout gates
1. Review SQL migration and backup/rollback plan with production DB owner; schema adds `license_recovery_codes` without changing existing `devices` rows.
2. Run Node tests and PostgreSQL integration checks in **isolated** QA; run Android build and factory-reset mock flow.
3. Deploy matching activation backend, then roll out a properly signed Play/website Android release. A client-only update cannot fix the missing backend endpoints.
4. Check live production `/health` and actual restore on **test records only**, then check expiry, playlists and subscription history remain unchanged and both old and new credentials cannot be used simultaneously.
5. Never automatically match two post-reset device IDs by hardware identifiers or by the public device number alone.

**Current status:** code prepared in a separate branch, not deployed. The already factory-reset device cannot be restored until matching backend is deployed and the original license ownership is verified.
