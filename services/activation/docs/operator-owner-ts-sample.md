# Owner sample transfer through BLOFY website

The current admin console at https://blofyplayer.com/admin/control-center#diagnostics
has a single optional MPEG-TS file upload to diagnose one short licensed recording.

The signed admin cookie is validated before operator proxy handling. The normal
POST cross-origin rejection applies. The website proxy increases the maximum
body size from 64 KiB to 2,000,000 bytes ONLY for
/operator/api/media-scan/owner-sample. Original distributor/auth/admin POST
limits remain unchanged. No browser credentials or cookies are forwarded to
STREAM. The STREAM server then checks its own operator credential and explicit
rights/action headers before forwarding the raw file to the isolated lab
with a new server-only upload credential.

Tests verify forwarding 188-byte packet-aligned TS, rejecting missing rights,
rejecting >2MB files, and keeping the 64KiB default. Content in the sample is
neither parsed nor saved by the website proxy.

Rollback: deploy the previous pinned BLOFY activation portal commit.
The STREAM operator legacy login, Xtream sources, customer stream URLs and
subscriber accounts are not modified.
