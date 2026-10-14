using System.IO;
using System.Net;
using System.Net.Http;
using System.Text.Json;

namespace BlofyPlayer.Windows.Core;

/// <summary>
/// Public, credential-free health probe. Never submit device IDs, passwords,
/// playlist URLs or account tokens to a diagnostic endpoint.
/// </summary>
public static class ConnectionProbe
{
    public sealed record Result(bool Healthy, string Message, int? HttpStatus = null);

    public static async Task<Result> CheckAsync(HttpClient client, CancellationToken ct = default)
    {
        try
        {
            using var response = await client.GetAsync("health", ct).ConfigureAwait(false);
            var code = (int)response.StatusCode;
            if (response.StatusCode == HttpStatusCode.ServiceUnavailable)
                return new Result(false, "السيرفر يعمل لكن قاعدة البيانات غير جاهزة (503).", code);
            if (!response.IsSuccessStatusCode)
                return new Result(false, "خادم BLOFY رفض طلب الفحص (HTTP " + code + ").", code);
            if (response.Content.Headers.ContentLength is > 16384)
                return new Result(false, "استجابة فحص السيرفر غير صالحة.", code);

            await using var body = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
            using var limited = new LengthLimitedStream(body, 16384);
            using var json = await JsonDocument.ParseAsync(limited, cancellationToken: ct)
                .ConfigureAwait(false);
            var root = json.RootElement;
            var ok = root.TryGetProperty("ok", out var state) && state.ValueKind == JsonValueKind.True;
            var databaseReady = root.TryGetProperty("database", out var database) &&
                database.ValueKind == JsonValueKind.String &&
                database.GetString()?.Equals("ready", StringComparison.OrdinalIgnoreCase) == true;
            return ok && databaseReady
                ? new Result(true, "الاتصال بخادم BLOFY وقاعدة البيانات يعمل.", code)
                : new Result(false, "السيرفر يرد لكن خدماته الداخلية غير جاهزة.", code);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return new Result(false, "انتهت مهلة الاتصال بسيرفر BLOFY.");
        }
        catch (HttpRequestException)
        {
            return new Result(false, "تعذر الوصول إلى خادم BLOFY؛ افحص DNS والإنترنت أو إعدادات الشبكة.");
        }
        catch (JsonException)
        {
            return new Result(false, "الخادم يعيد استجابة غير متوقعة.");
        }
        catch (InvalidDataException)
        {
            return new Result(false, "استجابة السيرفر أكبر من الحد المسموح.");
        }
    }
}
