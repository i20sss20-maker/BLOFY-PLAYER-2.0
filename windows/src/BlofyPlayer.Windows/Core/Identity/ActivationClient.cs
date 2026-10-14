using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;

namespace BlofyPlayer.Windows.Core.Identity;

public sealed record ActivationCheckRequest(
    string DeviceId,
    string ActivationCode,
    string AppVersion,
    string Platform = "windows",
    string? TrialScope = null
);

public sealed record ActivationCheckResponse(
    string Status,
    long? ExpiresAt = null,
    long? ServerTime = null,
    string? Message = null
)
{
    public bool CanUse()
    {
        if (!Status.Equals("trial", StringComparison.OrdinalIgnoreCase)
            && !Status.Equals("active", StringComparison.OrdinalIgnoreCase))
            return false;

        var now = ServerTime ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        return ExpiresAt is null || ExpiresAt > now;
    }
}

public sealed class ActivationClient : IDisposable
{
    private readonly HttpClient _http;
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    public ActivationClient(string baseUrl = BlofyPlayer.Windows.Core.BlofyEndpoints.ServiceBase)
    {
        // Never follow a redirect carrying the device activation credential.
        _http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })
        {
            BaseAddress = new Uri(baseUrl.EndsWith('/') ? baseUrl : baseUrl + "/"),
            Timeout = TimeSpan.FromSeconds(8)
        };
        _http.DefaultRequestHeaders.TryAddWithoutValidation(
            "User-Agent", BlofyPlayer.Windows.Core.AppBuildInfo.UserAgent);
    }

    public async Task<ActivationCheckResponse?> CheckAsync(
        BlofyIdentity identity,
        CancellationToken cancellationToken = default)
    {
        var payload = new ActivationCheckRequest(
            identity.DeviceId,
            identity.ActivationCode,
            BlofyPlayer.Windows.Core.AppBuildInfo.WindowsVersion,
            "windows",
            identity.TrialScope
        );

        // A brief network/5xx outage is not an invalid activation. Retry once
        // without retrying rejected credentials or a rate-limited device.
        for (var attempt = 0; attempt < 2; attempt++)
        {
            try
            {
                using var response = await _http.PostAsJsonAsync(
                    BlofyPlayer.Windows.Core.BlofyEndpoints.ActivationCheck,
                    payload,
                    _json,
                    cancellationToken
                );

                if (response.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.Forbidden)
                {
                    // The service intentionally responds 403 for blocked devices.
                    // Display the real blocked state rather than a misleading
                    // "server disconnected" banner.
                    var rejected = await response.Content.ReadFromJsonAsync<ActivationCheckResponse>(
                        _json, cancellationToken);
                    return rejected?.Status.Equals("blocked", StringComparison.OrdinalIgnoreCase) == true
                        ? rejected : null;
                }

                if ((int)response.StatusCode >= 500 && attempt == 0)
                {
                    await Task.Delay(350, cancellationToken);
                    continue;
                }

                if (!response.IsSuccessStatusCode) return null;
                return await response.Content.ReadFromJsonAsync<ActivationCheckResponse>(
                    _json, cancellationToken);
            }
            catch (HttpRequestException) when (attempt == 0 && !cancellationToken.IsCancellationRequested)
            {
                await Task.Delay(350, cancellationToken);
            }
        }

        return null;
    }

    public void Dispose() => _http.Dispose();
}
