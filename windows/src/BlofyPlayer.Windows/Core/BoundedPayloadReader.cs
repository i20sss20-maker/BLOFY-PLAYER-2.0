using System.IO;

namespace BlofyPlayer.Windows.Core;

/// <summary>
/// Reads a remote payload without ever allocating beyond a known upper limit.
/// Returns null for empty input or when the stream contains too much data.
/// </summary>
internal static class BoundedPayloadReader
{
    public static async Task<byte[]?> ReadAsync(Stream source, int maxBytes, CancellationToken ct)
    {
        if (maxBytes <= 0) throw new ArgumentOutOfRangeException(nameof(maxBytes));
        ArgumentNullException.ThrowIfNull(source);
        ct.ThrowIfCancellationRequested();

        using var output = new MemoryStream();
        var buffer = new byte[64 * 1024];
        while (true)
        {
            // Request one extra byte to detect overflow without buffering it.
            var remaining = maxBytes - (int)output.Length;
            var request = Math.Min(buffer.Length, remaining + 1);
            var count = await source.ReadAsync(buffer.AsMemory(0, request), ct)
                .ConfigureAwait(false);
            if (count == 0)
                return output.Length == 0 ? null : output.ToArray();
            if (count > remaining)
                return null;
            output.Write(buffer.AsSpan(0, count));
        }
    }
}
