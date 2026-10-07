using BlofyPlayer.Windows.Core.Identity;
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
    private readonly Dictionary<string, List<StreamItem>> _collections;

    public static CatalogViewIndex Empty { get; } = new(
        new(StringComparer.OrdinalIgnoreCase),
        new(StringComparer.OrdinalIgnoreCase),
        new(StringComparer.Ordinal),
        new(StringComparer.OrdinalIgnoreCase),
        new(StringComparer.OrdinalIgnoreCase));

    private CatalogViewIndex(
        Dictionary<string, List<StreamItem>> byKind,
        Dictionary<string, List<StreamItem>> byCategory,
        Dictionary<string, StreamItem> byKey,
        Dictionary<string, List<StreamItem>> latest,
        Dictionary<string, List<StreamItem>> collections)
    {
        _byKind = byKind;
        _byCategory = byCategory;
        _byKey = byKey;
        _latest = latest;
        _collections = collections;
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

        var allVod = byKind
            .Where(x => x.Key.Equals("movie", StringComparison.OrdinalIgnoreCase) ||
                        x.Key.Equals("series", StringComparison.OrdinalIgnoreCase))
            .SelectMany(x => x.Value)
            .ToList();

        static double RatingValue(string raw)
        {
            if (!double.TryParse((raw ?? "").Replace(',', '.'),
                    System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture,
                    out var value)) return 0;
            return value <= 5 ? value * 2 : value;
        }

        static bool HasArabic(string value) =>
            !string.IsNullOrWhiteSpace(value) && value.Any(ch => ch >= '\u0600' && ch <= '\u06FF');

        var collections = new Dictionary<string, List<StreamItem>>(StringComparer.OrdinalIgnoreCase)
        {
            ["latest"] = allVod.OrderByDescending(x => x.AddedAt).Take(48).ToList(),
            ["top"] = allVod.Where(x => RatingValue(x.Rating) > 0)
                .OrderByDescending(x => RatingValue(x.Rating)).Take(48).ToList(),
            ["arabic"] = allVod.Where(x => HasArabic(x.Name) || HasArabic(x.Genre) ||
                (x.Genre ?? "").Contains("arab", StringComparison.OrdinalIgnoreCase)).Take(48).ToList(),
            ["4k"] = allVod.Where(x =>
                (x.Name ?? "").Contains("4K", StringComparison.OrdinalIgnoreCase) ||
                (x.Name ?? "").Contains("UHD", StringComparison.OrdinalIgnoreCase) ||
                (x.Genre ?? "").Contains("4K", StringComparison.OrdinalIgnoreCase)).Take(48).ToList()
        };

        return new CatalogViewIndex(byKind, byCategory, byKey, latest, collections);
    }

    public IReadOnlyList<StreamItem> Kind(string kind) =>
        _byKind.TryGetValue(kind, out var list) ? list : Array.Empty<StreamItem>();

    public IReadOnlyList<StreamItem> Category(string kind, string categoryId) =>
        _byCategory.TryGetValue(CategoryKey(kind, categoryId), out var list)
            ? list
            : Array.Empty<StreamItem>();

    public IReadOnlyList<StreamItem> Latest(string kind) =>
        _latest.TryGetValue(kind, out var list) ? list : Array.Empty<StreamItem>();

    public IReadOnlyList<StreamItem> Collection(string key) =>
        _collections.TryGetValue(key, out var list) ? list : Array.Empty<StreamItem>();

    public StreamItem? Find(string key) =>
        _byKey.TryGetValue(key, out var item) ? item : null;

    private static string CategoryKey(string kind, string categoryId) =>
        kind + "\u001F" + categoryId;
}


public static class StartupCatalogTransfer
{
    private static readonly object Gate = new();
    private static CatalogSnapshot? _snapshot;

    public static void Store(CatalogSnapshot snapshot)
    {
        lock (Gate) _snapshot = snapshot;
    }

    public static CatalogSnapshot? Take(string providerId)
    {
        lock (Gate)
        {
            if (_snapshot is null || !_snapshot.ProviderId.Equals(providerId, StringComparison.Ordinal))
                return null;
            var value = _snapshot;
            _snapshot = null;
            return value;
        }
    }
}


public static class StartupSessionTransfer
{
    private static readonly object Gate = new();
    private static ActivationCheckResponse? _activation;
    private static bool _portalSynced;

    public static void Store(ActivationCheckResponse? activation, bool portalSynced)
    {
        lock (Gate)
        {
            _activation = activation;
            _portalSynced = portalSynced;
        }
    }

    public static (ActivationCheckResponse? Activation, bool PortalSynced) Take()
    {
        lock (Gate)
        {
            var result = (_activation, _portalSynced);
            _activation = null;
            _portalSynced = false;
            return result;
        }
    }
}
