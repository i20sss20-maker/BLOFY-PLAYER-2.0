namespace BlofyPlayer.Windows.Core;

/// <summary>
/// Lightweight, on-device Android-style "For You" recommendations.
/// No profile/watch history is sent to a server. Operates on the already
/// indexed, bounded latest/top-title collections instead of 100k+ streams.
/// </summary>
public static class ForYouPolicy
{
    public static IReadOnlyList<StreamItem> Recommend(
        IEnumerable<StreamItem> candidates,
        IEnumerable<StreamItem> liked,
        string preferredKind,
        int take = 18)
    {
        if (take <= 0) return Array.Empty<StreamItem>();
        var references = liked
            .Where(x => x.Kind is "movie" or "series")
            .DistinctBy(x => x.Key)
            .Take(80)
            .ToList();
        var seen = references.Select(x => x.Key).ToHashSet(StringComparer.Ordinal);
        var categories = references.Where(x => !string.IsNullOrWhiteSpace(x.CategoryId))
            .GroupBy(x => x.Kind + ":" + x.CategoryId, StringComparer.Ordinal)
            .ToDictionary(x => x.Key, x => x.Count(), StringComparer.Ordinal);
        var genres = references
            .SelectMany(x => Tokens(x.Genre))
            .GroupBy(x => x, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(x => x.Key, x => x.Count(), StringComparer.OrdinalIgnoreCase);

        double Score(StreamItem item)
        {
            var value = item.Kind == preferredKind ? 10d : 0d;
            if (categories.TryGetValue(item.Kind + ":" + item.CategoryId, out var c))
                value += Math.Min(24, c * 6);
            foreach (var tag in Tokens(item.Genre))
                if (genres.TryGetValue(tag, out var count))
                    value += Math.Min(12, count * 3);
            if (double.TryParse(item.Rating?.Replace(',', '.'),
                System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out var rating))
                value += Math.Clamp(rating > 5 ? rating : rating * 2, 0, 10) / 4d;
            return value;
        }

        return candidates
            .Where(x => x.Kind is "movie" or "series" &&
                !string.IsNullOrEmpty(x.Key) && !seen.Contains(x.Key))
            .DistinctBy(x => x.Key)
            .OrderByDescending(Score)
            .ThenByDescending(x => x.AddedAt)
            .Take(Math.Min(36, take))
            .ToList();
    }

    private static IEnumerable<string> Tokens(string? value) =>
        (value ?? "").Split([',', '|', '/', ';'], StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Where(x => x.Length is > 2 and < 35)
            .Take(6);
}
