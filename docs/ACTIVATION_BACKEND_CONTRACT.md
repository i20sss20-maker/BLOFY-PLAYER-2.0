# BLOFY Activation Backend Contract

The Android client already supports this contract. Deploying the backend only requires exposing the endpoint below and building the device/admin persistence around it.

## Client configuration

Set the Gradle property at build time:

`BLOFY_ACTIVATION_BASE_URL=https://activation.example.com/`

The application compiles this into `BuildConfig.ACTIVATION_BASE_URL`. If the value is empty, development builds keep the current local/offline behavior.

## Check endpoint

`POST /api/v1/activation/check`

Request JSON:

```json
{
  "deviceId": "BLOFY-66HL-GB09",
  "activationCode": "123456",
  "appVersion": "2.0.0-alpha01",
  "platform": "android"
}
```

Response JSON:

```json
{
  "status": "active",
  "expiresAt": 1819651200000,
  "serverTime": 1788062400000,
  "message": null
}
```

Allowed `status` values:

- `trial`: device is in its trial period.
- `active`: paid/authorized device.
- `expired`: entitlement ended.
- `blocked`: administratively disabled device.

Unknown values are treated as not authorized.

`expiresAt` is Unix epoch milliseconds. `null` means no expiry/lifetime entitlement. `serverTime` should be returned whenever possible so the client does not have to trust the device clock when evaluating a fresh response.

## Recommended backend device record

```text
id
 device_id UNIQUE
 activation_code
 status                 trial | active | expired | blocked
 trial_started_at
 trial_expires_at
 activated_at
 expires_at              nullable for lifetime
 last_check_at
 last_ip
 app_version
 platform
 note
 created_at
 updated_at
```

Never use the IPTV provider username/password as the activation identity. Device activation and provider credentials are separate systems.

## State rules

1. First unseen device may be created as `trial` if BLOFY trial mode is enabled.
2. A trial is authorized only while its expiry is in the future.
3. `active` is authorized while `expiresAt` is null or in the future.
4. `expired` and `blocked` are never authorized.
5. Admin activation can change a device from trial/expired to active and set either one-year or lifetime validity.
6. Blocking a device should take effect on the next successful online check.

## Offline behavior already implemented in Android

The client stores the latest successful authorization and expiry locally. If the activation service cannot be reached, it may continue only when that cached entitlement is still valid. A device that has never received a valid authorization cannot bypass activation just because the backend is offline.

## Admin/API extensions recommended for BLOFY portal

These are server/product endpoints, not required by the current Android check call:

```text
POST   /api/v1/admin/devices/{deviceId}/activate
POST   /api/v1/admin/devices/{deviceId}/block
POST   /api/v1/admin/devices/{deviceId}/unblock
POST   /api/v1/admin/devices/{deviceId}/extend
GET    /api/v1/admin/devices/{deviceId}
GET    /api/v1/admin/devices?query=...
```

The web activation page can resolve the QR payload (`deviceId` + six-digit code), then allow playlist/device management after authentication.

## Security requirements

- HTTPS in production.
- Rate-limit activation checks per IP and device ID.
- Constant-time comparison where secrets are compared.
- Do not log IPTV passwords or full playlist URLs containing credentials.
- Protect admin endpoints with authenticated roles; never expose them to the Android client.
- Server is authoritative for status/expiry.

## Release gate

Production builds should set a real `BLOFY_ACTIVATION_BASE_URL`. Once the endpoint is deployed and returns the contract above, no Android architecture change is required; only integration/QA remains.
