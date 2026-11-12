using System.Buffers;
using System.IO;

namespace BlofyPlayer.Windows.Core;

/// <summary>
/// Streams local VLC loopback traffic without an absolute session deadline.
/// Per-read inactivity timeouts release hung provider sockets; any successful
/// chunk starts a fresh idle window. The caller's request-aborted token
/// promptly stops work after VLC seeks, closes, or changes channels.
/// </summary>
public static class StreamMediaCopyPolicy
{
    public static readonly TimeSpan ResponseHeaderTimeout = TimeSpan.FromSeconds(25);
    public static readonly TimeSpan LiveInactivityTimeout = TimeSpan.FromMinutes(2);
    public static readonly TimeSpan VodInactivityTimeout = TimeSpan.FromMinutes(5);

    public static async Task CopyAsync(
        Stream upstream,
        Stream downstream,
        CancellationToken requestAborted,
        TimeSpan? inactivityTimeout = null)
    {
        ArgumentNullException.ThrowIfNull(upstream);
        ArgumentNullException.ThrowIfNull(downstream);
        var idleLimit = inactivityTimeout ?? LiveInactivityTimeout;
        if (idleLimit < TimeSpan.FromMilliseconds(50) || idleLimit > TimeSpan.FromMinutes(10))
            throw new ArgumentOutOfRangeException(nameof(inactivityTimeout));

        var rented = ArrayPool<byte>.Shared.Rent(64 * 1024);
        try
        {
            while (true)
            {
                // Time out *inactivity*, not playback length. No fixed 20-minute stop.
                using var idle = CancellationTokenSource.CreateLinkedTokenSource(requestAborted);
                idle.CancelAfter(idleLimit);
                var read = await upstream.ReadAsync(
                    rented.AsMemory(0, rented.Length), idle.Token).ConfigureAwait(false);
                if (read == 0) return;
                // Respect loopback backpressure; never buffer unbounded viewer data.
                await downstream.WriteAsync(
                    rented.AsMemory(0, read), requestAborted).ConfigureAwait(false);
            }
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(rented);
        }
    }
}
