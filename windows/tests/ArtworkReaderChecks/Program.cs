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
