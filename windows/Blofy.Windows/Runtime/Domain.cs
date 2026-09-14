using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Blofy.Windows.Runtime;

public static class CompatibilityDefaults
{
    public const string UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 BLOFY-PLAYER/0.3";
}

public sealed record Provider(string Id, string Name, string Type, string Url, string Username = "", string Password = "", string UserAgent = CompatibilityDefaults.UserAgent, string Referer = "", string LiveFormat = "ts", bool FromPortal = false)
{
    public string Fingerprint => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new[] { Type, Url, Username, Password }))));
    public override string ToString() => Name;
}
public sealed record Category(string Id, string Name, string Kind, int Order = 0) { public override string ToString() => Name; }
public sealed record Entry(string Id, string Name, string Kind, string Category = "", string Image = "", string Extension = "", string Url = "", string Rating = "", string Year = "", string Genre = "", int Order = 0, string Parent = "", string HeaderUserAgent = "", string HeaderReferer = "")
{
    public string Key => Kind + ":" + Id;
    public override string ToString() => Name;
}
public sealed record Episode(Entry Entry, int Season, int Number);
public sealed record Detail(Entry Entry, string Plot, string Cast, string Director, string Genre, string Released, string Rating, string Image, IReadOnlyList<Episode> Episodes);
public sealed record ImportStatus(string Message, long Count, int Stage = 0);
public sealed record CatalogPage(IReadOnlyList<Entry> Items, int Total);
public sealed record Watch(Entry Entry, long Position, long Duration, bool Favorite, long Updated);
public sealed record PlaybackPreferences(int CacheMs = 950, int Volume = 90, bool Hardware = true, string AudioLanguage = "ar", string SubtitleLanguage = "ar", bool AutoplayNext = true, bool FillVideo = false);
public sealed record Identity(string DeviceId, string Code, string TrialScope);
public sealed class UserData
{
    public Identity Identity { get; set; } = null!;
    public List<Provider> Providers { get; set; } = [];
    public string ActiveId { get; set; } = "";
    public PlaybackPreferences Preferences { get; set; } = new();
}
public sealed record Entitlement(string Status, long? ExpiresAt, long ServerTime)
{
    private readonly long _at = Stopwatch.GetTimestamp();
    public bool Allowed => (Status is "trial" or "active") && (ExpiresAt is null || ExpiresAt > ServerTime + (long)Stopwatch.GetElapsedTime(_at).TotalMilliseconds);
    public string Label => Status switch { "active" => ExpiresAt is null ? "مفعّل — مدى الحياة" : "مفعّل حتى " + DateTimeOffset.FromUnixTimeMilliseconds(ExpiresAt.Value).ToLocalTime().ToString("yyyy/MM/dd"), "trial" => ExpiresAt is null ? "تجربة مفعّلة" : "تجربة حتى " + DateTimeOffset.FromUnixTimeMilliseconds(ExpiresAt.Value).ToLocalTime().ToString("yyyy/MM/dd"), "blocked" => "الجهاز محظور؛ راجع الدعم", "expired" => "انتهى التفعيل؛ جدّد من الموقع", _ => "يلزم التفعيل من الموقع" };
}

public static class Json
{
    public static JsonElement Get(this JsonElement value, string name) => value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out var v) ? v : default;
    public static string Str(this JsonElement value, string name, string fallback = "") => value.Get(name).Scalar(fallback);
    public static string Scalar(this JsonElement value, string fallback = "") => value.ValueKind switch { JsonValueKind.String => value.GetString() ?? fallback, JsonValueKind.Number => value.GetRawText(), JsonValueKind.True => "1", JsonValueKind.False => "0", _ => fallback };
    public static int Int(this JsonElement value, string name, int fallback = 0) => int.TryParse(value.Str(name), out var n) ? n : fallback;
    public static long Long(this JsonElement value, string name, long fallback = 0) => long.TryParse(value.Str(name), out var n) ? n : fallback;
    public static IEnumerable<JsonElement> Rows(this JsonElement value) => value.ValueKind == JsonValueKind.Array ? value.EnumerateArray() : Enumerable.Empty<JsonElement>();
}

public static class Urls
{
    public static Uri Http(string value)
    {
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") || string.IsNullOrEmpty(uri.Host) || !string.IsNullOrEmpty(uri.UserInfo))
            throw new ArgumentException("أدخل رابط HTTP أو HTTPS صحيحًا، واستخدم حقول اسم المستخدم وكلمة المرور");
        return uri;
    }
    public static string Header(string value)
    {
        if (value.Length > 1024 || value.Any(c => c < 32 || c == 127)) throw new ArgumentException("ترويسة السيرفر غير صالحة");
        return value;
    }
    public static string Origin(Uri uri) => uri.GetLeftPart(UriPartial.Authority);
    public static Provider Input(string name, string url, string user, string pass, bool m3u, Provider? previous = null)
    {
        var uri = Http(url); var query = Query(uri.Query);
        if (!m3u && query.TryGetValue("username", out var u) && query.TryGetValue("password", out var p))
        { if (string.IsNullOrWhiteSpace(user)) user = u; if (string.IsNullOrEmpty(pass)) pass = p; }
        string endpoint = uri.AbsoluteUri;
        if (!m3u)
        {
            if (string.IsNullOrWhiteSpace(user) || string.IsNullOrEmpty(pass)) throw new ArgumentException("أدخل اسم المستخدم وكلمة المرور معًا");
            string path = uri.AbsolutePath.TrimEnd('/');
            if (path.EndsWith("/get.php", StringComparison.OrdinalIgnoreCase) || path.EndsWith("/player_api.php", StringComparison.OrdinalIgnoreCase)) path = path[..path.LastIndexOf('/')];
            endpoint = new UriBuilder(uri) { Path = path, Query = "", Fragment = "" }.Uri.AbsoluteUri.TrimEnd('/');
        }
        return new Provider(previous?.Id ?? Guid.NewGuid().ToString("N"), string.IsNullOrWhiteSpace(name) ? uri.Host : name.Trim(), m3u ? "m3u" : "xtream", endpoint, user.Trim(), pass, previous?.UserAgent ?? CompatibilityDefaults.UserAgent, previous?.Referer ?? "", previous?.LiveFormat ?? "ts", previous?.FromPortal ?? false);
    }
    public static Dictionary<string, string> Query(string input)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in input.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        { var parts = pair.Split('=', 2); result[Uri.UnescapeDataString(parts[0].Replace('+', ' '))] = parts.Length > 1 ? Uri.UnescapeDataString(parts[1].Replace('+', ' ')) : ""; }
        return result;
    }
    public static Uri Api(Provider provider, string action = "", string idKey = "", string id = "") => ApiAt(provider.Url, provider, action, idKey, id);
    public static Uri ApiAt(string baseUrl, Provider provider, string action = "", string idKey = "", string id = "")
    {
        var url = baseUrl.TrimEnd('/') + "/player_api.php?username=" + Uri.EscapeDataString(provider.Username) + "&password=" + Uri.EscapeDataString(provider.Password);
        if (action.Length > 0) url += "&action=" + Uri.EscapeDataString(action);
        if (idKey.Length > 0) url += "&" + Uri.EscapeDataString(idKey) + "=" + Uri.EscapeDataString(id);
        return Http(url);
    }
    public static IReadOnlyList<string> XtreamBaseCandidates(Provider provider)
    {
        var source = Http(provider.Url);
        var result = new List<string> { provider.Url.TrimEnd('/') };
        var root = source.GetLeftPart(UriPartial.Authority);
        if (!result.Contains(root, StringComparer.OrdinalIgnoreCase)) result.Add(root);
        var path = source.AbsolutePath.Trim('/');
        if (path.Contains('/'))
        {
            var first = path.Split('/', 2)[0];
            var firstBase = root + "/" + first;
            if (!result.Contains(firstBase, StringComparer.OrdinalIgnoreCase)) result.Add(firstBase);
        }
        return result;
    }
    public static Uri Stream(Provider p, Entry e, string? liveFormat = null)
    {
        if (e.Url.Length > 0) return Http(e.Url);
        var kind = e.Kind switch { "live" => "live", "movie" => "movie", "episode" => "series", _ => throw new ArgumentException("اختر الحلقة أولًا") };
        var extension = e.Kind == "live" ? liveFormat ?? p.LiveFormat : e.Extension;
        if (string.IsNullOrWhiteSpace(extension)) extension = e.Kind == "live" ? "ts" : "mp4";
        if (!Regex.IsMatch(extension, "^[a-zA-Z0-9]{1,8}$")) throw new ArgumentException("صيغة الملف غير صالحة");
        return Http($"{p.Url.TrimEnd('/')}/{kind}/{Uri.EscapeDataString(p.Username)}/{Uri.EscapeDataString(p.Password)}/{Uri.EscapeDataString(e.Id)}.{extension}");
    }
    public static string Portal(string baseUrl, Identity identity)
    {
        var uri = Http(baseUrl); if (uri.Scheme != "https" && !uri.IsLoopback) throw new ArgumentException("موقع التفعيل يجب أن يكون HTTPS");
        return new UriBuilder(uri) { Path = "/", Query = "", Fragment = "deviceId=" + Uri.EscapeDataString(identity.DeviceId) + "&code=" + identity.Code }.Uri.AbsoluteUri;
    }
    public static string Error(Exception exception) => exception switch
    {
        OperationCanceledException => "أُلغي الطلب أو انتهت مهلة الاتصال",
        HttpRequestException h when h.StatusCode is not null => $"رفض السيرفر الطلب (HTTP {(int)h.StatusCode})",
        HttpRequestException => "تعذر الوصول إلى السيرفر؛ تحقق من الرابط والشبكة أو جرّب HTTP/HTTPS الصحيح",
        JsonException => "السيرفر لم يرجع بيانات JSON صالحة؛ جرّب عنوان السيرفر الأساسي بدون مسار زائد",
        ArgumentException a => a.Message,
        InvalidDataException a => a.Message,
        _ => "تعذرت العملية؛ لم تُحذف بياناتك. جرّب مرة أخرى"
    };
}
