using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace BlofyPlayer.Windows.Core;

/// <summary>
/// Local, loopback-only media bridge. LibVLC cannot reliably send custom bearer
/// headers; this bridge forwards bytes to the authenticated BLOFY HTTPS API
/// without revealing tokens in playback URLs. Only strict numeric media IDs
/// on the fixed BLOFY host are allowed, and upstream redirects are rejected.
/// </summary>
public sealed class StreamMediaProxy : IAsyncDisposable
{
    private readonly string _secret = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(24));
    private readonly HttpClient _http = new(new HttpClientHandler
    {
        AllowAutoRedirect = false,
        UseCookies = false,
        AutomaticDecompression = DecompressionMethods.None
    }) { Timeout = Timeout.InfiniteTimeSpan };
    private WebApplication? _app;
    private string? _base;
    private readonly SemaphoreSlim _startGate = new(1, 1);
    private readonly SemaphoreSlim _connections = new(12, 12);

    public async Task StartAsync(CancellationToken ct = default)
    {
        if (_base is not null) return;
        await _startGate.WaitAsync(ct);
        try
        {
            if (_base is not null) return;
            var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions
            {
                Args = [],
                EnvironmentName = "Production"
            });
            builder.WebHost.UseKestrel(o => o.Listen(IPAddress.Loopback, 0));
            var app = builder.Build();
            app.MapMethods("/{key}/media/{kind}/{asset}", ["GET", "HEAD"],
                async (HttpContext ctx, string key, string kind, string asset) =>
                {
                    if (key != _secret || !Regex.IsMatch(asset, @"^[0-9]{1,15}\.[A-Za-z0-9]{1,8}$") ||
                        kind is not ("live" or "movie" or "series"))
                    {
                        ctx.Response.StatusCode = 404;
                        return;
                    }
                    var session = StreamCodeAccess.Token();
                    if (session is null)
                    {
                        ctx.Response.StatusCode = 401;
                        return;
                    }
                    if (!await _connections.WaitAsync(TimeSpan.FromSeconds(10), ctx.RequestAborted))
                    {
                        ctx.Response.StatusCode = 503;
                        return;
                    }
                    try
                    {
                        var target = StreamCodeAccess.Host + "/api/v1/stream/media/" + kind + "/" + asset;
                        using var message = new HttpRequestMessage(
                            ctx.Request.Method == "HEAD" ? HttpMethod.Head : HttpMethod.Get, target);
                        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", session);
                        message.Headers.TryAddWithoutValidation("User-Agent", "BLOFY STREAM/55.8.7 (Windows)");
                        if (ctx.Request.Headers.TryGetValue("Range", out var range) &&
                            Regex.IsMatch(range.ToString(), @"^bytes=\d+-\d*$"))
                            message.Headers.TryAddWithoutValidation("Range", range.ToString());
                        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ctx.RequestAborted);
                        timeout.CancelAfter(TimeSpan.FromMinutes(20)); // live sessions may reconnect.
                        using var response = await _http.SendAsync(message,
                            HttpCompletionOption.ResponseHeadersRead, timeout.Token);
                        ctx.Response.StatusCode = (int)response.StatusCode;
                        if ((int)response.StatusCode is >= 300 and < 400) return; // never follow redirect
                        if (response.Content.Headers.ContentType is not null)
                            ctx.Response.ContentType = response.Content.Headers.ContentType.ToString();
                        if (response.Content.Headers.ContentLength is long length)
                            ctx.Response.ContentLength = length;
                        if (response.Content.Headers.ContentRange is not null)
                            ctx.Response.Headers.ContentRange = response.Content.Headers.ContentRange.ToString();
                        ctx.Response.Headers.CacheControl = "no-store";
                        ctx.Response.Headers.XContentTypeOptions = "nosniff";
                        if (ctx.Request.Method != "HEAD")
                        {
                            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
                            await stream.CopyToAsync(ctx.Response.Body, timeout.Token);
                        }
                    }
                    catch (OperationCanceledException) when (ctx.RequestAborted.IsCancellationRequested) { }
                    catch (Exception)
                    {
                        if (!ctx.Response.HasStarted) ctx.Response.StatusCode = 502;
                    }
                    finally { _connections.Release(); }
                });
            try
            {
                await app.StartAsync(ct);
                var server = app.Services.GetRequiredService<IServer>();
                var binding = server.Features.Get<IServerAddressesFeature>()?.Addresses
                    .FirstOrDefault(x => x.StartsWith("http://127.0.0.1:", StringComparison.Ordinal));
                if (binding is null) throw new InvalidOperationException("Could not bind local playback bridge");
                _app = app;
                _base = binding.TrimEnd('/') + "/" + _secret + "/media/";
            }
            catch
            {
                await app.DisposeAsync();
                throw;
            }
        }
        finally { _startGate.Release(); }
    }

    public string LocalUrl(string remote)
    {
        if (_base is null) throw new InvalidOperationException("Playback bridge not started");
        if (!StreamCodeAccess.IsTrustedMediaUrl(remote))
            throw new InvalidDataException("Untrusted STREAM media URL");
        var uri = new Uri(remote);
        const string prefix = "/api/v1/stream/media/";
        var relative = uri.AbsolutePath[prefix.Length..];
        return _base + relative;
    }

    public async ValueTask DisposeAsync()
    {
        if (_app is not null)
        {
            using var shutdown = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            await _app.StopAsync(shutdown.Token);
            await _app.DisposeAsync();
            _app = null;
        }
        _base = null;
        _http.Dispose();
        _connections.Dispose();
        _startGate.Dispose();
    }
}
