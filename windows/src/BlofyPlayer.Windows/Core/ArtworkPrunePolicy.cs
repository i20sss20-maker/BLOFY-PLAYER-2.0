namespace BlofyPlayer.Windows.Core;

public readonly record struct ArtworkFileEntry(string Path, long Bytes, DateTime LastWriteTimeUtc);

/// <summary>
/// Deterministic quota policy used by artwork disk maintenance. Retains the
/// newest image entries within both count and byte limits; never throws away
/// freshly-downloaded posters solely because old entries filled the cache.
/// </summary>
public static class ArtworkPrunePolicy
{
    public static IReadOnlyList<string> PlanEvictions(
        IEnumerable<ArtworkFileEntry> entries, long maxBytes, int maxFiles)
    {
        ArgumentNullException.ThrowIfNull(entries);
        if (maxBytes < 0) throw new ArgumentOutOfRangeException(nameof(maxBytes));
        if (maxFiles < 0) throw new ArgumentOutOfRangeException(nameof(maxFiles));

        var sorted = entries
            .OrderByDescending(e => e.LastWriteTimeUtc)
            .ThenBy(e => e.Path, StringComparer.Ordinal)
            .ToArray();

        var evict = new List<string>();
        long bytesKept = 0;
        var filesKept = 0;
        foreach (var file in sorted)
        {
            var length = Math.Max(0, file.Bytes);
            if (filesKept >= maxFiles || length > maxBytes - bytesKept)
            {
                evict.Add(file.Path);
                continue;
            }

            bytesKept += length;
            filesKept++;
        }

        return evict;
    }
}
