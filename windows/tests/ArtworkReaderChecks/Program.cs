using BlofyPlayer.Windows.Core;

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
