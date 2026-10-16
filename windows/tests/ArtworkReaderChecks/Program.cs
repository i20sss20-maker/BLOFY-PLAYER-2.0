using BlofyPlayer.Windows.Core;
using BlofyPlayer.Windows.Core.Playback;
using BlofyPlayer.Windows.Core.Identity;
using System.Net;
using System.Net.Http;

static void Check(bool condition, string label)
{
    if (!condition) throw new Exception("Artwork reader failed: " + label);
    Console.WriteLine("PASS " + label);
}

var sample = new byte[] { 1, 2, 3, 4 };
var valid = await BoundedPayloadReader.ReadAsync(new MemoryStream(sample), 4, CancellationToken.None);
Check(valid is not null && valid.SequenceEqual(sample), "exact boundary succeeds");

var oversized = await BoundedPayloadReader.ReadAsync(new MemoryStream(new byte[2_000_000]), 1024, CancellationToken.None);
Check(oversized is null, "missing Content-Length / oversized body fails closed");

var empty = await BoundedPayloadReader.ReadAsync(new MemoryStream(), 1024, CancellationToken.None);
Check(empty is null, "empty content rejected");

var underLimit = await BoundedPayloadReader.ReadAsync(new MemoryStream(sample), 1024, CancellationToken.None);
Check(underLimit is not null && underLimit.SequenceEqual(sample), "short body preserved");

using var cancelled = new CancellationTokenSource();
cancelled.Cancel();
var cancelledObserved = false;
try
{
    await BoundedPayloadReader.ReadAsync(new MemoryStream(sample), 1024, cancelled.Token);
}
catch (OperationCanceledException)
{
    cancelledObserved = true;
}
Check(cancelledObserved, "pre-cancelled request stops before allocation");

Console.WriteLine("All artwork payload regression checks passed.");

// Error messages from VLC and HTTP failures must never expose account data.
var unsafeError = "https://iptv.example/live/alice/hunter2/333.ts?token=ABCSECRET&username=bob" +
    "\nPassword: hunter2; token=ABCSECRET" +
    "\nAuthorization: Bearer ABCSECRET" +
    "\n/live/alice/hunter2/456.ts";
var cleanError = SensitiveTextRedactor.Redact(unsafeError);
Check(!cleanError.Contains("alice") && !cleanError.Contains("hunter2") &&
      !cleanError.Contains("ABCSECRET") && !cleanError.Contains("bob"),
    "stream credentials and URLs redacted from diagnostics");
Check(SensitiveTextRedactor.Redact("Status: OK") == "Status: OK",
    "harmless diagnostics retained");
Check(SensitiveTextRedactor.Redact("X-BLOFY-Activation-Code: 123456").Contains("REDACTED"),
    "activation identifiers removed");
Check(SensitiveTextRedactor.Redact("Bearer ABCSECRET").Contains("REDACTED"),
    "bearer token removed");
Check(AppBuildInfo.WindowsVersion == "windows-" + AppBuildInfo.Version &&
      AppBuildInfo.UserAgent.EndsWith("/" + AppBuildInfo.Version),
    "activation and HTTP version metadata agree");

// Untrusted URLs must never be offered as application updates.
Check(UpdateDownloadPolicy.IsApproved("https://updates.blofyplayer.com/windows/setup.exe"),
    "official BLOFY updater trusted");
Check(UpdateDownloadPolicy.IsApproved("https://blofyplayer.com/downloads"),
    "official downloads page trusted");
Check(UpdateDownloadPolicy.IsApproved(
    "https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/v0.4.15/BLOFY-Windows-Setup.exe"),
    "official GitHub Windows release asset trusted");
Check(!UpdateDownloadPolicy.IsApproved("http://updates.blofyplayer.com/download.exe"),
    "plain HTTP rejected for Windows updater");
Check(!UpdateDownloadPolicy.IsApproved("https://updates.blofyplayer.com.evil.test/download.exe"),
    "lookalike BLOFY hostname rejected");
Check(!UpdateDownloadPolicy.IsApproved("https://github.com/attacker/evil/releases/download/x/Windows-Setup.exe"),
    "unrelated GitHub repository rejected");
Check(!UpdateDownloadPolicy.IsApproved("https://github.com:444/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/x/app.exe"),
    "non-standard HTTPS updater port rejected");
Check(!UpdateDownloadPolicy.IsApproved("https://someone:secret@updates.blofyplayer.com/download.exe"),
    "embedded update URL credentials rejected");

// Most recently used art must survive file-count and byte-quota eviction.
var now = DateTime.UtcNow;
var samples = new[]
{
    new ArtworkFileEntry("old.img", 4, now.AddDays(-10)),
    new ArtworkFileEntry("fresh.img", 4, now),
    new ArtworkFileEntry("middle.img", 4, now.AddDays(-2))
};
var evictBySize = ArtworkPrunePolicy.PlanEvictions(samples, 8, 3);
Check(evictBySize.SequenceEqual(new[] { "old.img" }),
    "size limit removes oldest artwork, not freshly downloaded posters");
var evictByCount = ArtworkPrunePolicy.PlanEvictions(samples, 100, 1);
Check(evictByCount.Count == 2 && !evictByCount.Contains("fresh.img"),
    "file-count limit retains newest poster");
Check(ArtworkPrunePolicy.PlanEvictions(samples, 0, 0).Count == 3,
    "zero cache quota removes all posters");
Check(ArtworkPrunePolicy.PlanEvictions(samples, 100, 10).Count == 0,
    "sufficient cache budget keeps all posters");
Check(ArtworkPrunePolicy.PlanEvictions(
    new[] { new ArtworkFileEntry("oversize.img", long.MaxValue, now) }, 1024, 1).Count == 1,
    "oversized artwork cannot overflow quota budget");

Console.WriteLine("All BLOFY Windows 0.4.15 regression checks passed.");

// Real-world M3U metadata must work without loading a complete playlist into RAM.
var playlistSample = """
#EXTM3U
#EXTINF:-1 tvg-id="sa1" tvg-logo="https://cdn.example/sa.png" group-title="قنوات السعودية",القناة الأولى
#EXTVLCOPT:http-user-agent=AndroidTV/12
#EXTVLCOPT:http-referrer=https://ref.example/
https://cdn.example/live/first.m3u8
#EXTINF:-1 group-title="Movies" tvg-logo="https://cdn.example/poster.png",Film One
https://cdn.example/films/movie.mp4|User-Agent=Receiver%2F8&Referer=https%3A%2F%2Fref.example%2F
#EXTINF:-1,Ignored
file:///etc/private
""";
var parsedM3u = new List<M3uPlaylistEntry>();
await foreach (var row in M3uPlaylistParser.ReadAsync(new StringReader(playlistSample)))
    parsedM3u.Add(row);
Check(parsedM3u.Count == 2, "streamed M3U ignores unsupported local-file URLs");
Check(parsedM3u[0].Name == "القناة الأولى" && parsedM3u[0].TvgId == "sa1" &&
      parsedM3u[0].Group == "قنوات السعودية", "Arabic channel and EPG metadata preserved");
Check(parsedM3u[0].UserAgent == "AndroidTV/12" &&
      parsedM3u[0].Referer == "https://ref.example/",
    "#EXTVLCOPT headers extracted for VLC playback");
Check(parsedM3u[1].Url == "https://cdn.example/films/movie.mp4" &&
      parsedM3u[1].UserAgent == "Receiver/8" &&
      parsedM3u[1].Referer == "https://ref.example/",
    "M3U pipe-suffix headers removed from media URL and applied separately");
var oversizedLineRejected = false;
try
{
    await foreach (var _ in M3uPlaylistParser.ReadAsync(
        new StringReader(new string('x', M3uPlaylistParser.MaxLineCharacters + 1)))) { }
}
catch (InvalidDataException) { oversizedLineRejected = true; }
Check(oversizedLineRejected, "M3U overlong lines rejected without growing catalog");
using var cancelledM3u = new CancellationTokenSource();
cancelledM3u.Cancel();
var cancelledParse = false;
try
{
    await foreach (var _ in M3uPlaylistParser.ReadAsync(new StringReader(playlistSample),
                       cancelledM3u.Token)) { }
}
catch (OperationCanceledException) { cancelledParse = true; }
Check(cancelledParse, "M3U import obeys immediate cancellation");
await using (var boundedStream = new LengthLimitedStream(new MemoryStream(new byte[12]), 8))
{
    var refused = false;
    try { await boundedStream.ReadAsync(new byte[12].AsMemory()); }
    catch (InvalidDataException) { refused = true; }
    Check(refused, "streaming byte cap applies even with missing Content-Length");
}
Console.WriteLine("All BLOFY Windows 0.4.16 stream parser checks passed.");


// QA lab URL policy regressions.
Check(PlaybackLabUrlPolicy.TryValidate(
    "https://cdn.example.test/sample.MPD?token=signed", out var dashUrl, out var dashType)
    && dashType == "DASH" && dashUrl.EndsWith("?token=signed", StringComparison.Ordinal),
    "authorized DASH QA URL accepted without dropping its query");
Check(PlaybackLabUrlPolicy.TryValidate(
    "https://cdn.example.test/movie.m3u8?quality=hd", out _, out var hlsType)
    && hlsType == "HLS", "HLS QA URL recognized");
Check(PlaybackLabUrlPolicy.TryValidate(
    "http://localhost:8787/demo.ts", out _, out var localType)
    && localType == "TS", "loopback HTTP permitted for local lab");
Check(!PlaybackLabUrlPolicy.TryValidate("http://remote.example.test/movie.mpd", out _, out _),
    "insecure remote DASH URL rejected");
Check(!PlaybackLabUrlPolicy.TryValidate("https://name:pass@cdn.example.test/a.mpd", out _, out _),
    "credentials in playback URL rejected");
Check(!PlaybackLabUrlPolicy.TryValidate("https://cdn.example.test/file.mpd#fragment", out _, out _),
    "URL fragments rejected");
Check(!PlaybackLabUrlPolicy.TryValidate("https://cdn.example.test/no-extension?path=.mpd", out _, out _),
    "query strings never masquerade as a DASH filename");
Check(!PlaybackLabUrlPolicy.TryValidate("file:///C:/secret/video.mpd", out _, out _),
    "local filesystem URLs rejected");
Check(!PlaybackLabUrlPolicy.TryValidate("javascript:alert(1)", out _, out _),
    "non-media URL schemes rejected");
Console.WriteLine("BLOFY Windows playback lab policy checks passed.");


// Credential-free connectivity diagnostics: verify both healthy and failed states.
static async Task<ConnectionProbe.Result> ProbeFake(HttpStatusCode code, string body)
{
    using var client = new HttpClient(new FakeHealthHandler(code, body))
    {
        BaseAddress = new Uri("https://api.blofyplayer.com/")
    };
    return await ConnectionProbe.CheckAsync(client);
}
Check((await ProbeFake(HttpStatusCode.OK, "{\"ok\":true,\"database\":\"ready\"}")).Healthy,
    "Windows API health reports available server and database");
Check(!(await ProbeFake(HttpStatusCode.OK, "{\"ok\":true,\"database\":\"unavailable\"}")).Healthy,
    "degraded database never shown as healthy");
Check(!(await ProbeFake(HttpStatusCode.ServiceUnavailable, "{\"ok\":false}")).Healthy,
    "HTTP 503 treated as unavailable");
Check(!(await ProbeFake(HttpStatusCode.Forbidden, "forbidden")).Healthy,
    "gateway access denial treated as unavailable");
Check(!(await ProbeFake(HttpStatusCode.OK, "<html>bad gateway</html>")).Healthy,
    "non-JSON gateway response not shown as healthy");
Console.WriteLine("BLOFY Windows connectivity regression checks passed.");


var verifiedAt = DateTimeOffset.UtcNow;
Check(ActivationEntryPolicy.CanReuseRecentApproval(
    true, verifiedAt.AddDays(1).ToUnixTimeMilliseconds(),
    verifiedAt.AddSeconds(-3), verifiedAt),
    "recent online approval avoids duplicate activation network request");
Check(!ActivationEntryPolicy.CanReuseRecentApproval(
    false, null, verifiedAt, verifiedAt),
    "rejected activation is never reused");
Check(!ActivationEntryPolicy.CanReuseRecentApproval(
    true, null, verifiedAt.AddSeconds(-21), verifiedAt),
    "old approval requires a new server check");
Check(!ActivationEntryPolicy.CanReuseRecentApproval(
    true, null, verifiedAt.AddSeconds(2), verifiedAt),
    "future approval timestamp is rejected");
Check(!ActivationEntryPolicy.CanReuseRecentApproval(
    true, verifiedAt.AddSeconds(-1).ToUnixTimeMilliseconds(), verifiedAt, verifiedAt),
    "expired entitlement (milliseconds) is rejected");
Check(!ActivationEntryPolicy.CanReuseRecentApproval(
    true, verifiedAt.AddSeconds(-1).ToUnixTimeSeconds(), verifiedAt, verifiedAt),
    "expired entitlement (seconds) is rejected");
Console.WriteLine("BLOFY Windows server-verified startup checks passed.");


// A failed live stream must retry with a *different* HTTP identity.
Check(PlaybackUserAgentPolicy.Primary(null, "BLOFY PLAYER/2.0 (Windows)") ==
      PlaybackUserAgentPolicy.Android,
    "legacy Windows agent resolves to the same HTTP identity as Android Media3");
Check(PlaybackUserAgentPolicy.Alternative(PlaybackUserAgentPolicy.Android) ==
      PlaybackUserAgentPolicy.Native,
    "live playback switches from Android to native VLC agent");
Check(PlaybackUserAgentPolicy.Alternative(PlaybackUserAgentPolicy.Native) ==
      PlaybackUserAgentPolicy.Android,
    "native VLC agent falls back to Android for explicit VLC profiles");
Check(PlaybackUserAgentPolicy.Primary("IPTV-Device/1.0", "ignored") == "IPTV-Device/1.0",
    "M3U per-channel user agent is preserved");
Check(PlaybackUserAgentPolicy.Primary("not-safe\r\nheader: injected", null) ==
      PlaybackUserAgentPolicy.Android,
    "unsafe user agent cannot inject VLC HTTP headers");
Check(PlaybackUserAgentPolicy.Primary(null, null) == PlaybackUserAgentPolicy.Android,
    "absent HTTP agent uses Android Media3-compatible default");
Console.WriteLine("BLOFY Windows live playback compatibility checks passed.");

// A live direct source may expire, so native TS/HLS alternatives must get
// a chance before the alternate User-Agent is tried on a generated link.
Check(PlaybackRecoveryPolicy.MaximumRecoveries(0) == 0,
    "empty stream URL candidates have no automatic retries");
Check(PlaybackRecoveryPolicy.MaximumRecoveries(1) == 1,
    "single M3U URL retries once with the alternative HTTP agent");
Check(PlaybackRecoveryPolicy.MaximumRecoveries(2) == 3,
    "two TS/HLS candidates both get a secondary compatible agent pass");
Check(PlaybackRecoveryPolicy.MaximumRecoveries(3) == 4 &&
      PlaybackRecoveryPolicy.MaximumRecoveries(4) == 5,
    "three and four candidates have bounded native and fallback passes");
Check(PlaybackRecoveryPolicy.MaximumRecoveries(99) == 5,
    "huge URL lists can never trigger unbounded native reconnection");
Check(PlaybackRecoveryPolicy.CompatibilityStartIndex(1) == 0 &&
      PlaybackRecoveryPolicy.CompatibilityStartIndex(2) == 0 &&
      PlaybackRecoveryPolicy.CompatibilityStartIndex(3) == 1 &&
      PlaybackRecoveryPolicy.CompatibilityStartIndex(4) == 1,
    "compatibility pass prefers a generated live URL over expired direct source");
Console.WriteLine("BLOFY Windows live recovery planner regression checks passed.");

sealed class FakeHealthHandler(HttpStatusCode code, string body) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.RequestUri?.AbsolutePath != "/health")
            throw new InvalidOperationException("A health test must not transmit device credentials.");
        return Task.FromResult(new HttpResponseMessage(code)
        {
            Content = new StringContent(body)
        });
    }
}
