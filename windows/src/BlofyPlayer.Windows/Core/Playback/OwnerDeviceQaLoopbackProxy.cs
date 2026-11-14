#if DEBUG
using System.Buffers;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace BlofyPlayer.Windows.Core.Playback;

/// <summary>
/// Debug-only operator device lab. The actual LibVLC player consumes an
/// ephemeral loopback stream fed exclusively from a short-lived signed
/// capability for one SHA-verified Content Hub episode.
/// This has no relationship to subscriber playback, Xtream or update feeds.
/// No media, tokens or URLs are saved in the app's catalog/config/logs.
/// </summary>
public sealed class OwnerDeviceQaLoopbackProxy : IAsyncDisposable
{
    private const int ChunkLimit = 8 * 1024 * 1024;
    private const long MaximumMediaBytes = 4L * 1024 * 1024 * 1024;
    private readonly string _runId;
    private readonly string _ticket;
    private readonly string _secret = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(24));
    private readonly HttpClient _client = new(new HttpClientHandler
    {
        AllowAutoRedirect = false,
        UseCookies = false,
        AutomaticDecompression = DecompressionMethods.None
    }) { Timeout = Timeout.InfiniteTimeSpan };
    private readonly SemaphoreSlim _connections = new(2, 2);
    private WebApplication? _app;
    private string _type = "";
    private long _length;
    public string PlaybackUrl { get; private set; } = "";

    private OwnerDeviceQaLoopbackProxy(string runId, string ticket)
    {
        _runId = runId;
        _ticket = ticket;
    }

    public static async Task<OwnerDeviceQaLoopbackProxy> StartAsync(
        string runId, string ticket, CancellationToken cancellationToken = default)
    {
        if (!Regex.IsMatch(runId ?? "", @"^[A-Za-z0-9_-]{8,80}$") ||
            !Regex.IsMatch(ticket ?? "", @"^v1\.[A-Za-z0-9_-]{20,450}\.[A-Za-z0-9_-]{43}$"))
            throw new InvalidOperationException("Invalid owner QA run or short-lived ticket");

        var proxy = new OwnerDeviceQaLoopbackProxy(runId, ticket);
        try
        {
            await proxy.ReadVerifiedMetadataAsync(cancellationToken);
            await proxy.StartLoopbackAsync(cancellationToken);
            return proxy;
        }
        catch
        {
            await proxy.DisposeAsync();
            throw;
        }
    }

    private async Task<HttpResponseMessage> SendHubAsync(
        HttpMethod method, string? exactRange, CancellationToken cancellationToken)
    {
        var request = new HttpRequestMessage(method,
            "https://blofyplayer.com/api/v1/private-device-qa/playback/" + _runId);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _ticket);
        request.Headers.TryAddWithoutValidation("User-Agent", "BLOFY-Windows-OwnerDeviceQA/1");
        if (exactRange is not null)
            request.Headers.TryAddWithoutValidation("Range", exactRange);
        using (request)
        using (var headersTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
        {
            headersTimeout.CancelAfter(TimeSpan.FromSeconds(25));
            return await _client.SendAsync(request,
                HttpCompletionOption.ResponseHeadersRead,
                headersTimeout.Token).ConfigureAwait(false);
        }
    }

    private async Task ReadVerifiedMetadataAsync(CancellationToken cancellationToken)
    {
        using var response = await SendHubAsync(HttpMethod.Head, null, cancellationToken);
        if (response.StatusCode != HttpStatusCode.OK)
            throw new InvalidOperationException("Private Content Hub episode is unavailable or ticket expired");
        var length = response.Content.Headers.ContentLength;
        var type = response.Content.Headers.ContentType?.MediaType ?? "";
        if (length is null or <= 0 or > MaximumMediaBytes ||
            type is not ("video/mp4" or "video/x-matroska" or "video/mp2t" or "video/x-msvideo"))
            throw new InvalidOperationException("Private Content Hub media metadata is not supported");
        _length = length.Value;
        _type = type;
    }

    private async Task StartLoopbackAsync(CancellationToken cancellationToken)
    {
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions
        {
            Args = [],
            EnvironmentName = "Production"
        });
        builder.WebHost.UseKestrel(options => options.Listen(IPAddress.Loopback, 0));
        var app = builder.Build();
        app.MapMethods("/{key}/episode/{file}", ["HEAD", "GET"],
            async (HttpContext context, string key, string file) =>
            {
                if (key != _secret || file != LocalName())
                {
                    context.Response.StatusCode = 404;
                    return;
                }
                if (!await _connections.WaitAsync(
                    TimeSpan.FromSeconds(10), context.RequestAborted))
                {
                    context.Response.StatusCode = 429;
                    return;
                }
                try { await ServeAsync(context); }
                catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
                catch (Exception)
                {
                    if (!context.Response.HasStarted)
                        context.Response.StatusCode = 502;
                    else context.Abort();
                }
                finally { _connections.Release(); }
            });
        try
        {
            await app.StartAsync(cancellationToken);
            var addresses = app.Services.GetRequiredService<IServer>()
                .Features.Get<IServerAddressesFeature>()?.Addresses;
            var url = addresses?.FirstOrDefault(
                a => a.StartsWith("http://127.0.0.1:", StringComparison.Ordinal));
            if (url is null) throw new InvalidOperationException("Owner QA loopback did not bind");
            PlaybackUrl = url.TrimEnd('/') + "/" + _secret +
                "/episode/" + LocalName();
            _app = app;
        }
        catch
        {
            await app.DisposeAsync();
            throw;
        }
    }

    private string LocalName() => _type switch
    {
        "video/mp4" => "verified.mp4",
        "video/x-matroska" => "verified.mkv",
        "video/mp2t" => "verified.ts",
        _ => "verified.avi"
    };

    private bool TryRange(string? raw, out long first, out long last, out bool partial)
    {
        first = 0;
        last = _length - 1;
        partial = false;
        if (string.IsNullOrEmpty(raw)) return true; // VLC plain GET, stream from Hub in <=8MiB slices
        var m = Regex.Match(raw, @"^bytes=(\d+)-(\d*)$");
        if (!m.Success || !long.TryParse(m.Groups[1].Value, out first) ||
            first < 0 || first >= _length) return false;
        if (m.Groups[2].Length > 0 &&
            (!long.TryParse(m.Groups[2].Value, out last) || last >= _length ||
             last < first)) return false;
        partial = true;
        return true;
    }

    private async Task ServeAsync(HttpContext ctx)
    {
        var raw = ctx.Request.Headers.Range.ToString();
        if (!TryRange(raw, out var first, out var last, out var partial))
        {
            ctx.Response.StatusCode = StatusCodes.Status416RangeNotSatisfiable;
            ctx.Response.Headers.ContentRange = "bytes */" + _length;
            return;
        }

        ctx.Response.StatusCode = partial ? 206 : 200;
        ctx.Response.ContentType = _type;
        ctx.Response.ContentLength = last - first + 1;
        ctx.Response.Headers.AcceptRanges = "bytes";
        ctx.Response.Headers.CacheControl = "private, no-store";
        ctx.Response.Headers.XContentTypeOptions = "nosniff";
        if (partial)
            ctx.Response.Headers.ContentRange = $"bytes {first}-{last}/{_length}";
        if (ctx.Request.Method == "HEAD") return;

        // Multiple small verified S3-origin reads, never an unbounded
        // GET to the private server. Seek and cancellation remain native.
        for (long offset = first; offset <= last;)
        {
            var end = Math.Min(last, offset + ChunkLimit - 1);
            using var response = await SendHubAsync(HttpMethod.Get,
                $"bytes={offset}-{end}", ctx.RequestAborted);
            var range = response.Content.Headers.ContentRange;
            var count = end - offset + 1;
            if (response.StatusCode != HttpStatusCode.PartialContent ||
                range?.From != offset || range?.To != end ||
                range.Length != _length ||
                response.Content.Headers.ContentLength != count ||
                response.Content.Headers.ContentType?.MediaType != _type)
                throw new InvalidOperationException("Private device QA Range proof failed");

            await using var source = await response.Content.ReadAsStreamAsync(ctx.RequestAborted);
            var pool = ArrayPool<byte>.Shared.Rent(64 * 1024);
            try
            {
                long remaining = count;
                while (remaining > 0)
                {
                    using var idle = CancellationTokenSource.CreateLinkedTokenSource(
                        ctx.RequestAborted);
                    idle.CancelAfter(TimeSpan.FromMinutes(2));
                    var read = await source.ReadAsync(
                        pool.AsMemory(0, (int)Math.Min(pool.Length, remaining)),
                        idle.Token);
                    if (read == 0) throw new EndOfStreamException("Content Hub short read");
                    await ctx.Response.Body.WriteAsync(pool.AsMemory(0, read),
                        ctx.RequestAborted);
                    remaining -= read;
                }
            }
            finally { ArrayPool<byte>.Shared.Return(pool); }
            offset = end + 1;
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_app is not null)
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            try { await _app.StopAsync(timeout.Token); } catch { }
            await _app.DisposeAsync();
            _app = null;
        }
        PlaybackUrl = "";
        _connections.Dispose();
        _client.Dispose();
    }
}
#endif
