using BlofyPlayer.Windows.Core.Identity;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace BlofyPlayer.Windows.Core;

public sealed record BlofySubscriberSession(
    string ProviderName,
    string BaseUrl,
    string Username,
    string Password,
    long ExpiresAt,
    string ProviderId,
    string SessionToken
);

public sealed class BlofySubscriberService : IDisposable
{
     public const string ProxyPath = "/api/v1/subscribers/xtream";

    private readonly HttpClient _http;
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    public BlofySubscriberService()
    {
        var handler = new HttpClientHandler
        {
            AllowAutoRedirect = false,
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate
        };
        _http = new HttpClient(handler)
        {
            BaseAddress = new Uri(BlofyEndpoints.ServiceBase),
            Timeout = TimeSpan.FromSeconds(18)
        };
        _http.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "BLOFY-PLAYER-Windows/0.3.0");
    }

    public async Task<bool> HealthAsync(CancellationToken ct = default)
    {
        using var response = await _http.GetAsync(BlofyEndpoints.SubscriberRoot + "/health", ct);
        if (!response.IsSuccessStatusCode) return false;
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        return doc.RootElement.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True;
    }

    public async Task<BlofySubscriberSession> CreateSessionAsync(
        BlofyIdentity identity,
        string username,
        string password,
        CancellationToken ct = default)
    {
        if (!await HealthAsync(ct))
            throw new InvalidOperationException("خدمة مشتركين BLOFY غير متاحة الآن.");

        var body = new
        {
            deviceId = identity.DeviceId,
            activationCode = identity.ActivationCode,
            username = username.Trim(),
            password,
            delivery = "direct"
        };

        using var response = await _http.PostAsJsonAsync(BlofyEndpoints.SubscriberRoot + "/session", body, _json, ct);
        var raw = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException(ErrorMessage(raw));

        using var doc = JsonDocument.Parse(raw);
        return ParseSession(doc.RootElement);
    }

    public async Task<Dictionary<string, BlofySubscriberSession>> ResolveAsync(
        BlofyIdentity identity,
        IEnumerable<string> tokens,
        CancellationToken ct = default)
    {
        var clean = tokens
            .Where(IsValidToken)
            .Distinct(StringComparer.Ordinal)
            .ToList();
        var result = new Dictionary<string, BlofySubscriberSession>(StringComparer.Ordinal);
        if (clean.Count == 0) return result;

        foreach (var batch in clean.Chunk(20))
        {
            var body = new
            {
                deviceId = identity.DeviceId,
                activationCode = identity.ActivationCode,
                sessionTokens = batch
            };
            using var response = await _http.PostAsJsonAsync(BlofyEndpoints.SubscriberRoot + "/resolve", body, _json, ct);
            if (!response.IsSuccessStatusCode) continue;

            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            if (!doc.RootElement.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array)
                continue;

            foreach (var row in items.EnumerateArray())
            {
                var token = Get(row, "sessionToken");
                if (!batch.Contains(token, StringComparer.Ordinal)) continue;
                if (row.TryGetProperty("error", out _)) continue;
                try { result[token] = ParseSession(row); } catch { }
            }
        }
        return result;
    }

    public static bool IsProxyUrl(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)) return false;
        return uri.AbsolutePath.TrimEnd('/').Equals(ProxyPath, StringComparison.OrdinalIgnoreCase);
    }

    public static bool IsValidToken(string value) =>
        value.Length is >= 1 and <= 4096 &&
        value.All(c => c < 128 && (char.IsLetterOrDigit(c) || c is '-' or '_'));

    private static BlofySubscriberSession ParseSession(JsonElement root)
    {
        if (!Get(root, "delivery").Equals("direct", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("خدمة BLOFY تحتاج تحديث الاتصال المباشر.");

        var baseUrl = Get(root, "baseUrl").Trim().TrimEnd('/');
        var username = Get(root, "username");
        var password = Get(root, "password");
        var token = Get(root, "sessionToken");
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri) ||
            uri.Scheme is not ("http" or "https") ||
            IsProxyUrl(baseUrl) ||
            string.IsNullOrWhiteSpace(username) ||
            string.IsNullOrWhiteSpace(password) ||
            !IsValidToken(token))
            throw new InvalidOperationException("استجابة BLOFY غير مكتملة.");

        return new BlofySubscriberSession(
            Get(root, "providerName") is { Length: > 0 } name ? name : "مشترك BLOFY",
            baseUrl,
            username,
            password,
            Long(root, "expiresAt"),
            Get(root, "providerId"),
            token
        );
    }

    private static string ErrorMessage(string raw)
    {
        try
        {
            using var doc = JsonDocument.Parse(raw);
            var error = Get(doc.RootElement, "error");
            return error switch
            {
                "invalid_subscriber_credentials" => "أدخل اسم المستخدم وكلمة المرور بشكل صحيح.",
                "subscriber_login_failed" => "اسم المستخدم أو كلمة المرور غير صحيحة.",
                "unauthorized_device" => "يجب تفعيل جهاز BLOFY أولًا.",
                "subscriber_service_unavailable" => "خدمة مشتركين BLOFY غير جاهزة.",
                "subscriber_upstream_unavailable" => "تعذر الوصول إلى سيرفر الاشتراك.",
                "subscriber_proxy_error" => "حدث خطأ في بوابة BLOFY الآمنة.",
                _ => "تعذر تسجيل الدخول إلى مشتركين BLOFY."
            };
        }
        catch
        {
            return "تعذر تسجيل الدخول إلى مشتركين BLOFY.";
        }
    }

    private static string Get(JsonElement row, string key)
    {
        if (row.ValueKind != JsonValueKind.Object) return "";
        foreach (var p in row.EnumerateObject())
            if (p.Name.Equals(key, StringComparison.OrdinalIgnoreCase))
                return p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() ?? "" : p.Value.ToString();
        return "";
    }

    private static long Long(JsonElement row, string key) =>
        long.TryParse(Get(row, key), out var value) ? value : 0;

    public void Dispose() => _http.Dispose();
}
