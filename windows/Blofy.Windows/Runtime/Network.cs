using System.Net;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Blofy.Windows.Runtime;

public sealed class ProviderClient : IDisposable
{
    private readonly HttpClient _http;
    public ProviderClient(HttpMessageHandler? handler = null)
    {
        _http = new HttpClient(handler ?? new SocketsHttpHandler { AutomaticDecompression = DecompressionMethods.All, ConnectTimeout = TimeSpan.FromSeconds(10), MaxAutomaticRedirections = 8, PooledConnectionLifetime = TimeSpan.FromMinutes(5) }) { Timeout = TimeSpan.FromMinutes(12) };
    }
    private async Task<HttpResponseMessage> Get(Provider p, Uri url, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.TryAddWithoutValidation("User-Agent", Urls.Header(p.UserAgent));
        if (!string.IsNullOrEmpty(p.Referer)) request.Headers.Referrer = Urls.Http(p.Referer);
        var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        { var code = response.StatusCode; response.Dispose(); throw new HttpRequestException("Provider request failed", null, code); }
        if (response.Content.Headers.ContentLength > 2_000_000_000) { response.Dispose(); throw new InvalidDataException("القائمة تتجاوز الحد الآمن للحجم"); }
        return response;
    }
    public async Task Authenticate(Provider p, CancellationToken ct)
    {
        if (p.Type != "xtream") return;
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(ct); limit.CancelAfter(TimeSpan.FromSeconds(25));
        using var response = await Get(p, Urls.Api(p), limit.Token);
        await using var stream = await response.Content.ReadAsStreamAsync(limit.Token);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: limit.Token);
        var user = doc.RootElement.Get("user_info");
        if (user.Str("auth") != "1") throw new InvalidDataException("بيانات دخول السيرفر غير صحيحة");
        if (user.Str("status") is { Length: > 0 } status && !status.Equals("Active", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("اشتراك السيرفر غير نشط");
    }
    public async Task<IReadOnlyList<Category>> Categories(Provider p, string kind, CancellationToken ct)
    {
        var action = kind switch { "live" => "get_live_categories", "movie" => "get_vod_categories", "series" => "get_series_categories", _ => throw new ArgumentException("قسم غير معروف") };
        using var response = await Get(p, Urls.Api(p, action), ct);
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
        if (doc.RootElement.ValueKind != JsonValueKind.Array) throw new InvalidDataException("رد فئات السيرفر غير صالح");
        return doc.RootElement.EnumerateArray().Select((r, i) => new Category(r.Str("category_id"), r.Str("category_name"), kind, i)).Where(r => r.Id.Length > 0).DistinctBy(r => r.Id).ToList();
    }
    public async IAsyncEnumerable<Entry> Entries(Provider p, string kind, [EnumeratorCancellation] CancellationToken ct)
    {
        var action = kind switch { "live" => "get_live_streams", "movie" => "get_vod_streams", "series" => "get_series", _ => throw new ArgumentException("قسم غير معروف") };
        using var response = await Get(p, Urls.Api(p, action), ct);
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        int order = 0;
        await foreach (var row in JsonSerializer.DeserializeAsyncEnumerable<JsonElement>(stream, cancellationToken: ct))
        {
            ct.ThrowIfCancellationRequested();
            if (row.ValueKind != JsonValueKind.Object) throw new InvalidDataException("رد محتوى السيرفر غير صالح");
            var id = row.Str(kind == "series" ? "series_id" : "stream_id");
            var title = row.Str("name");
            if (id.Length == 0 || title.Length == 0) continue;
            yield return new Entry(id, title, kind, row.Str("category_id"), row.Str(kind == "series" ? "cover" : "stream_icon"), row.Str("container_extension", kind == "live" ? "ts" : "mp4"), "", row.Str("rating"), row.Str("year"), row.Str("genre"), order++);
            if (order > 2_000_000) throw new InvalidDataException("تجاوزت القائمة حد العناصر الآمن");
        }
    }
    public async IAsyncEnumerable<Entry> M3u(Provider p, [EnumeratorCancellation] CancellationToken ct)
    {
        using var response = await Get(p, Urls.Http(p.Url), ct);
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);
        await foreach (var e in ParseM3u(reader, response.RequestMessage?.RequestUri ?? Urls.Http(p.Url), ct)) yield return e;
    }
    public static async IAsyncEnumerable<Entry> ParseM3u(TextReader reader, Uri source, [EnumeratorCancellation] CancellationToken ct = default)
    {
        string title = "", image = "", group = ""; int index = 0; bool header = false;
        while (await reader.ReadLineAsync(ct) is { } raw)
        {
            ct.ThrowIfCancellationRequested();
            if (raw.Length > 1_000_000) throw new InvalidDataException("سطر القائمة يتجاوز الحد الآمن");
            var line = raw.Trim().TrimStart('\uFEFF'); if (line.Length == 0) continue;
            if (!header) { if (!line.StartsWith("#EXTM3U", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("الملف ليس قائمة M3U صالحة"); header = true; continue; }
            if (line.StartsWith("#EXTINF:", StringComparison.OrdinalIgnoreCase))
            {
                image = Attribute(line, "tvg-logo"); group = Attribute(line, "group-title"); title = Attribute(line, "tvg-name");
                bool quoted = false;
                for (int i = 0; i < line.Length; i++)
                { if (line[i] == '"') quoted = !quoted; else if (line[i] == ',' && !quoted) { title = line[(i + 1)..].Trim(); break; } }
            }
            else if (!line.StartsWith('#'))
            {
                // A pipe suffix represents player options, not a valid network URL. Do not silently discard it.
                if (line.Contains('|')) throw new InvalidDataException("ترويسات M3U الملحقة بالرابط غير مدعومة بعد؛ استخدم إعدادات User-Agent وReferer للقائمة");
                if (!Uri.TryCreate(source, line, out var url) || url.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(url.UserInfo)) throw new InvalidDataException("رابط بث غير صالح في قائمة M3U");
                if (title.Length == 0) title = Uri.UnescapeDataString(url.Segments.LastOrDefault() ?? "قناة");
                string kind = Regex.IsMatch(url.AbsolutePath, @"\.(mp4|mkv|avi|mov|m4v|webm)$", RegexOptions.IgnoreCase) || url.AbsolutePath.Contains("/movie/", StringComparison.OrdinalIgnoreCase) ? "movie" : "live";
                string id = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(url.AbsoluteUri)))[..24];
                string art = image.Length > 0 && Uri.TryCreate(source, image, out var img) && img.Scheme is "http" or "https" ? img.AbsoluteUri : "";
                yield return new Entry(id, title, kind, group, art, "", url.AbsoluteUri, Order: index++);
                title = image = group = "";
                if (index > 2_000_000) throw new InvalidDataException("تجاوزت القائمة حد العناصر الآمن");
            }
        }
        if (!header) throw new InvalidDataException("القائمة فارغة");
    }
    private static string Attribute(string line, string key) => Regex.Match(line, "(?:^|\\s)" + Regex.Escape(key) + "=\"([^\"]*)\"", RegexOptions.IgnoreCase).Groups[1].Value;
    public async Task<Detail> Details(Provider p, Entry entry, CancellationToken ct)
    {
        if (p.Type != "xtream" || entry.Kind is "live" or "episode") return new(entry, "", "", "", entry.Genre, entry.Year, entry.Rating, entry.Image, []);
        bool series = entry.Kind == "series";
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(ct); limit.CancelAfter(TimeSpan.FromSeconds(25));
        using var response = await Get(p, Urls.Api(p, series ? "get_series_info" : "get_vod_info", series ? "series_id" : "vod_id", entry.Id), limit.Token);
        await using var stream = await response.Content.ReadAsStreamAsync(limit.Token);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: limit.Token);
        return ParseDetails(entry, doc.RootElement);
    }
    public static Detail ParseDetails(Entry entry, JsonElement root)
    {
        var info = root.Get("info"); var episodes = new List<Episode>(); var all = root.Get("episodes");
        void Add(JsonElement rows, int season)
        {
            foreach (var row in rows.Rows())
            {
                string id = row.Str("id"); if (id.Length == 0) continue;
                int number = row.Int("episode_num"); int s = row.Int("season", season);
                var direct = row.Str("direct_source"); if (direct.Length > 0) { try { _ = Urls.Http(direct); } catch { direct = ""; } }
                var e = new Entry(id, row.Str("title", "الحلقة " + number), "episode", entry.Id, row.Get("info").Str("movie_image", entry.Image), row.Str("container_extension", "mp4"), direct, Parent: entry.Id);
                episodes.Add(new(e, s, number));
            }
        }
        if (all.ValueKind == JsonValueKind.Object) foreach (var season in all.EnumerateObject()) Add(season.Value, int.TryParse(season.Name, out var s) ? s : 1);
        else if (all.ValueKind == JsonValueKind.Array) Add(all, 1);
        var movie = root.Get("movie_data");
        if (entry.Kind == "movie") entry = entry with { Extension = movie.Str("container_extension", entry.Extension) };
        return new(entry, info.Str("plot", info.Str("description")), info.Str("cast", info.Str("actors")), info.Str("director"), info.Str("genre", entry.Genre), info.Str("releaseDate", info.Str("releasedate", entry.Year)), info.Str("rating", entry.Rating), info.Str("cover_big", info.Str("movie_image", info.Str("cover", entry.Image))), episodes.DistinctBy(e => e.Entry.Id).OrderBy(e => e.Season).ThenBy(e => e.Number).ToList());
    }
    public async Task<string> Epg(Provider p, Entry entry, CancellationToken ct)
    {
        if (p.Type != "xtream") return "";
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct); timeout.CancelAfter(TimeSpan.FromSeconds(8));
        using var response = await Get(p, Urls.Api(p, "get_short_epg", "stream_id", entry.Id), timeout.Token);
        await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: timeout.Token);
        string Decode(string s) { try { return Encoding.UTF8.GetString(Convert.FromBase64String(s)); } catch { return s; } }
        return string.Join("\n", doc.RootElement.Get("epg_listings").Rows().Take(3).Select(row => row.Str("start").Split(' ').LastOrDefault() + "  " + Decode(row.Str("title"))));
    }
    public void Dispose() => _http.Dispose();
}

public sealed class PortalClient : IDisposable
{
    public const string ProductionBase = "https://blofy-player-2-0.vercel.app";
    private readonly HttpClient _http;
    private readonly Uri _base;
    public PortalClient(string endpoint = ProductionBase, HttpMessageHandler? handler = null)
    {
        _base = Urls.Http(endpoint);
        if (_base.Scheme != "https" && !_base.IsLoopback) throw new ArgumentException("التفعيل يحتاج اتصالًا مشفرًا");
        _http = new HttpClient(handler ?? new SocketsHttpHandler { AllowAutoRedirect = false, ConnectTimeout = TimeSpan.FromSeconds(8) }) { Timeout = TimeSpan.FromSeconds(18) };
    }
    public string PublicUrl(Identity identity) => Urls.Portal(_base.AbsoluteUri, identity);
    private async Task<JsonDocument> Post(string path, object body, CancellationToken ct)
    {
        using var response = await _http.PostAsJsonAsync(new Uri(_base, path), body, ct).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode) throw new HttpRequestException("Portal request failed", null, response.StatusCode);
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        return await JsonDocument.ParseAsync(stream, cancellationToken: ct);
    }
    public async Task<Entitlement> Check(Identity id, CancellationToken ct)
    {
        using var doc = await Post("/api/v1/activation/check", new { deviceId = id.DeviceId, activationCode = id.Code, trialScope = id.TrialScope, appVersion = "0.2.0-windows", platform = "windows" }, ct);
        var root = doc.RootElement; var raw = root.Get("expiresAt");
        long? expiry = raw.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? null : long.TryParse(raw.Scalar(), out var n) ? n : throw new InvalidDataException("رد مدة التفعيل غير صالح");
        long serverTime = root.Long("serverTime"); if (serverTime <= 0) throw new InvalidDataException("تعذر التحقق من وقت خدمة التفعيل");
        return new(root.Str("status").ToLowerInvariant(), expiry, serverTime);
    }
    public async Task<IReadOnlyList<Provider>> Playlists(Identity id, CancellationToken ct)
    {
        using var doc = await Post("/api/v1/portal/playlists/list", new { deviceId = id.DeviceId, activationCode = id.Code }, ct);
        var items = doc.RootElement.Get("items");
        if (items.ValueKind != JsonValueKind.Array) throw new InvalidDataException("رد قوائم الموقع غير صالح؛ لم تتغير قوائمك");
        var result = new List<Provider>();
        foreach (var row in items.EnumerateArray())
        {
            if (row.Str("id").Length == 0 || row.Str("providerType") is not ("xtream" or "m3u")) continue;
            var p = Urls.Input(row.Str("name"), row.Str("baseUrl"), row.Str("username"), row.Str("password"), row.Str("providerType") == "m3u");
            result.Add(p with { Id = row.Str("id"), FromPortal = true });
        }
        return result;
    }
    public async Task Push(Identity id, Provider p, CancellationToken ct)
    {
        using var doc = await Post("/api/v1/portal/playlists", new { deviceId = id.DeviceId, activationCode = id.Code, id = p.Id, name = p.Name, providerType = p.Type, baseUrl = p.Url, username = p.Username, password = p.Password, active = true }, ct);
    }
    public void Dispose() => _http.Dispose();
}
