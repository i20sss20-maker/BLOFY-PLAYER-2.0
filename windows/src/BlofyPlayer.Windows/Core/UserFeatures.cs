using BlofyPlayer.Windows.Core.Identity;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace BlofyPlayer.Windows.Core;

public sealed class UserProfile
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "الرئيسي";
    public bool Kids { get; set; }
    public bool Guest { get; set; }
    public string? PinHash { get; set; }
    public long CreatedAt { get; set; } = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}

public sealed class ProfileLibraryState
{
    public HashSet<string> Favorites { get; set; } = [];
    public Dictionary<string, WatchState> WatchStates { get; set; } = [];
    public List<string> RecentSearches { get; set; } = [];
    public HashSet<string> HiddenCategoryKeys { get; set; } = [];
}

public static class ProfileSecurity
{
    private const int Iterations = 120_000;
    private const int SaltBytes = 16;
    private const int KeyBytes = 32;

    public static string HashPin(string pin)
    {
        Validate(pin);
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        var key = Rfc2898DeriveBytes.Pbkdf2(pin, salt, Iterations, HashAlgorithmName.SHA256, KeyBytes);
        return "v2$" + Iterations + "$" + Convert.ToHexString(salt) + "$" + Convert.ToHexString(key);
    }

    public static bool Verify(string? stored, string pin)
    {
        if (string.IsNullOrWhiteSpace(stored)) return true;
        try
        {
            var parts = stored.Split('$');
            if (parts.Length != 4 || parts[0] != "v2") return false;
            if (!int.TryParse(parts[1], out var iterations) || iterations is < 50_000 or > 500_000) return false;
            var salt = Convert.FromHexString(parts[2]);
            var expected = Convert.FromHexString(parts[3]);
            var actual = Rfc2898DeriveBytes.Pbkdf2(pin, salt, iterations, HashAlgorithmName.SHA256, expected.Length);
            return CryptographicOperations.FixedTimeEquals(expected, actual);
        }
        catch { return false; }
    }

    private static void Validate(string pin)
    {
        if (pin.Length is < 4 or > 8 || pin.Any(c => !char.IsDigit(c)))
            throw new ArgumentException("PIN must contain 4 to 8 digits.");
    }
}

public static class KidsPolicy
{
    private static readonly string[] Terms =
    [
        "adult", "adults only", "18+", "+18", "18 plus", "r18", "r18+", "nc-17", "nc17", "tv-ma",
        "xxx", "porn", "erotic", "erotica", "sexual", "nude", "nudity", "uncensored", "playboy",
        "للكبار", "للبالغين", "بالغين", "18 سنة", "اباح", "إباح", "جنسي", "جنسية", "عري"
    ];

    public static bool IsBlocked(StreamItem item)
    {
        var text = string.Join(' ', item.Name, item.Genre, item.Plot).ToLowerInvariant().Replace('_', ' ');
        if (string.IsNullOrWhiteSpace(text)) return false;
        if (Regex.IsMatch(text, @"(?<![\p{L}\p{N}])sex(?![\p{L}\p{N}])", RegexOptions.IgnoreCase))
            return true;
        return Terms.Any(text.Contains);
    }
}

public sealed class BackupPayload
{
    public int Schema { get; set; } = 2;
    public long CreatedAt { get; set; } = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    public string AppVersion { get; set; } = "windows-0.3.0";
    public string ProviderId { get; set; } = "";
    public string ProviderName { get; set; } = "";
    public string ProfileId { get; set; } = "";
    public string ProfileName { get; set; } = "";
    public ProfileLibraryState Library { get; set; } = new();
    public AppSettings Settings { get; set; } = new();
}

public static class BackupService
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true
    };

    public static string Export(LocalStore store)
    {
        var provider = store.ActiveProvider() ?? throw new InvalidOperationException("لا توجد قائمة نشطة.");
        var profile = store.ActiveProfile();
        var library = store.ActiveLibrary();
        var payload = new BackupPayload
        {
            ProviderId = provider.Id,
            ProviderName = provider.Name,
            ProfileId = profile.Id,
            ProfileName = profile.Name,
            Library = new ProfileLibraryState
            {
                Favorites = new HashSet<string>(library.Favorites),
                WatchStates = library.WatchStates.ToDictionary(x => x.Key, x => x.Value),
                RecentSearches = library.RecentSearches.Take(30).ToList(),
                HiddenCategoryKeys = new HashSet<string>(library.HiddenCategoryKeys)
            },
            Settings = store.State.Settings
        };
        return JsonSerializer.Serialize(payload, Json);
    }

    public static async Task RestoreAsync(LocalStore store, string json)
    {
        if (json.Length > 8 * 1024 * 1024) throw new InvalidOperationException("ملف النسخة الاحتياطية كبير جدًا.");
        var payload = JsonSerializer.Deserialize<BackupPayload>(json, Json)
            ?? throw new InvalidOperationException("ملف النسخة الاحتياطية غير صالح.");
        if (payload.Schema is < 1 or > 2) throw new InvalidOperationException("إصدار النسخة الاحتياطية غير مدعوم.");

        var provider = store.ActiveProvider() ?? throw new InvalidOperationException("لا توجد قائمة نشطة.");
        if (!string.Equals(provider.Id, payload.ProviderId, StringComparison.Ordinal))
            throw new InvalidOperationException("هذه النسخة تخص سيرفرًا مختلفًا.");

        var library = store.ActiveLibrary();
        library.Favorites = payload.Library.Favorites ?? [];
        library.WatchStates = payload.Library.WatchStates ?? [];
        library.RecentSearches = (payload.Library.RecentSearches ?? []).Where(x => !string.IsNullOrWhiteSpace(x)).Take(30).ToList();
        library.HiddenCategoryKeys = payload.Library.HiddenCategoryKeys ?? [];
        store.State.Settings = payload.Settings ?? new AppSettings();
        await store.SaveAsync();
    }
}

public sealed record WindowsUpdateInfo(string Version, string DownloadUrl, string Notes);

public static class WindowsUpdateService
{
    private const string ReleasesApi = "https://api.github.com/repos/i20sss20-maker/BLOFY-PLAYER-2.0/releases?per_page=20";

    public static async Task<WindowsUpdateInfo?> CheckAsync(CancellationToken ct = default)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };
        client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "BLOFY-PLAYER-Windows/0.3");
        using var response = await client.GetAsync(ReleasesApi, ct);
        if (!response.IsSuccessStatusCode) return null;
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return null;

        foreach (var release in doc.RootElement.EnumerateArray())
        {
            if (release.TryGetProperty("draft", out var draft) && draft.GetBoolean()) continue;
            if (!release.TryGetProperty("assets", out var assets) || assets.ValueKind != JsonValueKind.Array) continue;
            foreach (var asset in assets.EnumerateArray())
            {
                var name = asset.TryGetProperty("name", out var n) ? (n.GetString() ?? "") : "";
                if (!name.Contains("windows", StringComparison.OrdinalIgnoreCase)) continue;
                if (!(name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ||
                      name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) ||
                      name.EndsWith(".msix", StringComparison.OrdinalIgnoreCase))) continue;
                var url = asset.TryGetProperty("browser_download_url", out var u) ? (u.GetString() ?? "") : "";
                if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed) || parsed.Scheme != Uri.UriSchemeHttps) continue;
                var version = release.TryGetProperty("tag_name", out var tag) ? (tag.GetString() ?? "Windows") : "Windows";
                var notes = release.TryGetProperty("body", out var body) ? (body.GetString() ?? "") : "";
                return new WindowsUpdateInfo(version, url, notes.Length > 600 ? notes[..600] : notes);
            }
        }
        return null;
    }
}

public static class DiagnosticService
{
    public static string Build(LocalStore store, BlofyIdentity identity, string activation, CatalogSnapshot? catalog)
    {
        var provider = store.ActiveProvider();
        var profile = store.ActiveProfile();
        var library = store.ActiveLibrary();
        var root = store.RootPath;
        return string.Join(Environment.NewLine,
            "BLOFY PLAYER — Windows Diagnostics",
            "Version: Windows 0.3.0",
            "Device: " + identity.DeviceId,
            "Activation: " + activation,
            "Windows: " + Environment.OSVersion.VersionString,
            "Architecture: " + RuntimeInformation.OSArchitecture,
            "64-bit process: " + Environment.Is64BitProcess,
            "Profile: " + profile.Name + " (Kids=" + profile.Kids + ", Guest=" + profile.Guest + ")",
            "Provider: " + (provider?.Name ?? "None"),
            "Provider type: " + (provider?.ProviderType ?? "-"),
            "Catalog items: " + (catalog?.Streams.Count ?? 0),
            "Categories: " + (catalog?.Categories.Count ?? 0),
            "Favorites: " + library.Favorites.Count,
            "Watch states: " + library.WatchStates.Count,
            "Data folder: " + root,
            "Storage: " + FormatBytes(DirectoryBytes(root)),
            "Local time: " + DateTimeOffset.Now.ToString("yyyy-MM-dd HH:mm:ss zzz")
        );
    }

    public static long DirectoryBytes(string path)
    {
        try
        {
            if (!Directory.Exists(path)) return 0;
            return Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories)
                .Sum(file => { try { return new FileInfo(file).Length; } catch { return 0L; } });
        }
        catch { return 0; }
    }

    public static string FormatBytes(long value)
    {
        string[] units = ["B", "KB", "MB", "GB"];
        double size = value;
        var index = 0;
        while (size >= 1024 && index < units.Length - 1) { size /= 1024; index++; }
        return size.ToString("0.##") + " " + units[index];
    }
}
