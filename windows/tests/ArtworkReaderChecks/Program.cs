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
