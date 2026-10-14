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
        _http = new HttpClient
        {
            BaseAddress = new Uri(baseUrl.EndsWith('/') ? baseUrl : baseUrl + "/"),
            Timeout = TimeSpan.FromSeconds(8)
        };
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

        using var response = await _http.PostAsJsonAsync(
            BlofyPlayer.Windows.Core.BlofyEndpoints.ActivationCheck,
            payload,
            _json,
            cancellationToken
        );

        // The activation API intentionally returns 400/403 with a "blocked"
        // JSON state. Preserve that state instead of calling it a network error.
        // Never accept a success-like activation from a non-2xx response.
        if (!response.IsSuccessStatusCode)
        {
            if (response.StatusCode is System.Net.HttpStatusCode.BadRequest or
                System.Net.HttpStatusCode.Forbidden)
            {
                try
                {
                    var rejected = await response.Content.ReadFromJsonAsync<ActivationCheckResponse>(
                        _json, cancellationToken);
                    return rejected?.Status.Equals("blocked", StringComparison.OrdinalIgnoreCase) == true
                        ? rejected : null;
                }
                catch (JsonException)
                {
                    return null;
                }
            }
            return null;
        }

        return await response.Content.ReadFromJsonAsync<ActivationCheckResponse>(_json, cancellationToken);
    }

    public void Dispose() => _http.Dispose();
}
