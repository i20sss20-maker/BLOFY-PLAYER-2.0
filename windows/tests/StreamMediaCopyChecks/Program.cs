using BlofyPlayer.Windows.Core;
using System.Diagnostics;
using System.IO;

static void Check(bool ok, string reason)
{
    if (!ok) throw new Exception(reason);
}

var payload = new byte[] {0x47, 0x11, 0x22, 0x33};

// Continuous playback: total duration > per-read timeout MUST still succeed.
using (var slow = new DelayedChunkStream(payload, 4, TimeSpan.FromMilliseconds(75)))
using (var output = new MemoryStream())
{
    var started = Stopwatch.StartNew();
    await StreamMediaCopyPolicy.CopyAsync(
        slow, output, CancellationToken.None, TimeSpan.FromMilliseconds(150));
    Check(started.ElapsedMilliseconds >= 250, "test should outlive the per-read idle interval");
    Check(output.ToArray().Length == payload.Length * 4, "all video chunks must arrive");
}

// A genuinely idle provider is stopped so it does not reserve a proxy slot indefinitely.
using (var stalled = new DelayedChunkStream(payload, 1, TimeSpan.FromMilliseconds(250)))
using (var output = new MemoryStream())
{
    try
    {
        await StreamMediaCopyPolicy.CopyAsync(
            stalled, output, CancellationToken.None, TimeSpan.FromMilliseconds(80));
        throw new Exception("expected timeout for idle source");
    }
    catch (OperationCanceledException) { }
}

// A disconnected VLC client must cancel promptly.
using (var stalled = new DelayedChunkStream(payload, 1, TimeSpan.FromMilliseconds(400)))
using (var output = new MemoryStream())
using (var abort = new CancellationTokenSource(TimeSpan.FromMilliseconds(75)))
{
    try
    {
        await StreamMediaCopyPolicy.CopyAsync(stalled, output, abort.Token,
            TimeSpan.FromSeconds(1));
        throw new Exception("expected cancellation when loopback viewer exits");
    }
    catch (OperationCanceledException) { }
}

Check(StreamMediaCopyPolicy.ResponseHeaderTimeout < TimeSpan.FromMinutes(1),
    "headers must not hang indefinitely");
Check(StreamMediaCopyPolicy.LiveInactivityTimeout > TimeSpan.FromSeconds(30),
    "idle timeout must be per read, not an aggressive false-positive");
Console.WriteLine("PASS continuous chunks beyond nominal timeout, true idle cutoff, viewer abort.");

internal sealed class DelayedChunkStream : Stream
{
    private readonly byte[] _chunk;
    private int _remaining;
    private readonly TimeSpan _delay;
    public DelayedChunkStream(byte[] chunk, int count, TimeSpan delay)
    {
        _chunk = chunk; _remaining = count; _delay = delay;
    }
    public override async ValueTask<int> ReadAsync(
        Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        if (_remaining == 0) return 0;
        await Task.Delay(_delay, cancellationToken);
        _chunk.CopyTo(buffer);
        _remaining--;
        return _chunk.Length;
    }
    public override int Read(byte[] buffer, int offset, int count) =>
        throw new NotSupportedException();
    public override void Flush() => throw new NotSupportedException();
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position {
        get => throw new NotSupportedException();
        set => throw new NotSupportedException();
    }
}
