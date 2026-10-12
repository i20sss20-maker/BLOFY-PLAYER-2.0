namespace BlofyPlayer.Windows.Core;

/// <summary>Enforces a hard byte cap for streaming M3U or other untrusted payloads.</summary>
public sealed class LengthLimitedStream : Stream
{
    private readonly Stream _inner;
    private readonly long _limit;
    private long _count;

    public LengthLimitedStream(Stream inner, long limit)
    {
        _inner = inner ?? throw new ArgumentNullException(nameof(inner));
        if (limit < 0) throw new ArgumentOutOfRangeException(nameof(limit));
        _limit = limit;
    }

    public override bool CanRead => _inner.CanRead;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position
    {
        get => _count;
        set => throw new NotSupportedException();
    }

    private int Allowed(int requested) =>
        (int)Math.Min(requested, Math.Max(0, _limit - _count + 1));

    private int Record(int read)
    {
        _count += read;
        if (_count > _limit)
            throw new InvalidDataException("M3U playlist exceeds the maximum supported size.");
        return read;
    }

    public override int Read(byte[] buffer, int offset, int count) =>
        Record(_inner.Read(buffer, offset, Allowed(count)));

    public override int Read(Span<byte> buffer) =>
        Record(_inner.Read(buffer[..Allowed(buffer.Length)]));

    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default) =>
        Record(await _inner.ReadAsync(buffer[..Allowed(buffer.Length)], ct).ConfigureAwait(false));

    public override async Task<int> ReadAsync(
        byte[] buffer, int offset, int count, CancellationToken ct) =>
        Record(await _inner.ReadAsync(buffer, offset, Allowed(count), ct).ConfigureAwait(false));

    public override void Flush() => _inner.Flush();
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    protected override void Dispose(bool disposing)
    {
        if (disposing) _inner.Dispose();
        base.Dispose(disposing);
    }

    public override async ValueTask DisposeAsync()
    {
        await _inner.DisposeAsync().ConfigureAwait(false);
        await base.DisposeAsync().ConfigureAwait(false);
    }
}
