using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace BlofyPlayer.Windows.Core;

/// <summary>
/// Windows edition of the Android STREAM code-only contract.
/// Tokens and the stable per-installation key are encrypted with Windows DPAPI.
/// Never persist Xtream host/user/password or make playback access decisions from
/// a local machine clock: the BLOFY server controls session expiry.
/// </summary>
public static class StreamCodeAccess
{
    public const string Host = "https://blofyplayer.com";
    public const string ProviderId = "blofy-stream-windows-code-provider-v1";
    private static readonly Regex TokenFormat = new(
        @"^v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex NumericCode = new(
        @"^[0-9]{8,12}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex LegacyHexCode = new(
        @"^[A-F0-9]{24}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly HttpClient Http = new(new HttpClientHandler
    {
        AllowAutoRedirect = false,
        AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate
    }) { BaseAddress = new Uri(Host), Timeout = TimeSpan.FromSeconds(25) };
    private static readonly object Gate = new();
    private static readonly string Root = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BLOFY STREAM");
    private static readonly string DevicePath = Path.Combine(Root, "device.key");
    private static readonly string SessionPath = Path.Combine(Root, "session.dat");

    public static string NormalizeCode(string value)
    {
        var sb = new StringBuilder(value.Length);
        foreach (var c in value.Trim())
        {
            var v = c is >= '٠' and <= '٩' ? (char)('0' + c - '٠') :
                c is >= '۰' and <= '۹' ? (char)('0' + c - '۰') : c;
            if (!char.IsWhiteSpace(v) && v != '-') sb.Append(char.ToUpperInvariant(v));
        }
        var normalized = sb.ToString();
        return NumericCode.IsMatch(normalized) || LegacyHexCode.IsMatch(normalized) ? normalized : "";
    }

    private static byte[] ReadProtected(string path)
    {
        var cipher = File.ReadAllBytes(path);
        return ProtectedData.Unprotect(cipher, null, DataProtectionScope.CurrentUser);
    }

    private static void WriteProtected(string path, byte[] plaintext)
    {
        Directory.CreateDirectory(Root);
        var cipher = ProtectedData.Protect(plaintext, null, DataProtectionScope.CurrentUser);
        var temp = path + ".tmp";
        File.WriteAllBytes(temp, cipher);
        File.Move(temp, path, true);
    }

    public static string DeviceKey()
    {
        lock (Gate)
        {
            if (File.Exists(DevicePath))
            {
                var current = ReadProtected(DevicePath);
                if (current.Length != 32) throw new InvalidDataException("Invalid protected device key");
                return Convert.ToHexStringLower(current);
            }
            var random = RandomNumberGenerator.GetBytes(32);
            WriteProtected(DevicePath, random);
            return Convert.ToHexStringLower(random);
        }
    }

    public static string? Token()
    {
        lock (Gate)
        {
            if (!File.Exists(SessionPath)) return null;
            try
            {
                var value = Encoding.UTF8.GetString(ReadProtected(SessionPath));
                return TokenFormat.IsMatch(value) ? value : null;
            }
            catch { return null; }
        }
    }

    public static bool HasSavedSession => Token() is not null;

    public static void Save(string token)
    {
        if (!TokenFormat.IsMatch(token)) throw new InvalidDataException("Invalid session token");
        lock (Gate) WriteProtected(SessionPath, Encoding.UTF8.GetBytes(token));
    }

    /// <summary>Local logout preserves the encrypted installation binding.</summary>
    public static void Logout()
    {
        lock (Gate)
        {
            if (File.Exists(SessionPath)) File.Delete(SessionPath);
        }
    }

    public static bool IsStreamProvider(ProviderAccount? provider) =>
        provider is { ProviderType: "stream" } &&
        provider.BaseUrl.TrimEnd('/').Equals(Host, StringComparison.Ordinal);

    public static ProviderAccount CreateProvider() => new()
    {
        Id = ProviderId,
        Name = "BLOFY STREAM",
        ProviderType = "stream",
        BaseUrl = Host,
        Username = "",
        Password = "",
        M3uUrl = "",
        SubscriberToken = "",
        Active = true
    };

    public static async Task<bool?> VerifyAsync(CancellationToken ct = default)
    {
        var token = Token();
        if (token is null) return false;
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/stream/app/session");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.CacheControl = new CacheControlHeaderValue { NoStore = true };
        try
        {
            using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden) return false;
            if (!response.IsSuccessStatusCode) return null;
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            var root = json.RootElement;
            return root.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True &&
                   root.TryGetProperty("active", out var active) && active.ValueKind == JsonValueKind.True;
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { return null; }
        catch (HttpRequestException) { return null; }
        catch (JsonException) { return null; }
    }

    public static async Task RedeemAsync(string rawCode, CancellationToken ct = default)
    {
        var code = NormalizeCode(rawCode);
        if (code.Length == 0) throw new InvalidOperationException("كود غير صالح (8–12 رقمًا)");
        // Compute and persist the binding before the redeem POST. A retry after
        // a lost network response must use the same key.
        var key = DeviceKey();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/stream/app/redeem")
        {
            Content = JsonContent.Create(new { code, deviceKey = key })
        };
        request.Headers.CacheControl = new CacheControlHeaderValue { NoStore = true };
        using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(response.StatusCode switch
            {
                HttpStatusCode.Conflict => "الكود مرتبط بجهاز آخر أو غير متاح",
                HttpStatusCode.TooManyRequests => "محاولات كثيرة، أعد المحاولة لاحقًا",
                HttpStatusCode.BadRequest => "تأكد من كود التفعيل",
                _ => "تعذر تفعيل الكود، تحقق من اتصال الإنترنت"
            });
        }
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        var root = json.RootElement;
        if (!root.TryGetProperty("ok", out var ok) || ok.ValueKind != JsonValueKind.True ||
            !root.TryGetProperty("tokenType", out var tokenType) || tokenType.GetString() != "Bearer" ||
            !root.TryGetProperty("accessToken", out var access) ||
            !root.TryGetProperty("account", out var account) ||
            !account.TryGetProperty("activatedAt", out var activated) ||
            !account.TryGetProperty("expiresAt", out var expires) ||
            !activated.TryGetInt64(out var activatedAt) || !expires.TryGetInt64(out var expiresAt) ||
            expiresAt <= activatedAt || activatedAt <= 0)
            throw new InvalidDataException("استجابة التفعيل غير مكتملة");
        Save(access.GetString() ?? "");
    }

    /// <summary>
    /// Only inject the bearer for BLOFY's exact HTTPS catalog endpoint.
    /// Redirects are disabled in the network client, so no other host sees it.
    /// </summary>
    public static void AuthorizeCatalog(HttpRequestMessage request)
    {
        var url = request.RequestUri;
        if (url is null || url.Scheme != Uri.UriSchemeHttps ||
            url.Host != "blofyplayer.com" || !url.IsDefaultPort ||
            url.AbsolutePath != "/player_api.php") return;
        var token = Token();
        if (token is null) throw new InvalidOperationException("STREAM session is not active");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }

    public static string MediaUrl(string kind, string remoteId, string extension)
    {
        if (kind is not ("live" or "movie" or "series"))
            throw new ArgumentOutOfRangeException(nameof(kind));
        if (!Regex.IsMatch(remoteId, @"^[0-9]{1,15}$", RegexOptions.CultureInvariant))
            throw new InvalidDataException("Invalid media identifier");
        var ext = extension.Trim().TrimStart('.');
        if (!Regex.IsMatch(ext, @"^[A-Za-z0-9]{1,8}$", RegexOptions.CultureInvariant))
            throw new InvalidDataException("Invalid media extension");
        return Host + "/api/v1/stream/media/" + kind + "/" + remoteId + "." + ext;
    }

    public static bool IsTrustedMediaUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps || uri.Host != "blofyplayer.com" ||
            !uri.IsDefaultPort || uri.Query.Length != 0 || uri.Fragment.Length != 0) return false;
        return Regex.IsMatch(uri.AbsolutePath,
            @"^/api/v1/stream/media/(live|movie|series)/[0-9]{1,15}\.[A-Za-z0-9]{1,8}$",
            RegexOptions.CultureInvariant);
    }
}
