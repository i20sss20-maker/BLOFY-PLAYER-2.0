# BLOFY website: confirmed non-standard upstream HTTP 509

## Recorded production issue
The BLOFY website received HTTP 502 on selected live TS paths. Sanitized
Railway diagnostic logs associated some failures with provider HTTP 509.
509 is not a standard RFC status and cannot identify its precise cause
without further provider evidence. It is NOT proof of general service failure.

## Fix in two connected services
- STREAM relay returns fixed diagnostic relay_provider_http_509 together with
  upstreamStatus=509 inside its existing sanitized HTTP 502 envelope.
  No upstream response body, source URL, username, token or password is copied.
- The website accepts this classification only from its existing fixed-origin
  authenticated relay, with exact code and upstreamStatus 509 agreement.
- A confirmed upstream 509 is terminal for the current request, not a
  transient site gateway failure that should be retried immediately.
- Two such refusals within the same source/channel activate the existing
  45-second per-channel cooldown with Retry-After, not a global block.
- Other upstream 502/503 and transport timeouts retain existing retry policy.
- The admin source dashboard displays an Arabic explanation without assuming
  whether HTTP 509 signifies capacity, network restriction or account rights.

## Deployment and acceptance
First deploy the independent relay and confirm it remains online; then deploy
the website. Verify GitHub CI, actual Railway deploy status, protected
management endpoints and server error rates. No live provider sample is
automatically requested by this rollout.

Important: The change does NOT make an upstream-rejected channel playable.
It reduces unnecessary retries and makes the refusal visible. An authorized
real playback test and the provider's explanation remain launch gates.
Rollback by pinning the two Railway services to their previous known commits.
