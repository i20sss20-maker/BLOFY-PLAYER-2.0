namespace BlofyPlayer.Windows.Core;

/// <summary>
/// Lightweight read index for the UI. It keeps references to the catalog objects rather than
/// cloning them, so very large providers can be browsed without repeatedly scanning or copying
/// hundreds of thousands of rows on the WPF dispatcher thread.
/// </summary>
public sealed class CatalogViewIndex
{
    private readonly Dictionary<string, List<StreamItem>> _byKind;
    private readonly Dictionary<string, List<StreamItem>> _byCategory;
    private readonly Dictionary<string, StreamItem> _byKey;
    private readonly Dictionary<string, List<StreamItem>> _latest;

    public static CatalogViewIndex Empty { get; } = new(
        new(StringComparer.OrdinalIgnoreCase),
        new(StringComparer.OrdinalIgnoreCase),
        new(StringComparer.Ordinal),
        new(StringComparer.OrdinalIgnoreCase));

    private CatalogViewIndex(
        Dictionary<string, List<StreamItem>> byKind,
        Dictionary<string, List<StreamItem>> byCategory,
        Dictionary<string, StreamItem> byKey,
        Dictionary<string, List<StreamItem>> latest)
    {
        _byKind = byKind;
        _byCategory = byCategory;
        _byKey = byKey;
        _latest = latest;
    }

    public static CatalogViewIndex Build(CatalogSnapshot snapshot)
    {
        var byKind = new Dictionary<string, List<StreamItem>>(StringComparer.OrdinalIgnoreCase);
        var byCategory = new Dictionary<string, List<StreamItem>>(StringComparer.OrdinalIgnoreCase);
        var byKey = new Dictionary<string, StreamItem>(Math.Max(0, snapshot.Streams.Count), StringComparer.Ordinal);

        foreach (var item in snapshot.Streams)
        {
            if (!byKind.TryGetValue(item.Kind, out var kindItems))
                byKind[item.Kind] = kindItems = [];
            kindItems.Add(item);

            if (!string.IsNullOrWhiteSpace(item.CategoryId))
            {
                var categoryKey = CategoryKey(item.Kind, item.CategoryId);
                if (!byCategory.TryGetValue(categoryKey, out var categoryItems))
                    byCategory[categoryKey] = categoryItems = [];
                categoryItems.Add(item);
            }

            if (!string.IsNullOrWhiteSpace(item.Key))
                byKey[item.Key] = item;
        }

        var latest = new Dictionary<string, List<StreamItem>>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in byKind)
        {
            if (pair.Key.Equals("movie", StringComparison.OrdinalIgnoreCase) ||
                pair.Key.Equals("series", StringComparison.OrdinalIgnoreCase))
            {
                latest[pair.Key] = pair.Value
                    .OrderByDescending(x => x.AddedAt)
                    .Take(32)
                    .ToList();
            }
        }

        return new CatalogViewIndex(byKind, byCategory, byKey, latest);
    }

    public IReadOnlyList<StreamItem> Kind(string kind) =>
        _byKind.TryGetValue(kind, out var list) ? list : Array.Empty<StreamItem>();

    public IReadOnlyList<StreamItem> Category(string kind, string categoryId) =>
        _byCategory.TryGetValue(CategoryKey(kind, categoryId), out var list)
            ? list
            : Array.Empty<StreamItem>();

    public IReadOnlyList<StreamItem> Latest(string kind) =>
        _latest.TryGetValue(kind, out var list) ? list : Array.Empty<StreamItem>();

    public StreamItem? Find(string key) =>
        _byKey.TryGetValue(key, out var item) ? item : null;

    private static string CategoryKey(string kind, string categoryId) =>
        kind + "\u001F" + categoryId;
}
