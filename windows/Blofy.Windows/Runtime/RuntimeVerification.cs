using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.IO.Compression;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using System.Windows.Interop;
using System.Runtime.InteropServices;

namespace Blofy.Windows.Runtime;

internal static class RuntimeVerification
{
    public static async Task Run(string evidence)
    {
        Directory.CreateDirectory(evidence); string data = Path.Combine(Path.GetTempPath(), "BLOFY-Runtime-QA-" + Guid.NewGuid().ToString("N"));
        await using var fixture = new RuntimeFixture(); await fixture.Start();
        var services = new RuntimeServices(data, fixture.Origin); services.Users.Data.Preferences = new(Hardware: false); services.Users.Save();
        var window = new RuntimeWindow(services); Application.Current.MainWindow = window; Application.Current.ShutdownMode = ShutdownMode.OnExplicitShutdown;
        var checks = new List<string>();
        void Check(bool condition, string message) { if (!condition) throw new InvalidOperationException(message + " | " + window.StatusText); checks.Add(message); }
        async Task Wait(Func<bool> predicate, string message, int milliseconds = 20000)
        {
            var until = DateTime.UtcNow.AddMilliseconds(milliseconds);
            while (!predicate() && DateTime.UtcNow < until) await Task.Delay(100);
            Check(predicate(), message);
        }
        try
        {
            window.Show(); await window.Dispatcher.InvokeAsync(window.UpdateLayout, DispatcherPriority.ApplicationIdle);
            await window.InitializeAsync();
            Check(window.Route == "login" && window.Login.QrImage is BitmapSource { PixelWidth: > 100 }, "Real login initializes a stable device identity and QR code");
            Check(window.Login.Status.Contains("مفعّل"), "Activation status is supplied by the loopback API, not a fixed UI label");
            Check(fixture.LastPlatform == "windows" && fixture.LastScopeLength == 64, "Windows activation sends platform and hashed trial scope using the existing API contract");
            Check(window.Login.Playlists.Count == 1, "Device-scoped portal playlists appear on login");
            Capture(window, Path.Combine(evidence, "runtime-login.png"));
            var provider = services.Users.Active!; await window.ConnectAsync(provider);
            Check(window.Route == "home" && window.Active?.Id == provider.Id, "Connect imports the real HTTP fixture and opens the Android-layout home");
            Check(await services.Catalog.Ready(provider), "Catalog is persisted before activating the provider");
            Capture(window, Path.Combine(evidence, "runtime-home.png"));
            await window.Navigate("movie");
            Check(window.CurrentCatalog is { Total: 151 } vm && vm.Entries.Count == 100, "Movie screen loads a real SQL-backed first page with the correct total");
            await window.LoadMoreAsync();
            Check(window.CurrentCatalog!.Entries.Count == 151, "Catalog scrolling can load beyond the first page");
            var movie = window.CurrentCatalog.Entries[0]; await window.OpenAsync(movie);
            await window.Dispatcher.InvokeAsync(window.UpdateLayout, DispatcherPriority.ApplicationIdle);
            Check(window.Route == "details" && window.Playback.Current == null, "Opening movie details does not autoplay");
            Check(MainWindow.Visuals<TextBlock>(window).Any(t => t.Text.Contains("Fixture Actor")), "Provider cast metadata reaches the actual details screen");
            Capture(window, Path.Combine(evidence, "runtime-details.png"));
            var play = MainWindow.Visuals<Button>(window).First(b => b.Content is string s && s.Contains("شاهد الآن"));
            play.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
            await Wait(() => window.IsFullscreen && window.Playback.Player is { IsPlaying: true, VoutCount: > 0 }, "Movie button decodes H.264 video through native LibVLC in fullscreen");
            await Wait(() => window.Playback.Video.IsLoaded && window.Playback.Player!.Hwnd != IntPtr.Zero && IsChild(new WindowInteropHelper(window).Handle, window.Playback.Player.Hwnd), "Native movie output is attached inside the BLOFY window rather than a separate VLC window");
            Check(window.Playback.Player!.TakeSnapshot(0, Path.Combine(evidence, "decoded-movie.png"), 0, 0), "Native player produces a decoded-frame snapshot");
            await Wait(() => File.Exists(Path.Combine(evidence, "decoded-movie.png")), "Decoded video frame is written to the evidence directory");
            await Task.Delay(1100); await window.ExitFullscreen();
            Check((await services.Catalog.WatchState(provider, movie))?.Position > 0, "Exiting playback persists the measured native playback position");
            await window.Navigate("series"); var series = window.CurrentCatalog!.Entries[0]; await window.OpenAsync(series);
            await window.Dispatcher.InvokeAsync(window.UpdateLayout, DispatcherPriority.ApplicationIdle);
            Check(window.Route == "details", "Series API details open in the real Windows UI");
            var episodeButton = MainWindow.Visuals<Button>(window).First(b => b.Content is string s && s.Contains("الحلقة المحددة")); episodeButton.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
            await Wait(() => window.Playback.Current is { Kind: "episode", Id: "101" } && window.Playback.Player is { IsPlaying: true, VoutCount: > 0 }, "Series button selects the numerically first episode and decodes its video");
            await window.ExitFullscreen(); await window.Navigate("live");
            await Wait(() => window.Playback.Current?.Kind == "live" && window.Playback.Player is { IsPlaying: true, VoutCount: > 0 }, "First channel starts a native MPEG-TS preview after categories load");
            Check(window.Playback.Player!.Hwnd != IntPtr.Zero && IsChild(new WindowInteropHelper(window).Handle, window.Playback.Player.Hwnd), "Native live output is attached to the BLOFY preview surface");
            var player = window.Playback.Player; var stream = window.Playback.Current;
            window.EnterFullscreen(); await Task.Delay(350);
            Check(window.IsFullscreen && ReferenceEquals(player, window.Playback.Player) && window.Playback.Current == stream, "Live preview-to-fullscreen reuses one media player and stream session");
            await window.ExitFullscreen();
            Check(!window.IsFullscreen && window.Playback.Player!.IsPlaying, "Returning to live preview keeps playback running");
            Check(window.Playback.Player.TakeSnapshot(0, Path.Combine(evidence, "decoded-live.png"), 0, 0), "Live MPEG-TS produces a decoded-frame snapshot");
            await window.Playback.Start(provider with { LiveFormat = "m3u8" }, stream!);
            await Wait(() => window.Playback.Player is { IsPlaying: true, VoutCount: > 0 }, "Native player decodes an HTTP HLS playlist and MPEG-TS segment");
            fixture.ActivationStatus = "blocked"; await window.InitializeAsync();
            Check(window.Playback.Current == null && window.Route == "login", "A blocked activation stops playback and returns to login");
            await window.ConnectAsync(provider);
            Check(window.Route == "login" && window.Playback.Current == null, "Blocked activation cannot reconnect or start playback");
            Check(fixture.OutsideRequests == 0, "Runtime verification uses only the isolated loopback fixture and generated media");
            File.WriteAllText(Path.Combine(evidence, "runtime-verification.json"), JsonSerializer.Serialize(new { passed = true, checks, scope = "Real WPF UI, DPAPI, SQLite and native LibVLC: generated H264/MP4, MPEG-TS, HLS over loopback. No production server credentials or live subscription tested. No complete Android pixel-parity claim." }, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception ex)
        {
            File.WriteAllText(Path.Combine(evidence, "runtime-verification.json"), JsonSerializer.Serialize(new { passed = false, checks, error = ex.ToString(), status = window.StatusText }, new JsonSerializerOptions { WriteIndented = true }));
            try { Capture(window, Path.Combine(evidence, "failure.png")); } catch { }
            throw;
        }
        finally
        {
            await window.ShutdownForVerification(); Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); try { Directory.Delete(data, true); } catch { }
        }
    }
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsChild(IntPtr parent, IntPtr child);

    private static void Capture(Window window, string path)
    {
        window.UpdateLayout(); var bitmap = new RenderTargetBitmap((int)window.ActualWidth, (int)window.ActualHeight, 96, 96, PixelFormats.Pbgra32); bitmap.Render(window);
        var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap)); using var stream = File.Create(path); encoder.Save(stream);
    }
}

internal sealed class RuntimeFixture : IAsyncDisposable
{
    private readonly HttpListener _listener = new();
    private readonly CancellationTokenSource _stop = new();
    private Task? _loop;
    public string Origin { get; private set; } = "";
    public string ActivationStatus = "active";
    public string LastPlatform = "";
    public int LastScopeLength;
    public int OutsideRequests;
    private readonly byte[] _mp4 = Decode("Fixture.Mp4");
    private readonly byte[] _ts = Decode("Fixture.Ts");
    public Task Start()
    {
        var socket = new TcpListener(IPAddress.Loopback, 0); socket.Start(); int port = ((IPEndPoint)socket.LocalEndpoint).Port; socket.Stop();
        Origin = $"http://127.0.0.1:{port}"; _listener.Prefixes.Add(Origin + "/"); _listener.Start();
        _loop = Task.Run(async () =>
        {
            while (!_stop.IsCancellationRequested)
            {
                HttpListenerContext context; try { context = await _listener.GetContextAsync().WaitAsync(_stop.Token); } catch { break; }
                _ = Handle(context);
            }
        }); return Task.CompletedTask;
    }
    private async Task Handle(HttpListenerContext context)
    {
        try
        {
            var request = context.Request; var path = request.Url!.AbsolutePath; object? result = null;
            if (!IPAddress.IsLoopback(request.RemoteEndPoint.Address)) { OutsideRequests++; context.Response.StatusCode = 403; return; }
            if (path.EndsWith("activation/check"))
            {
                using var doc = await JsonDocument.ParseAsync(request.InputStream); LastPlatform = doc.RootElement.Str("platform"); LastScopeLength = doc.RootElement.Str("trialScope").Length;
                result = new { status = ActivationStatus, expiresAt = (long?)null, serverTime = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
            }
            else if (path.EndsWith("playlists/list")) result = new { items = new[] { new { id = "fixture-provider", name = "QA Provider", providerType = "xtream", baseUrl = Origin, username = "u", password = "p", active = true } } };
            else if (path.EndsWith("player_api.php"))
            {
                var query = Urls.Query(request.Url.Query); string action = query.GetValueOrDefault("action", "");
                result = action switch
                {
                    "" => new { user_info = new { auth = 1, status = "Active" } },
                    "get_live_categories" or "get_vod_categories" or "get_series_categories" => new[] { new { category_id = "9", category_name = "فئة اختبار" } },
                    "get_live_streams" => new[] { new { stream_id = 1, name = "بث اختبار محلي", category_id = "9", stream_icon = "" } },
                    "get_vod_streams" => Enumerable.Range(1, 151).Select(i => new { stream_id = i, name = "فيلم اختبار " + i, category_id = "9", container_extension = "mp4", rating = "8.2", stream_icon = "" }).ToArray(),
                    "get_series" => new[] { new { series_id = 5, name = "مسلسل اختبار", category_id = "9", cover = "" } },
                    "get_vod_info" => new { info = new { plot = "Generated local test video. No production provider data.", cast = "Fixture Actor", director = "Fixture Director", rating = "8.2" }, movie_data = new { container_extension = "mp4" } },
                    "get_series_info" => new { info = new { plot = "اختبار ترتيب المواسم والحلقات" }, episodes = new Dictionary<string, object> { ["2"] = new[] { new { id = 210, title = "الحلقة 10", episode_num = 10, season = 2, container_extension = "mp4" }, new { id = 202, title = "الحلقة 2", episode_num = 2, season = 2, container_extension = "mp4" } }, ["1"] = new[] { new { id = 101, title = "الحلقة 1", episode_num = 1, season = 1, container_extension = "mp4" } } } },
                    "get_short_epg" => new { epg_listings = new[] { new { start = "2026-09-14 12:00:00", title = Convert.ToBase64String(Encoding.UTF8.GetBytes("برنامج اختبار")) } } },
                    _ => Array.Empty<object>()
                };
            }
            else if (path.EndsWith(".m3u8")) { await Bytes(context, Encoding.UTF8.GetBytes("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:30\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:30,\n" + Origin + "/segment.ts\n#EXT-X-ENDLIST\n"), "application/vnd.apple.mpegurl"); return; }
            else if (path.EndsWith(".ts")) { await Bytes(context, _ts, "video/mp2t"); return; }
            else if (path.EndsWith(".mp4")) { await Bytes(context, _mp4, "video/mp4"); return; }
            else { context.Response.StatusCode = 404; return; }
            await Bytes(context, JsonSerializer.SerializeToUtf8Bytes(result), "application/json");
        }
        catch { }
        finally { try { context.Response.Close(); } catch { } }
    }
    private static async Task Bytes(HttpListenerContext c, byte[] bytes, string type)
    {
        int start = 0, end = bytes.Length - 1;
        if (c.Request.Headers["Range"] is { } range && range.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase))
        {
            var parts = range[6..].Split('-', 2); if (int.TryParse(parts[0], out var a)) start = Math.Clamp(a, 0, bytes.Length - 1);
            if (parts.Length > 1 && int.TryParse(parts[1], out var b)) end = Math.Clamp(b, start, bytes.Length - 1);
            c.Response.StatusCode = 206; c.Response.Headers["Content-Range"] = $"bytes {start}-{end}/{bytes.Length}";
        }
        c.Response.ContentType = type; c.Response.Headers["Accept-Ranges"] = "bytes"; c.Response.ContentLength64 = end - start + 1;
        if (c.Request.HttpMethod != "HEAD") await c.Response.OutputStream.WriteAsync(bytes.AsMemory(start, end - start + 1));
    }
    private static byte[] Decode(string value) { using var input = typeof(RuntimeFixture).Assembly.GetManifestResourceStream(value) ?? throw new InvalidDataException("Missing generated test fixture"); using var gzip = new GZipStream(input, CompressionMode.Decompress); using var output = new MemoryStream(); gzip.CopyTo(output); return output.ToArray(); }
    public async ValueTask DisposeAsync() { _stop.Cancel(); _listener.Stop(); if (_loop != null) await _loop; _listener.Close(); _stop.Dispose(); }
}
