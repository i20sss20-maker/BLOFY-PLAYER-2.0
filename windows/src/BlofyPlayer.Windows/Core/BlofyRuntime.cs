using BlofyPlayer.Windows.Core.Identity;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace BlofyPlayer.Windows.Core;

public sealed class ProviderAccount
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "BLOFY Server";
    public string ProviderType { get; set; } = "xtream";
    public string BaseUrl { get; set; } = "";
    public string Username { get; set; } = "";
    public string Password { get; set; } = "";
    public string M3uUrl { get; set; } = "";
    public bool Active { get; set; }
    public long UpdatedAt { get; set; } = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}

public sealed class CategoryItem
{
    public string RemoteId { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Name { get; set; } = "";
}

public sealed class StreamItem
{
    public string Key { get; set; } = "";
    public string RemoteId { get; set; } = "";
    public string CategoryId { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Name { get; set; } = "";
    public string Icon { get; set; } = "";
    public string Extension { get; set; } = "";
    public string DirectSource { get; set; } = "";
    public string EpgChannelId { get; set; } = "";
    public string Plot { get; set; } = "";
    public string Genre { get; set; } = "";
    public string ReleaseDate { get; set; } = "";
    public string Year { get; set; } = "";
    public string Rating { get; set; } = "";
    public string Duration { get; set; } = "";
    public string Backdrop { get; set; } = "";
    public long AddedAt { get; set; }
    public bool ArchiveEnabled { get; set; }
    public int ArchiveDurationDays { get; set; }
    public bool Favorite { get; set; }
}

public sealed class EpisodeItem
{
    public string Key { get; set; } = "";
    public string RemoteId { get; set; } = "";
    public int Season { get; set; } = 1;
    public int Episode { get; set; } = 1;
    public string Title { get; set; } = "";
    public string Extension { get; set; } = "mp4";
    public string DirectSource { get; set; } = "";
    public long DurationSecs { get; set; }
}

public sealed class EpgItem
{
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public DateTimeOffset Start { get; set; }
    public DateTimeOffset End { get; set; }
}

public sealed class ProviderDetails
{
    public string Plot { get; set; } = "";
    public string Genre { get; set; } = "";
    public string Rating { get; set; } = "";
    public string Country { get; set; } = "";
    public string Cast { get; set; } = "";
    public string Director { get; set; } = "";
    public string Writer { get; set; } = "";
    public string ReleaseDate { get; set; } = "";
    public string Duration { get; set; } = "";
    public string Backdrop { get; set; } = "";
    public string Trailer { get; set; } = "";
    public string Status { get; set; } = "";
    public string Network { get; set; } = "";
    public string OriginalLanguage { get; set; } = "";
}

public sealed class WatchState
{
    public string Key { get; set; } = "";
    public long PositionMs { get; set; }
    public long DurationMs { get; set; }
    public bool Completed { get; set; }
    public long UpdatedAt { get; set; } = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}

public sealed class AppSettings
{
    public string Theme { get; set; } = "dark";
    public string Language { get; set; } = "ar";
    public string LiveFormat { get; set; } = "ts";
    public string SubtitleLanguage { get; set; } = "ar";
    public string SubtitleSize { get; set; } = "small";
    public string Aspect { get; set; } = "fit";
    public string AudioOutput { get; set; } = "auto";
    public bool AutoplayLive { get; set; } = true;
    public bool ResumePrompt { get; set; } = true;
    public string AutoNext { get; set; } = "ask";
    public string CatalogDensity { get; set; } = "comfortable";
    public string UserAgent { get; set; } = "BLOFY PLAYER/2.0 (Windows)";
}

public sealed class PersistentState
{
    public List<ProviderAccount> Providers { get; set; } = [];
    public string ActiveProviderId { get; set; } = "";

    // Profile-aware state. The legacy fields below remain only for one-time migration from
    // early Windows builds and are no longer used after LoadAsync initializes profiles.
    public List<UserProfile> Profiles { get; set; } = [];
    public string ActiveProfileId { get; set; } = "";
    public Dictionary<string, ProfileLibraryState> ProfileLibraries { get; set; } = [];

    public HashSet<string> Favorites { get; set; } = [];
    public Dictionary<string, WatchState> WatchStates { get; set; } = [];
    public List<string> RecentSearches { get; set; } = [];

    public AppSettings Settings { get; set; } = new();
}

public sealed class CatalogSnapshot
{
    public string ProviderId { get; set; } = "";
    public long UpdatedAt { get; set; }
    public List<CategoryItem> Categories { get; set; } = [];
    public List<StreamItem> Streams { get; set; } = [];
}

public sealed class LocalStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true
    };

    private readonly string _root = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "BLOFY PLAYER"
    );

    public PersistentState State { get; private set; } = new();
    public string RootPath => _root;

    private string StatePath => Path.Combine(_root, "state.json");

    public async Task LoadAsync()
    {
        Directory.CreateDirectory(_root);
        if (File.Exists(StatePath))
        {
            try
            {
                await using var stream = File.OpenRead(StatePath);
                State = await JsonSerializer.DeserializeAsync<PersistentState>(stream, Json) ?? new();
            }
            catch
            {
                State = new();
            }
        }

        if (EnsureProfiles())
            await SaveAsync();
    }

    public async Task SaveAsync()
    {
        Directory.CreateDirectory(_root);
        var temp = StatePath + ".tmp";
        await using (var stream = File.Create(temp))
            await JsonSerializer.SerializeAsync(stream, State, Json);
        File.Move(temp, StatePath, true);
    }

    public ProviderAccount? ActiveProvider() =>
        State.Providers.FirstOrDefault(p => p.Id == State.ActiveProviderId)
        ?? State.Providers.FirstOrDefault(p => p.Active)
        ?? State.Providers.FirstOrDefault();

    public UserProfile ActiveProfile()
    {
        EnsureProfiles();
        return State.Profiles.FirstOrDefault(p => p.Id == State.ActiveProfileId)
            ?? State.Profiles[0];
    }

    public ProfileLibraryState ActiveLibrary()
    {
        var profile = ActiveProfile();
        if (!State.ProfileLibraries.TryGetValue(profile.Id, out var library))
        {
            library = new ProfileLibraryState();
            State.ProfileLibraries[profile.Id] = library;
        }
        return library;
    }

    public bool IsKidsProfile => ActiveProfile().Kids;

    public bool IsContentVisible(StreamItem item) =>
        !IsKidsProfile || !KidsPolicy.IsBlocked(item);

    public async Task<UserProfile> CreateProfileAsync(string name, bool kids = false, bool guest = false)
    {
        EnsureProfiles();
        var clean = name.Trim();
        if (string.IsNullOrWhiteSpace(clean)) throw new InvalidOperationException("اسم الملف مطلوب.");
        if (State.Profiles.Count >= 8) throw new InvalidOperationException("الحد الأقصى 8 ملفات.");
        if (guest && State.Profiles.Any(p => p.Guest)) throw new InvalidOperationException("يوجد ملف ضيف بالفعل.");

        var profile = new UserProfile
        {
            Name = clean.Length > 32 ? clean[..32] : clean,
            Kids = kids,
            Guest = guest
        };
        State.Profiles.Add(profile);
        State.ProfileLibraries[profile.Id] = new ProfileLibraryState();
        await SaveAsync();
        return profile;
    }

    public async Task<bool> SelectProfileAsync(string profileId, string? pin = null)
    {
        EnsureProfiles();
        var profile = State.Profiles.FirstOrDefault(p => p.Id == profileId);
        if (profile is null) return false;
        if (!string.IsNullOrWhiteSpace(profile.PinHash) && !ProfileSecurity.Verify(profile.PinHash, pin ?? ""))
            return false;

        State.ActiveProfileId = profile.Id;
        await SaveAsync();
        return true;
    }

    public async Task SetProfilePinAsync(string profileId, string? pin)
    {
        var profile = State.Profiles.FirstOrDefault(p => p.Id == profileId)
            ?? throw new InvalidOperationException("الملف غير موجود.");
        profile.PinHash = string.IsNullOrWhiteSpace(pin) ? null : ProfileSecurity.HashPin(pin);
        await SaveAsync();
    }

    public async Task RenameProfileAsync(string profileId, string name)
    {
        var profile = State.Profiles.FirstOrDefault(p => p.Id == profileId)
            ?? throw new InvalidOperationException("الملف غير موجود.");
        var clean = name.Trim();
        if (string.IsNullOrWhiteSpace(clean)) throw new InvalidOperationException("الاسم مطلوب.");
        profile.Name = clean.Length > 32 ? clean[..32] : clean;
        await SaveAsync();
    }

    public async Task DeleteProfileAsync(string profileId)
    {
        EnsureProfiles();
        if (State.Profiles.Count <= 1) throw new InvalidOperationException("يجب إبقاء ملف واحد على الأقل.");
        var profile = State.Profiles.FirstOrDefault(p => p.Id == profileId)
            ?? throw new InvalidOperationException("الملف غير موجود.");
        State.Profiles.Remove(profile);
        State.ProfileLibraries.Remove(profile.Id);
        if (State.ActiveProfileId == profile.Id)
            State.ActiveProfileId = State.Profiles[0].Id;
        await SaveAsync();
    }

    public WatchState? WatchState(string key)
    {
        var library = ActiveLibrary();
        return library.WatchStates.TryGetValue(key, out var state) ? state : null;
    }

    public int FavoritesCount => ActiveLibrary().Favorites.Count;
    public IEnumerable<WatchState> WatchStates => ActiveLibrary().WatchStates.Values;

    public async Task AddRecentSearchAsync(string value)
    {
        var clean = value.Trim();
        if (clean.Length < 2) return;
        var recent = ActiveLibrary().RecentSearches;
        recent.RemoveAll(x => x.Equals(clean, StringComparison.OrdinalIgnoreCase));
        recent.Insert(0, clean);
        if (recent.Count > 30) recent.RemoveRange(30, recent.Count - 30);
        await SaveAsync();
    }

    public async Task SetCategoryHiddenAsync(string kind, string remoteId, bool hidden)
    {
        var key = kind + ":" + remoteId;
        var set = ActiveLibrary().HiddenCategoryKeys;
        if (hidden) set.Add(key); else set.Remove(key);
        await SaveAsync();
    }

    public bool IsCategoryHidden(string kind, string remoteId) =>
        ActiveLibrary().HiddenCategoryKeys.Contains(kind + ":" + remoteId);

    public async Task SaveCatalogAsync(CatalogSnapshot snapshot)
    {
        Directory.CreateDirectory(_root);
        var path = CatalogPath(snapshot.ProviderId);
        var temp = path + ".tmp";
        await using (var file = File.Create(temp))
        await using (var gzip = new GZipStream(file, CompressionLevel.Fastest))
            await JsonSerializer.SerializeAsync(gzip, snapshot, Json);
        File.Move(temp, path, true);
    }

    public async Task<CatalogSnapshot?> LoadCatalogAsync(string providerId)
    {
        var path = CatalogPath(providerId);
        if (!File.Exists(path)) return null;
        try
        {
            await using var file = File.OpenRead(path);
            await using var gzip = new GZipStream(file, CompressionMode.Decompress);
            return await JsonSerializer.DeserializeAsync<CatalogSnapshot>(gzip, Json);
        }
        catch
        {
            return null;
        }
    }

    public void ApplyFavoriteState(IEnumerable<StreamItem> streams)
    {
        var favorites = ActiveLibrary().Favorites;
        foreach (var item in streams)
            item.Favorite = favorites.Contains(item.Key);
    }

    public async Task ToggleFavoriteAsync(StreamItem item)
    {
        var favorites = ActiveLibrary().Favorites;
        item.Favorite = !item.Favorite;
        if (item.Favorite) favorites.Add(item.Key);
        else favorites.Remove(item.Key);
        await SaveAsync();
    }

    public async Task SaveWatchStateAsync(string key, long positionMs, long durationMs)
    {
        if (string.IsNullOrWhiteSpace(key) || durationMs <= 0) return;
        var completed = positionMs >= durationMs * .93;
        ActiveLibrary().WatchStates[key] = new WatchState
        {
            Key = key,
            PositionMs = completed ? 0 : Math.Max(0, positionMs),
            DurationMs = durationMs,
            Completed = completed,
            UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };
        await SaveAsync();
    }

    public int CleanCatalogCache()
    {
        var count = 0;
        foreach (var file in Directory.EnumerateFiles(_root, "catalog-*.json.gz", SearchOption.TopDirectoryOnly))
        {
            try { File.Delete(file); count++; } catch { }
        }
        return count;
    }

    private bool EnsureProfiles()
    {
        var changed = false;
        State.Profiles ??= [];
        State.ProfileLibraries ??= [];

        if (State.Profiles.Count == 0)
        {
            State.Profiles.Add(new UserProfile { Id = "main", Name = "الرئيسي", Kids = false });
            State.Profiles.Add(new UserProfile { Id = "kids", Name = "أطفال", Kids = true });
            changed = true;
        }

        if (string.IsNullOrWhiteSpace(State.ActiveProfileId) ||
            State.Profiles.All(p => p.Id != State.ActiveProfileId))
        {
            State.ActiveProfileId = State.Profiles[0].Id;
            changed = true;
        }

        foreach (var profile in State.Profiles)
        {
            if (!State.ProfileLibraries.ContainsKey(profile.Id))
            {
                State.ProfileLibraries[profile.Id] = new ProfileLibraryState();
                changed = true;
            }
        }

        // One-time migration from Windows 0.1/0.2 where favorites/history were global.
        var main = State.Profiles.FirstOrDefault(p => p.Id == "main") ?? State.Profiles[0];
        var mainLibrary = State.ProfileLibraries[main.Id];
        if (State.Favorites.Count > 0)
        {
            mainLibrary.Favorites.UnionWith(State.Favorites);
            State.Favorites.Clear();
            changed = true;
        }
        if (State.WatchStates.Count > 0)
        {
            foreach (var pair in State.WatchStates) mainLibrary.WatchStates[pair.Key] = pair.Value;
            State.WatchStates.Clear();
            changed = true;
        }
        if (State.RecentSearches.Count > 0)
        {
            mainLibrary.RecentSearches = State.RecentSearches
                .Where(x => !string.IsNullOrWhiteSpace(x)).Distinct(StringComparer.OrdinalIgnoreCase).Take(30).ToList();
            State.RecentSearches.Clear();
            changed = true;
        }

        return changed;
    }

    private string CatalogPath(string providerId)
    {
        var safe = Regex.Replace(providerId, "[^A-Za-z0-9_-]", "_");
        return Path.Combine(_root, "catalog-" + safe + ".json.gz");
    }
}

public sealed class XtreamService : IDisposable
{
    private readonly HttpClient _http;
    private readonly JsonDocumentOptions _docOptions = new() { AllowTrailingCommas = true };

    public XtreamService(string userAgent)
    {
        var handler = new HttpClientHandler
        {
            AllowAutoRedirect = true,
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate
        };
        _http = new HttpClient(handler)
        {
            Timeout = TimeSpan.FromSeconds(90)
        };
        _http.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", userAgent);
        _http.DefaultRequestHeaders.TryAddWithoutValidation("Accept", "application/json,text/plain,*/*");
    }

    public async Task<bool> AuthenticateAsync(ProviderAccount provider, CancellationToken ct = default)
    {
        using var doc = await GetJsonAsync(ApiUrl(provider), ct);
        if (doc.RootElement.ValueKind != JsonValueKind.Object) return false;
        if (!TryGet(doc.RootElement, "user_info", out var info) || info.ValueKind != JsonValueKind.Object)
            return false;

        var auth = Str(info, "auth");
        var status = Str(info, "status");
        return auth == "1" || status.Equals("Active", StringComparison.OrdinalIgnoreCase);
    }

    public Task<List<CategoryItem>> GetCategoriesAsync(ProviderAccount provider, string kind, CancellationToken ct = default)
    {
        var action = kind switch
        {
            "live" => "get_live_categories",
            "movie" => "get_vod_categories",
            "series" => "get_series_categories",
            _ => throw new ArgumentOutOfRangeException(nameof(kind))
        };
        return GetCategoryListAsync(provider, kind, action, ct);
    }

    public Task<List<StreamItem>> GetStreamsAsync(ProviderAccount provider, string kind, CancellationToken ct = default)
    {
        var action = kind switch
        {
            "live" => "get_live_streams",
            "movie" => "get_vod_streams",
            "series" => "get_series",
            _ => throw new ArgumentOutOfRangeException(nameof(kind))
        };
        return GetStreamListAsync(provider, kind, action, ct);
    }

    public async Task<ProviderDetails> GetDetailsAsync(ProviderAccount provider, StreamItem item, CancellationToken ct = default)
    {
        var action = item.Kind == "series" ? "get_series_info" : "get_vod_info";
        var idKey = item.Kind == "series" ? "series_id" : "vod_id";
        var url = ApiUrl(provider, action) + "&" + idKey + "=" + Uri.EscapeDataString(NormalizeId(item.RemoteId));
        using var doc = await GetJsonAsync(url, ct);

        var values = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
        void MergeObject(JsonElement node)
        {
            if (node.ValueKind != JsonValueKind.Object) return;
            foreach (var prop in node.EnumerateObject())
            {
                if (prop.Value.ValueKind is not JsonValueKind.Null and not JsonValueKind.Undefined)
                    values[prop.Name] = prop.Value.Clone();
            }
        }

        MergeObject(doc.RootElement);
        if (doc.RootElement.ValueKind == JsonValueKind.Object)
        {
            foreach (var key in new[] { "data", "movie_data", "info" })
                if (TryGet(doc.RootElement, key, out var nested) && nested.ValueKind == JsonValueKind.Object)
                {
                    MergeObject(nested);
                    foreach (var sub in new[] { "movie_data", "info" })
                        if (TryGet(nested, sub, out var child) && child.ValueKind == JsonValueKind.Object)
                            MergeObject(child);
                }
        }

        string Value(params string[] keys)
        {
            foreach (var key in keys)
            {
                if (!values.TryGetValue(key, out var value)) continue;
                var text = FlexibleText(value);
                if (!string.IsNullOrWhiteSpace(text) && !text.Equals("null", StringComparison.OrdinalIgnoreCase))
                    return text.Trim();
            }
            return "";
        }

        string ImageValue(params string[] keys)
        {
            foreach (var key in keys)
            {
                if (!values.TryGetValue(key, out var value)) continue;
                if (value.ValueKind == JsonValueKind.Array)
                {
                    foreach (var x in value.EnumerateArray())
                    {
                        var text = FlexibleText(x);
                        if (!string.IsNullOrWhiteSpace(text)) return ResolveImage(provider, text);
                    }
                }
                var raw = FlexibleText(value);
                if (!string.IsNullOrWhiteSpace(raw)) return ResolveImage(provider, raw);
            }
            return "";
        }

        return new ProviderDetails
        {
            Plot = Value("plot", "description", "overview", "synopsis") is { Length: > 0 } plot ? plot : item.Plot,
            Genre = Value("genre", "genres") is { Length: > 0 } genre ? genre : item.Genre,
            Rating = Value("rating", "rating_5based", "vote_average") is { Length: > 0 } rating ? rating : item.Rating,
            Country = Value("country", "countries", "country_name", "production_country", "production_countries", "origin_country"),
            Cast = Value("cast", "actors", "actor"),
            Director = Value("director"),
            Writer = Value("writer", "writers"),
            ReleaseDate = Value("releasedate", "release_date", "releaseDate", "first_air_date") is { Length: > 0 } release ? release : item.ReleaseDate,
            Duration = Value("duration", "duration_secs", "duration_seconds") is { Length: > 0 } duration ? duration : item.Duration,
            Backdrop = ImageValue("backdrop_path", "backdrop"),
            Trailer = Value("youtube_trailer", "trailer"),
            Status = Value("status"),
            Network = Value("network", "networks"),
            OriginalLanguage = Value("language", "original_language")
        };
    }

    public async Task<List<EpisodeItem>> GetEpisodesAsync(ProviderAccount provider, string seriesId, CancellationToken ct = default)
    {
        var url = ApiUrl(provider, "get_series_info") + "&series_id=" + Uri.EscapeDataString(NormalizeId(seriesId));
        using var doc = await GetJsonAsync(url, ct);
        if (doc.RootElement.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array))
            return [];

        JsonElement episodes = doc.RootElement;
        if (doc.RootElement.ValueKind == JsonValueKind.Object && TryGet(doc.RootElement, "episodes", out var named))
            episodes = named;

        var rows = new List<(JsonElement Row, int Season, int Number, string Hint)>();
        CollectEpisodeRows(episodes, null, rows);

        return rows.Select(tuple =>
        {
            var row = tuple.Row;
            var id = First(row, "id", "episode_id", "stream_id");
            if (string.IsNullOrWhiteSpace(id)) id = tuple.Hint;
            var season = Int(row, "season", "season_num", "season_number");
            if (season <= 0) season = tuple.Season <= 0 ? 1 : tuple.Season;
            var number = Int(row, "episode_num", "episode", "episode_number", "number");
            if (number <= 0) number = tuple.Number <= 0 ? 1 : tuple.Number;
            var ext = First(row, "container_extension", "extension");
            if (string.IsNullOrWhiteSpace(ext)) ext = "mp4";
            return new EpisodeItem
            {
                Key = provider.Id + ":episode:" + id,
                RemoteId = id,
                Season = season,
                Episode = number,
                Title = First(row, "title", "name") is { Length: > 0 } title ? title : "Episode " + number,
                Extension = ext.TrimStart('.'),
                DirectSource = First(row, "direct_source")
            };
        })
        .Where(e => !string.IsNullOrWhiteSpace(e.RemoteId))
        .GroupBy(e => e.Key).Select(g => g.First())
        .OrderBy(e => e.Season).ThenBy(e => e.Episode).ToList();
    }

    public async Task<List<EpgItem>> GetShortEpgAsync(ProviderAccount provider, string streamId, CancellationToken ct = default)
    {
        var url = ApiUrl(provider, "get_short_epg") + "&stream_id=" + Uri.EscapeDataString(streamId) + "&limit=8";
        using var doc = await GetJsonAsync(url, ct);
        JsonElement list;
        if (doc.RootElement.ValueKind == JsonValueKind.Object && TryGet(doc.RootElement, "epg_listings", out var epg))
            list = epg;
        else list = doc.RootElement;
        if (list.ValueKind != JsonValueKind.Array) return [];

        var result = new List<EpgItem>();
        foreach (var row in list.EnumerateArray())
        {
            if (row.ValueKind != JsonValueKind.Object) continue;
            var start = Long(row, "start_timestamp", "start");
            var end = Long(row, "stop_timestamp", "end");
            if (start <= 0 || end <= start) continue;
            result.Add(new EpgItem
            {
                Title = DecodeMaybeBase64(First(row, "title")),
                Description = DecodeMaybeBase64(First(row, "description")),
                Start = FromUnix(start),
                End = FromUnix(end)
            });
        }
        return result;
    }

    public string StreamUrl(ProviderAccount provider, StreamItem item, string liveFormat = "ts")
    {
        if (!string.IsNullOrWhiteSpace(item.DirectSource))
            return item.DirectSource;
        var root = NormalizeBase(provider.BaseUrl);
        var u = Uri.EscapeDataString(provider.Username);
        var p = Uri.EscapeDataString(provider.Password);
        var id = Uri.EscapeDataString(item.RemoteId);
        if (item.Kind == "live")
            return root + "/live/" + u + "/" + p + "/" + id + "." + (liveFormat == "m3u8" ? "m3u8" : "ts");
        if (item.Kind == "movie")
            return root + "/movie/" + u + "/" + p + "/" + id + "." + CleanExt(item.Extension);
        return root + "/series/" + u + "/" + p + "/" + id + "." + CleanExt(item.Extension);
    }

    public string EpisodeUrl(ProviderAccount provider, EpisodeItem episode)
    {
        if (!string.IsNullOrWhiteSpace(episode.DirectSource))
            return episode.DirectSource;
        var root = NormalizeBase(provider.BaseUrl);
        return root + "/series/" + Uri.EscapeDataString(provider.Username) + "/" +
               Uri.EscapeDataString(provider.Password) + "/" +
               Uri.EscapeDataString(episode.RemoteId) + "." + CleanExt(episode.Extension);
    }

    public string CatchupUrl(ProviderAccount provider, StreamItem item, DateTimeOffset start, DateTimeOffset end)
    {
        var minutes = Math.Max(1, (int)Math.Ceiling((end - start).TotalMinutes));
        var localStart = start.ToLocalTime().ToString("yyyy-MM-dd:HH-mm", CultureInfo.InvariantCulture);
        return NormalizeBase(provider.BaseUrl) + "/timeshift/" +
               Uri.EscapeDataString(provider.Username) + "/" +
               Uri.EscapeDataString(provider.Password) + "/" +
               minutes + "/" + Uri.EscapeDataString(localStart) + "/" +
               Uri.EscapeDataString(item.RemoteId) + ".ts";
    }

    private async Task<List<CategoryItem>> GetCategoryListAsync(ProviderAccount provider, string kind, string action, CancellationToken ct)
    {
        using var doc = await GetJsonAsync(ApiUrl(provider, action), ct);
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return [];
        var result = new List<CategoryItem>();
        foreach (var row in doc.RootElement.EnumerateArray())
        {
            if (row.ValueKind != JsonValueKind.Object) continue;
            var id = First(row, "category_id", "id");
            var name = First(row, "category_name", "name");
            if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(name)) continue;
            result.Add(new CategoryItem { RemoteId = id, Kind = kind, Name = name });
        }
        return result;
    }

    private async Task<List<StreamItem>> GetStreamListAsync(ProviderAccount provider, string kind, string action, CancellationToken ct)
    {
        using var doc = await GetJsonAsync(ApiUrl(provider, action), ct);
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return [];
        var result = new List<StreamItem>();
        foreach (var row in doc.RootElement.EnumerateArray())
        {
            if (row.ValueKind != JsonValueKind.Object) continue;
            var id = First(row, kind == "series" ? "series_id" : "stream_id", "id");
            var name = First(row, "name", "title");
            if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(name)) continue;
            var back = "";
            if (TryGet(row, "backdrop_path", out var backdrop))
            {
                if (backdrop.ValueKind == JsonValueKind.Array)
                    back = backdrop.EnumerateArray().FirstOrDefault().ToString();
                else back = backdrop.ToString();
            }
            result.Add(new StreamItem
            {
                Key = provider.Id + ":" + kind + ":" + id,
                RemoteId = id,
                CategoryId = First(row, "category_id"),
                Kind = kind,
                Name = name,
                Icon = First(row, "stream_icon", "cover"),
                Extension = First(row, "container_extension", "extension"),
                DirectSource = First(row, "direct_source"),
                EpgChannelId = First(row, "epg_channel_id"),
                Plot = First(row, "plot", "description"),
                Genre = First(row, "genre"),
                ReleaseDate = First(row, "releaseDate", "release_date"),
                Year = First(row, "year"),
                Rating = First(row, "rating", "rating_5based"),
                Duration = First(row, "duration"),
                Backdrop = back,
                AddedAt = Long(row, "added", "added_at"),
                ArchiveEnabled = First(row, "tv_archive", "archive", "catchup").ToLowerInvariant() is "1" or "true" or "yes",
                ArchiveDurationDays = Int(row, "tv_archive_duration", "archive_duration")
            });
        }
        return result;
    }

    private async Task<JsonDocument> GetJsonAsync(string url, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        using var response = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        var status = (int)response.StatusCode;
        if (!response.IsSuccessStatusCode && status != 884)
            throw new HttpRequestException("Xtream HTTP " + status);
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        return await JsonDocument.ParseAsync(stream, _docOptions, ct);
    }

    private static void CollectEpisodeRows(JsonElement node, int? inheritedSeason, List<(JsonElement, int, int, string)> output)
    {
        if (node.ValueKind == JsonValueKind.Array)
        {
            var i = 0;
            foreach (var child in node.EnumerateArray())
            {
                i++;
                if (child.ValueKind == JsonValueKind.Object && LooksEpisode(child))
                    output.Add((child.Clone(), inheritedSeason ?? 1, i, ""));
                else CollectEpisodeRows(child, inheritedSeason, output);
            }
            return;
        }
        if (node.ValueKind != JsonValueKind.Object) return;

        if (LooksEpisode(node))
        {
            output.Add((node.Clone(), inheritedSeason ?? 1, 1, ""));
            return;
        }

        foreach (var prop in node.EnumerateObject())
        {
            var season = inheritedSeason;
            if (season is null && int.TryParse(Regex.Match(prop.Name, @"\d+").Value, out var parsed))
                season = parsed;
            if (prop.Value.ValueKind == JsonValueKind.Object && LooksEpisode(prop.Value))
                output.Add((prop.Value.Clone(), season ?? 1, 1, prop.Name));
            else CollectEpisodeRows(prop.Value, season, output);
        }
    }

    private static bool LooksEpisode(JsonElement row)
    {
        if (row.ValueKind != JsonValueKind.Object) return false;
        return !string.IsNullOrWhiteSpace(First(row, "id", "episode_id", "stream_id"))
            || !string.IsNullOrWhiteSpace(First(row, "episode_num", "episode", "episode_number"));
    }

    public static string ApiUrl(ProviderAccount provider, string? action = null)
    {
        var root = NormalizeBase(provider.BaseUrl);
        var url = root + "/player_api.php?username=" + Uri.EscapeDataString(provider.Username)
                  + "&password=" + Uri.EscapeDataString(provider.Password);
        return action is null ? url : url + "&action=" + Uri.EscapeDataString(action);
    }

    public static string NormalizeBase(string value) => value.Trim().TrimEnd('/');

    private static string CleanExt(string value) =>
        string.IsNullOrWhiteSpace(value) ? "mp4" : value.Trim().TrimStart('.');

    private static string NormalizeId(string value) =>
        Regex.IsMatch(value.Trim(), @"^[+-]?\d+\.0+$") ? value.Trim().Split('.')[0] : value.Trim();

    private static bool TryGet(JsonElement obj, string name, out JsonElement value)
    {
        foreach (var prop in obj.EnumerateObject())
        {
            if (prop.Name.Equals(name, StringComparison.OrdinalIgnoreCase))
            {
                value = prop.Value;
                return true;
            }
        }
        value = default;
        return false;
    }

    private static string First(JsonElement obj, params string[] names)
    {
        foreach (var name in names)
            if (TryGet(obj, name, out var value))
            {
                var text = value.ValueKind switch
                {
                    JsonValueKind.String => value.GetString() ?? "",
                    JsonValueKind.Number => value.GetRawText(),
                    JsonValueKind.True => "1",
                    JsonValueKind.False => "0",
                    _ => ""
                };
                if (!string.IsNullOrWhiteSpace(text) && !text.Equals("null", StringComparison.OrdinalIgnoreCase))
                    return text.Trim();
            }
        return "";
    }

    private static string Str(JsonElement obj, string name) => First(obj, name);

    private static int Int(JsonElement obj, params string[] names)
    {
        var text = First(obj, names);
        if (int.TryParse(text, NumberStyles.Any, CultureInfo.InvariantCulture, out var value)) return value;
        if (double.TryParse(text, NumberStyles.Any, CultureInfo.InvariantCulture, out var dbl)) return (int)dbl;
        return 0;
    }

    private static long Long(JsonElement obj, params string[] names)
    {
        var text = First(obj, names);
        if (long.TryParse(text, NumberStyles.Any, CultureInfo.InvariantCulture, out var value)) return value;
        if (double.TryParse(text, NumberStyles.Any, CultureInfo.InvariantCulture, out var dbl)) return (long)dbl;
        return 0;
    }

    private static string FlexibleText(JsonElement value)
    {
        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString() ?? "",
            JsonValueKind.Number => value.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Array => string.Join(", ", value.EnumerateArray().Select(FlexibleText).Where(x => !string.IsNullOrWhiteSpace(x))),
            JsonValueKind.Object => value.TryGetProperty("name", out var name) ? FlexibleText(name)
                : value.TryGetProperty("url", out var url) ? FlexibleText(url)
                : value.TryGetProperty("file_path", out var path) ? FlexibleText(path)
                : "",
            _ => ""
        };
    }

    private static string ResolveImage(ProviderAccount provider, string raw)
    {
        if (Uri.TryCreate(raw, UriKind.Absolute, out var absolute)) return absolute.ToString();
        if (Uri.TryCreate(NormalizeBase(provider.BaseUrl) + "/" + raw.TrimStart('/'), UriKind.Absolute, out var relative))
            return relative.ToString();
        return raw;
    }

    private static string DecodeMaybeBase64(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        try
        {
            if (value.Length % 4 != 0 || value.Any(c => !(char.IsLetterOrDigit(c) || c is '+' or '/' or '=')))
                return value;
            var decoded = Encoding.UTF8.GetString(Convert.FromBase64String(value));
            return string.IsNullOrWhiteSpace(decoded) ? value : decoded;
        }
        catch { return value; }
    }

    private static DateTimeOffset FromUnix(long value)
    {
        if (value > 10_000_000_000) return DateTimeOffset.FromUnixTimeMilliseconds(value);
        return DateTimeOffset.FromUnixTimeSeconds(value);
    }

    public void Dispose() => _http.Dispose();
}

public sealed class M3uService : IDisposable
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(30) };
    private static readonly Regex Attr = new(@"(?<key>[A-Za-z0-9_-]+)=""(?<value>[^""]*)""", RegexOptions.Compiled);

    public async Task<CatalogSnapshot> LoadAsync(ProviderAccount provider, CancellationToken ct = default)
    {
        string text;
        if (Uri.TryCreate(provider.M3uUrl, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https")
            text = await _http.GetStringAsync(uri, ct);
        else
            text = await File.ReadAllTextAsync(provider.M3uUrl, ct);

        var categories = new Dictionary<string, CategoryItem>(StringComparer.OrdinalIgnoreCase);
        var streams = new List<StreamItem>();
        string pendingName = "", pendingLogo = "", pendingGroup = "", pendingTvg = "";

        foreach (var raw in text.Split('\n'))
        {
            var line = raw.Trim();
            if (line.StartsWith("#EXTINF", StringComparison.OrdinalIgnoreCase))
            {
                var comma = line.LastIndexOf(',');
                pendingName = comma >= 0 ? line[(comma + 1)..].Trim() : "Channel";
                pendingLogo = pendingGroup = pendingTvg = "";
                foreach (Match match in Attr.Matches(line))
                {
                    var key = match.Groups["key"].Value;
                    var value = match.Groups["value"].Value;
                    if (key.Equals("tvg-logo", StringComparison.OrdinalIgnoreCase)) pendingLogo = value;
                    else if (key.Equals("group-title", StringComparison.OrdinalIgnoreCase)) pendingGroup = value;
                    else if (key.Equals("tvg-id", StringComparison.OrdinalIgnoreCase)) pendingTvg = value;
                }
                continue;
            }
            if (line.Length == 0 || line.StartsWith('#')) continue;
            if (!Uri.TryCreate(line, UriKind.Absolute, out _)) continue;

            var group = string.IsNullOrWhiteSpace(pendingGroup) ? "القنوات" : pendingGroup;
            var catId = group.ToLowerInvariant();
            categories.TryAdd(catId, new CategoryItem { RemoteId = catId, Kind = "live", Name = group });
            var id = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(line)))[..12];
            streams.Add(new StreamItem
            {
                Key = provider.Id + ":live:" + id,
                RemoteId = id,
                CategoryId = catId,
                Kind = "live",
                Name = string.IsNullOrWhiteSpace(pendingName) ? line : pendingName,
                Icon = pendingLogo,
                EpgChannelId = pendingTvg,
                DirectSource = line
            });
            pendingName = pendingLogo = pendingGroup = pendingTvg = "";
        }

        return new CatalogSnapshot
        {
            ProviderId = provider.Id,
            UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Categories = categories.Values.ToList(),
            Streams = streams
        };
    }

    public void Dispose() => _http.Dispose();
}

public sealed class PortalService : IDisposable
{
    private readonly HttpClient _http = new()
    {
        BaseAddress = new Uri("https://api.blofyplayer.com/"),
        Timeout = TimeSpan.FromSeconds(10)
    };

    public async Task<List<ProviderAccount>> FetchAsync(BlofyIdentity identity, CancellationToken ct = default)
    {
        var auth = new { deviceId = identity.DeviceId, activationCode = identity.ActivationCode };
        using var response = await _http.PostAsJsonAsync("api/v1/portal/playlists/list", auth, ct);
        if (!response.IsSuccessStatusCode) return [];
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        if (!doc.RootElement.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array) return [];
        var result = new List<ProviderAccount>();
        foreach (var row in items.EnumerateArray())
        {
            var type = Get(row, "providerType").ToLowerInvariant();
            if (type != "xtream") continue;
            var id = Get(row, "id");
            var url = Get(row, "baseUrl");
            var user = Get(row, "username");
            var pass = Get(row, "password");
            if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(url) ||
                string.IsNullOrWhiteSpace(user) || string.IsNullOrWhiteSpace(pass)) continue;
            result.Add(new ProviderAccount
            {
                Id = id,
                Name = Get(row, "name") is { Length: > 0 } name ? name : "BLOFY Server",
                ProviderType = "xtream",
                BaseUrl = url.TrimEnd('/'),
                Username = user,
                Password = pass,
                Active = Bool(row, "active"),
                UpdatedAt = Long(row, "updatedAt")
            });
        }
        return result;
    }

    public async Task<string?> SaveAsync(BlofyIdentity identity, ProviderAccount provider, CancellationToken ct = default)
    {
        var body = new
        {
            deviceId = identity.DeviceId,
            activationCode = identity.ActivationCode,
            id = provider.Id,
            name = provider.Name,
            providerType = "xtream",
            baseUrl = provider.BaseUrl.TrimEnd('/'),
            username = provider.Username,
            password = provider.Password,
            active = provider.Active
        };
        using var response = await _http.PostAsJsonAsync("api/v1/portal/playlists", body, ct);
        if (!response.IsSuccessStatusCode) return null;
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        return Get(doc.RootElement, "id") is { Length: > 0 } id ? id : provider.Id;
    }

    public async Task DeleteAsync(BlofyIdentity identity, string id, CancellationToken ct = default)
    {
        var req = new HttpRequestMessage(HttpMethod.Delete, "api/v1/portal/playlists/" + Uri.EscapeDataString(id))
        {
            Content = JsonContent.Create(new { deviceId = identity.DeviceId, activationCode = identity.ActivationCode })
        };
        using var response = await _http.SendAsync(req, ct);
        if (!response.IsSuccessStatusCode && response.StatusCode != HttpStatusCode.NotFound)
            throw new HttpRequestException("Portal delete failed");
    }

    private static string Get(JsonElement row, string key)
    {
        foreach (var p in row.EnumerateObject())
            if (p.Name.Equals(key, StringComparison.OrdinalIgnoreCase))
                return p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() ?? "" : p.Value.ToString();
        return "";
    }

    private static bool Bool(JsonElement row, string key) =>
        bool.TryParse(Get(row, key), out var b) && b || Get(row, key) == "1";

    private static long Long(JsonElement row, string key) =>
        long.TryParse(Get(row, key), out var value) ? value : 0;

    public void Dispose() => _http.Dispose();
}

public sealed class CatalogCoordinator : IDisposable
{
    private readonly LocalStore _store;
    private XtreamService? _xtream;
    private M3uService? _m3u;

    public CatalogSnapshot Snapshot { get; private set; } = new();

    public CatalogCoordinator(LocalStore store) => _store = store;

    public async Task<CatalogSnapshot?> LoadCachedAsync(ProviderAccount provider)
    {
        var cached = await _store.LoadCatalogAsync(provider.Id);
        if (cached is null) return null;
        _store.ApplyFavoriteState(cached.Streams);
        Snapshot = cached;
        return cached;
    }

    public async Task<CatalogSnapshot> SyncAsync(
        ProviderAccount provider,
        IProgress<(int Percent, string Text)>? progress = null,
        CancellationToken ct = default)
    {
        progress?.Report((2, "بدء الاتصال بالسيرفر…"));

        CatalogSnapshot snapshot;
        if (provider.ProviderType.Equals("m3u", StringComparison.OrdinalIgnoreCase))
        {
            _m3u?.Dispose();
            _m3u = new M3uService();
            snapshot = await _m3u.LoadAsync(provider, ct);
            progress?.Report((90, "تم تحميل قائمة M3U"));
        }
        else
        {
            _xtream?.Dispose();
            _xtream = new XtreamService(_store.State.Settings.UserAgent);
            if (!await _xtream.AuthenticateAsync(provider, ct))
                throw new InvalidOperationException("بيانات السيرفر غير صحيحة أو الاشتراك غير نشط.");

            var categories = new List<CategoryItem>();
            var streams = new List<StreamItem>();

            progress?.Report((8, "تحميل أقسام البث المباشر…"));
            categories.AddRange(await _xtream.GetCategoriesAsync(provider, "live", ct));
            progress?.Report((16, "تحميل القنوات…"));
            streams.AddRange(await _xtream.GetStreamsAsync(provider, "live", ct));

            progress?.Report((40, "تحميل أقسام الأفلام…"));
            categories.AddRange(await _xtream.GetCategoriesAsync(provider, "movie", ct));
            progress?.Report((48, "تحميل الأفلام…"));
            streams.AddRange(await _xtream.GetStreamsAsync(provider, "movie", ct));

            progress?.Report((70, "تحميل أقسام المسلسلات…"));
            categories.AddRange(await _xtream.GetCategoriesAsync(provider, "series", ct));
            progress?.Report((78, "تحميل المسلسلات…"));
            streams.AddRange(await _xtream.GetStreamsAsync(provider, "series", ct));

            snapshot = new CatalogSnapshot
            {
                ProviderId = provider.Id,
                UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                Categories = categories,
                Streams = streams
            };
        }

        _store.ApplyFavoriteState(snapshot.Streams);
        Snapshot = snapshot;
        progress?.Report((94, "حفظ الكتالوج…"));
        await _store.SaveCatalogAsync(snapshot);
        progress?.Report((100, "جاهز"));
        return snapshot;
    }

    public XtreamService Xtream(ProviderAccount provider)
    {
        _xtream ??= new XtreamService(_store.State.Settings.UserAgent);
        return _xtream;
    }

    public void Dispose()
    {
        _xtream?.Dispose();
        _m3u?.Dispose();
    }
}
