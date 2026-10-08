using BlofyPlayer.Windows.Core.Identity;
using System.Net.Http;
using System.Net.Http.Json;
using System.IO;
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
    public List<string> RecentChannels { get; set; } = [];
    public HashSet<string> HiddenCategoryKeys { get; set; } = [];
    public List<string> HomeRows { get; set; } = ["continue", "latest_movies", "latest_series"];
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
    public string AppVersion { get; set; } = "windows-0.4.2";
    public string ProviderId { get; set; } = "";
    public string ProviderName { get; set; } = "";
    public string ProfileId { get; set; } = "";
    public string ProfileName { get; set; } = "";
    public ProfileLibraryState Library { get; set; } = new();
    public HashSet<string> LockedContentKeys { get; set; } = [];
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
                RecentChannels = library.RecentChannels.Take(30).ToList(),
                HiddenCategoryKeys = new HashSet<string>(library.HiddenCategoryKeys),
                HomeRows = library.HomeRows.ToList()
            },
            LockedContentKeys = store.State.LockedContentKeys
                .Where(key => key.StartsWith(provider.Id + ":", StringComparison.Ordinal))
                .ToHashSet(),
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
        library.RecentChannels = (payload.Library.RecentChannels ?? []).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().Take(30).ToList();
        library.HiddenCategoryKeys = payload.Library.HiddenCategoryKeys ?? [];
        library.HomeRows = (payload.Library.HomeRows ?? [])
            .Where(x => x is "continue" or "latest_movies" or "latest_series")
            .Distinct().ToList();
        if (library.HomeRows.Count == 0) library.HomeRows = ["continue", "latest_movies", "latest_series"];
        store.State.LockedContentKeys.RemoveWhere(key => key.StartsWith(provider.Id + ":", StringComparison.Ordinal));
        foreach (var key in payload.LockedContentKeys ?? [])
            if (key.StartsWith(provider.Id + ":", StringComparison.Ordinal))
                store.State.LockedContentKeys.Add(key);
        store.State.Settings = payload.Settings ?? new AppSettings();
        await store.SaveAsync();
    }
}

public sealed record ProfileCloudResult(string Action, long Revision);
public sealed record ProfilePairCode(string Code, long ExpiresAt, int TtlMinutes);

public static class ProfileCloudService
{
    private const string BaseUrl = BlofyEndpoints.ServiceBase;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    private static HttpClient Client()
    {
        var handler = new HttpClientHandler { AllowAutoRedirect = false };
        var client = new HttpClient(handler)
        {
            BaseAddress = new Uri(BaseUrl),
            Timeout = TimeSpan.FromSeconds(15)
        };
        client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "BLOFY-PLAYER-Windows/0.4.2");
        return client;
    }

    public static async Task<ProfileCloudResult> BackupAsync(LocalStore store, BlofyIdentity identity, CancellationToken ct = default)
    {
        var profile = store.ActiveProfile();
        if (profile.Guest) throw new InvalidOperationException("ملف الضيف محلي فقط.");
        var remote = await GetAsync(identity, profile.Id, ct);
        var payload = Payload(store);
        var saved = await PutAsync(identity, profile.Id, remote.Revision, payload, ct);
        if (saved.Conflict)
        {
            remote = await GetAsync(identity, profile.Id, ct);
            saved = await PutAsync(identity, profile.Id, remote.Revision, payload, ct);
        }
        if (saved.Conflict) throw new InvalidOperationException("تعارضت نسخة السحابة. أعد المحاولة.");
        return new ProfileCloudResult("backup", saved.Revision);
    }

    public static async Task<ProfileCloudResult> RestoreAsync(LocalStore store, BlofyIdentity identity, CancellationToken ct = default)
    {
        var profile = store.ActiveProfile();
        if (profile.Guest) throw new InvalidOperationException("ملف الضيف محلي فقط.");
        var remote = await GetAsync(identity, profile.Id, ct);
        if (!remote.Exists) return new ProfileCloudResult("no_backup", 0);
        ApplyPayload(store, remote.Payload);
        await store.SaveAsync();
        return new ProfileCloudResult("restore", remote.Revision);
    }

    public static async Task<ProfilePairCode> CreatePairCodeAsync(LocalStore store, BlofyIdentity identity, CancellationToken ct = default)
    {
        await BackupAsync(store, identity, ct);
        var profile = store.ActiveProfile();
        using var client = Client();
        using var response = await client.PostAsJsonAsync(BlofyEndpoints.CloudProfile + "/pair/create",
            new { deviceId = identity.DeviceId, activationCode = identity.ActivationCode, profileId = profile.Id }, Json, ct);
        var raw = await response.Content.ReadAsStringAsync(ct);
        if ((int)response.StatusCode != 201) throw new InvalidOperationException(ReadError(raw, "تعذر إنشاء كود الربط."));
        using var doc = JsonDocument.Parse(raw);
        return new ProfilePairCode(
            doc.RootElement.GetProperty("pairCode").GetString() ?? "",
            GetLong(doc.RootElement, "expiresAt"),
            (int)Math.Max(1, GetLong(doc.RootElement, "ttlMinutes", 10))
        );
    }

    public static async Task<ProfileCloudResult> RestorePairCodeAsync(
        LocalStore store, BlofyIdentity identity, string code, CancellationToken ct = default)
    {
        var profile = store.ActiveProfile();
        if (profile.Guest) throw new InvalidOperationException("ملف الضيف محلي فقط.");
        using var client = Client();
        using var response = await client.PostAsJsonAsync(BlofyEndpoints.CloudProfile + "/pair/restore",
            new
            {
                deviceId = identity.DeviceId,
                activationCode = identity.ActivationCode,
                profileId = profile.Id,
                pairCode = code.Trim().ToUpperInvariant()
            }, Json, ct);
        var raw = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException(ReadError(raw, "تعذر استعادة كود الربط."));
        using var doc = JsonDocument.Parse(raw);
        var revision = GetLong(doc.RootElement, "revision", 1);
        if (doc.RootElement.TryGetProperty("payload", out var payload))
        {
            ApplyPayload(store, payload);
            await store.SaveAsync();
        }
        return new ProfileCloudResult("pair_restore", revision);
    }

    private static async Task<(bool Exists, long Revision, JsonElement Payload)> GetAsync(
        BlofyIdentity identity, string profileId, CancellationToken ct)
    {
        using var client = Client();
        var request = new HttpRequestMessage(HttpMethod.Get,
            BlofyEndpoints.CloudProfile + "?profileId=" + Uri.EscapeDataString(profileId));
        request.Headers.TryAddWithoutValidation("X-BLOFY-Device-ID", identity.DeviceId);
        request.Headers.TryAddWithoutValidation("X-BLOFY-Activation-Code", identity.ActivationCode);
        using var response = await client.SendAsync(request, ct);
        var raw = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException(ReadError(raw, "تعذر قراءة BLOFY Cloud."));
        using var doc = JsonDocument.Parse(raw);
        var exists = doc.RootElement.TryGetProperty("exists", out var e) && e.GetBoolean();
        var revision = GetLong(doc.RootElement, "revision");
        var payload = doc.RootElement.TryGetProperty("payload", out var p)
            ? p.Clone()
            : JsonSerializer.SerializeToElement(new { });
        return (exists, revision, payload);
    }

    private static async Task<(bool Conflict, long Revision)> PutAsync(
        BlofyIdentity identity, string profileId, long expectedRevision, JsonElement payload, CancellationToken ct)
    {
        using var client = Client();
        using var request = new HttpRequestMessage(HttpMethod.Put, BlofyEndpoints.CloudProfile)
        {
            Content = JsonContent.Create(new
            {
                deviceId = identity.DeviceId,
                activationCode = identity.ActivationCode,
                profileId,
                expectedRevision,
                payload
            }, options: Json)
        };
        using var response = await client.SendAsync(request, ct);
        var raw = await response.Content.ReadAsStringAsync(ct);
        if ((int)response.StatusCode == 409)
        {
            using var conflictDoc = JsonDocument.Parse(string.IsNullOrWhiteSpace(raw) ? "{}" : raw);
            return (true, GetLong(conflictDoc.RootElement, "revision", expectedRevision));
        }
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException(ReadError(raw, "تعذر حفظ BLOFY Cloud."));
        using var doc = JsonDocument.Parse(raw);
        return (false, GetLong(doc.RootElement, "revision", expectedRevision + 1));
    }

    private static JsonElement Payload(LocalStore store)
    {
        var library = store.ActiveLibrary();
        var settings = store.State.Settings;
        return JsonSerializer.SerializeToElement(new
        {
            watchlist = library.Favorites.TakeLast(500).ToArray(),
            hiddenCategories = library.HiddenCategoryKeys.Take(500).ToArray(),
            homeRows = library.HomeRows.Take(20).ToArray(),
            settings = new Dictionary<string, object>
            {
                ["theme"] = settings.Theme,
                ["language"] = settings.Language,
                ["liveFormat"] = settings.LiveFormat,
                ["subtitleLanguage"] = settings.SubtitleLanguage,
                ["subtitleSize"] = settings.SubtitleSize,
                ["aspect"] = settings.Aspect,
                ["audioOutput"] = settings.AudioOutput,
                ["autoplayLive"] = settings.AutoplayLive,
                ["resumePrompt"] = settings.ResumePrompt,
                ["autoNext"] = settings.AutoNext,
                ["catalogDensity"] = settings.CatalogDensity
            }
        }, Json);
    }

    private static void ApplyPayload(LocalStore store, JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object) return;
        var library = store.ActiveLibrary();

        if (payload.TryGetProperty("watchlist", out var watchlist) && watchlist.ValueKind == JsonValueKind.Array)
            library.Favorites = watchlist.EnumerateArray()
                .Select(x => x.GetString()).Where(x => !string.IsNullOrWhiteSpace(x))
                .Cast<string>().Take(500).ToHashSet();

        if (payload.TryGetProperty("hiddenCategories", out var hidden) && hidden.ValueKind == JsonValueKind.Array)
            library.HiddenCategoryKeys = hidden.EnumerateArray()
                .Select(x => x.GetString()).Where(x => !string.IsNullOrWhiteSpace(x))
                .Cast<string>().Take(500).ToHashSet();

        if (payload.TryGetProperty("homeRows", out var rows) && rows.ValueKind == JsonValueKind.Array)
        {
            var nextRows = rows.EnumerateArray().Select(x => x.GetString())
                .Where(x => x is "continue" or "latest_movies" or "latest_series")
                .Cast<string>().Distinct().ToList();
            if (nextRows.Count > 0) library.HomeRows = nextRows;
        }

        if (!payload.TryGetProperty("settings", out var s) || s.ValueKind != JsonValueKind.Object) return;
        string? GetString(string key) => s.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        bool? GetBool(string key) => s.TryGetProperty(key, out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False ? v.GetBoolean() : null;

        var settings = store.State.Settings;
        settings.Theme = GetString("theme") ?? settings.Theme;
        settings.Language = GetString("language") ?? settings.Language;
        settings.LiveFormat = GetString("liveFormat") ?? settings.LiveFormat;
        settings.SubtitleLanguage = GetString("subtitleLanguage") ?? settings.SubtitleLanguage;
        settings.SubtitleSize = GetString("subtitleSize") ?? settings.SubtitleSize;
        settings.Aspect = GetString("aspect") ?? settings.Aspect;
        settings.AudioOutput = GetString("audioOutput") ?? settings.AudioOutput;
        settings.AutoplayLive = GetBool("autoplayLive") ?? settings.AutoplayLive;
        settings.ResumePrompt = GetBool("resumePrompt") ?? settings.ResumePrompt;
        settings.AutoNext = GetString("autoNext") ?? settings.AutoNext;
        settings.CatalogDensity = GetString("catalogDensity") ?? settings.CatalogDensity;
    }

    private static string ReadError(string raw, string fallback)
    {
        try
        {
            using var doc = JsonDocument.Parse(raw);
            return doc.RootElement.TryGetProperty("error", out var e) && !string.IsNullOrWhiteSpace(e.GetString())
                ? e.GetString()!
                : fallback;
        }
        catch { return fallback; }
    }

    private static long GetLong(JsonElement root, string key, long fallback = 0) =>
        root.TryGetProperty(key, out var value) && value.TryGetInt64(out var parsed) ? parsed : fallback;
}

public sealed record WindowsUpdateInfo(string Version, string DownloadUrl, string Notes);

public static class WindowsUpdateService
{
    private const string ReleasesApi = "https://api.github.com/repos/i20sss20-maker/BLOFY-PLAYER-2.0/releases?per_page=20";

    public static async Task<WindowsUpdateInfo?> CheckAsync(CancellationToken ct = default)
    {
        var current = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version
            ?? new Version(0, 0, 0);

        var official = await CheckOfficialAsync(current, ct);
        if (official is not null) return official;

        return await CheckGitHubAsync(current, ct);
    }

    private static async Task<WindowsUpdateInfo?> CheckOfficialAsync(Version current, CancellationToken ct)
    {
        try
        {
            using var client = NewClient();
            using var response = await client.GetAsync(
                BlofyEndpoints.ServiceBase.TrimEnd('/') + "/api/v1/releases/windows", ct);
            if (!response.IsSuccessStatusCode) return null;

            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            var root = doc.RootElement;
            var versionText = GetString(root, "versionName", "version");
            var url = GetString(root, "downloadUrl", "url");
            var notes = GetString(root, "releaseNotes", "notes");

            if (!TryVersion(versionText, out var remote) || remote <= current) return null;
            if (!ValidHttps(url)) return null;
            return new WindowsUpdateInfo(versionText, url, LimitNotes(notes));
        }
        catch
        {
            return null;
        }
    }

    private static async Task<WindowsUpdateInfo?> CheckGitHubAsync(Version current, CancellationToken ct)
    {
        try
        {
            using var client = NewClient();
            using var response = await client.GetAsync(ReleasesApi, ct);
            if (!response.IsSuccessStatusCode) return null;
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return null;

            foreach (var release in doc.RootElement.EnumerateArray())
            {
                if (release.TryGetProperty("draft", out var draft) && draft.GetBoolean()) continue;
                if (!release.TryGetProperty("assets", out var assets) || assets.ValueKind != JsonValueKind.Array) continue;

                var tag = release.TryGetProperty("tag_name", out var tagValue)
                    ? tagValue.GetString() ?? ""
                    : "";
                if (!TryVersion(tag, out var remote) || remote <= current) continue;

                foreach (var asset in assets.EnumerateArray())
                {
                    var name = asset.TryGetProperty("name", out var n) ? (n.GetString() ?? "") : "";
                    if (!name.Contains("windows", StringComparison.OrdinalIgnoreCase)) continue;
                    if (!(name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ||
                          name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) ||
                          name.EndsWith(".msix", StringComparison.OrdinalIgnoreCase))) continue;

                    var url = asset.TryGetProperty("browser_download_url", out var u)
                        ? u.GetString() ?? ""
                        : "";
                    if (!ValidHttps(url)) continue;

                    var notes = release.TryGetProperty("body", out var body)
                        ? body.GetString() ?? ""
                        : "";
                    return new WindowsUpdateInfo(remote.ToString(3), url, LimitNotes(notes));
                }
            }
        }
        catch { }

        return null;
    }

    private static HttpClient NewClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };
        client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "BLOFY-PLAYER-Windows/0.4.2");
        return client;
    }

    private static bool ValidHttps(string value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
        uri.Scheme == Uri.UriSchemeHttps;

    private static string LimitNotes(string value) =>
        string.IsNullOrWhiteSpace(value) ? "" : value.Length > 600 ? value[..600] : value;

    private static string GetString(JsonElement root, params string[] names)
    {
        foreach (var name in names)
            if (root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String)
                return value.GetString() ?? "";
        return "";
    }

    private static bool TryVersion(string? raw, out Version version)
    {
        version = new Version(0, 0, 0);
        if (string.IsNullOrWhiteSpace(raw)) return false;
        var match = Regex.Match(raw, @"(?<!\d)(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?");
        if (!match.Success) return false;
        return Version.TryParse(match.Value, out version!);
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
            "Version: Windows 0.4.2",
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
