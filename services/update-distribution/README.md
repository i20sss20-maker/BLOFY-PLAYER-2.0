# BLOFY Update Distribution

Standalone Railway service for the external Android distribution channel.

It contains no activation database, subscriber data, playlist credentials, or admin secrets.

Endpoints:
- `/health` — updater-compatible release metadata
- `/download/latest.apk` — latest external APK redirect
- `/releases` and `/downloads` — public external download page
