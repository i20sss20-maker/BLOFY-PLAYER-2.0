# Receiver first registration

The initial Refresh from website action in playlist management also checks activation before requesting the authenticated portal list. A first-install integration test verifies the request order and that refresh controls are restored on completion.

On a fresh Android installation, the welcome screen's Enter button previously waited for activation and portal synchronization. When the portal contained no playlist, the action returned to the same screen without opening registration. A regression test reproduces this with real Enter key down/up events and a successful activation response.

Enter now opens playlist management when there is no selected local provider. The registration page is available even before the device can reach the service. A user who linked playlists on the website can retrieve them with Refresh from website; selected, committed local libraries retain their existing entry path.

Submitting the first BLOFY subscription now ensures a usable device identity before the subscriber-session request. A new installation checks activation first, a cached usable identity is retained, and blocked/expired or failed activation cannot authorize a new subscriber session. Pairing-code rotation uses the committed identity. User credentials and existing catalogs are retained.

Validation includes first-install Enter navigation, existing local-library entry, activation rejection, first subscriber identity registration, cached identity reuse and retry after network failure. Subscriber identity cases run at Android API 23 and 28. The physical receiver's reported failure still requires testing the resulting signed APK on that device.

The separate managed playback investigation compared the previously tested and current saved identities without disclosing credentials: host, username and password match. The same MBC 1 HD sample (stream 2283) currently returns HTTP 458 for direct TS/HLS requests and HTTP 511 through the legacy gateway. No video bytes were received in these bounded probes. This patch addresses registration; the current stream rejection has not been resolved by these changes.
