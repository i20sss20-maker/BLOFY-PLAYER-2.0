# BLOFY Remote Provider Profile

Remote provider profiles are a BLOFY control-plane feature used to adjust playback behavior per saved provider without shipping a new APK.

## Safety boundary
The remote profile MUST NOT contain or change playlist credentials, playlist URLs, usernames, passwords, device identity, or activation codes.

Allowed remote fields only:

- `liveFormat`: `ts` or `m3u8`
- `preferredTransport`: `cronet` or `http`
- `preferredEngine`: `media3` or `vlc`
- `allowCrossProtocolRedirects`: boolean

Unknown values are ignored by Android. If the profile service is unavailable, returns a non-2xx response, or returns malformed JSON, BLOFY keeps the local provider settings and continues normally.

## Device request

`POST /api/v1/provider-profile`

```json
{
  "deviceId": "BLOFY-XXXX-XXXX",
  "activationCode": "123456",
  "providerKey": "local-provider-id"
}
```

The service must validate the device ID + activation code pair before returning configuration.

## Response

A profile may return any subset of the allowed fields:

```json
{
  "liveFormat": "ts",
  "preferredTransport": "cronet",
  "preferredEngine": "media3",
  "allowCrossProtocolRedirects": true
}
```

Missing fields mean "keep the current local value".

## Admin control

The production service should expose an authenticated admin endpoint to upsert/delete a profile by `providerKey`. Admin authentication must reuse the service admin token rules and never expose the token to the Android app.

## Apply timing

Profiles should be fetched after activation succeeds and before entering Home. Failure to fetch a profile is non-fatal. Cached/local provider settings remain the fallback so Connect is never blocked by control-plane availability.
