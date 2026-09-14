using Blofy.Windows.Runtime;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

var checks = new List<string>();
void Check(bool value, string description) { if (!value) throw new Exception(description); checks.Add(description); }
async Task Reject(Func<Task> operation, string description) { bool failed = false; try { await operation(); } catch { failed = true; } Check(failed, description); }
string temp = Path.Combine(Path.GetTempPath(), "blofy-tests-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(temp);
try
{
    using var vault = new SecretVault(RandomNumberGenerator.GetBytes(32));
    string sealedText = vault.Seal("سر / private-user-password");
    Check(vault.Open(sealedText) == "سر / private-user-password", "Encrypted records round trip Unicode");
    Check(!sealedText.Contains("private-user-password"), "Stored records do not contain cleartext credentials");
    Check(vault.Seal("same") != vault.Seal("same"), "Every encryption uses a new nonce");
    var corrupt = Convert.FromBase64String(sealedText); corrupt[^1] ^= 1;
    await Reject(() => Task.FromResult(vault.Open(Convert.ToBase64String(corrupt))), "Tampering fails AES-GCM authentication");
    var users = new UserStore(temp, vault); string id = users.Data.Identity.DeviceId;
    Check(System.Text.RegularExpressions.Regex.IsMatch(id, "^BLOFY-[A-Z0-9]{4}-[A-Z0-9]{4}$"), "Device ID follows the Android display format");
    Check(users.Data.Identity.Code.Length == 6 && users.Data.Identity.TrialScope.Length == 64, "Identity contains a six-digit code and a trial-scope hash");
    Check(new UserStore(temp, vault).Data.Identity == users.Data.Identity, "Restart preserves the full identity rather than creating another trial");
    var provider = Urls.Input("Test", "http://localhost:45678/prefix/get.php?username=a%2Fb&password=p%26q&type=m3u_plus", "", "", false);
    Check(provider.Url == "http://localhost:45678/prefix" && provider.Username == "a/b" && provider.Password == "p&q", "Xtream URL import preserves port, base path and decoded credentials");
    Check(Urls.Api(provider, "get_vod_streams").AbsoluteUri.Contains("password=p%26q"), "API query credentials are encoded");
    Check(Urls.Stream(provider, new("1", "test", "movie", Extension: "mkv")).AbsoluteUri.Contains("/movie/a%2Fb/p%26q/1.mkv"), "Movie URL encodes path segments and keeps container extension");
    Check(Urls.Stream(provider, new("2", "test", "episode", Extension: "mp4")).AbsolutePath.Contains("/series/"), "Episode URLs use the series path");
    Check(Urls.Stream(provider, new("2", "test", "live"), "m3u8").AbsolutePath.EndsWith("2.m3u8"), "Live format selection builds HLS URLs");
    await Reject(() => Task.FromResult(Urls.Http("file:///C:/Windows/win.ini")), "File URLs are rejected for server input");
    await Reject(() => Task.FromResult(Urls.Http("http://user:pass@host/a")), "Embedded authority credentials are rejected");
    await Reject(() => Task.FromResult(Urls.Header("agent\r\nX-Injection: true")), "Header line-break injection is rejected");
    await Reject(() => Task.FromResult(Urls.Stream(provider, new("s", "series", "series"))), "A series cannot start until an episode is selected");
    var portalUri = new Uri(Urls.Portal("https://example.com/api/stale?x=1", users.Data.Identity));
    Check(portalUri.AbsolutePath == "/" && portalUri.Query.Length == 0 && portalUri.Fragment.Contains("code="), "QR credentials are in the URL fragment, not requests or query logs");
    long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    Check(new Entitlement("active", null, now).Allowed, "Server-confirmed lifetime activation is accepted");
    Check(new Entitlement("trial", now + 60000, now).Allowed, "Unexpired server-confirmed trial is accepted");
    Check(!new Entitlement("trial", now - 1, now).Allowed, "Expired trials are rejected");
    Check(!new Entitlement("blocked", null, now).Allowed && !new Entitlement("unknown", null, now).Allowed, "Blocked or unknown activation never unlocks playback");
    var m3u = new List<Entry>();
    await foreach (var e in ProviderClient.ParseM3u(new StringReader("\uFEFF#EXTM3U\n#EXTINF:-1 tvg-logo=\"poster.png\" group-title=\"العربية, أفلام\",فيلم أول\nvideo.mp4\n#EXTINF:-1 group-title=\"قنوات\",قناة\nhttp://localhost/live/1.ts\n"), new Uri("http://localhost/playlist/list.m3u"))) m3u.Add(e);
    Check(m3u.Count == 2 && m3u[0].Name == "فيلم أول", "M3U parser accepts BOM and Arabic names");
    Check(m3u[0].Category == "العربية, أفلام", "Quoted attribute commas do not split the M3U title");
    Check(m3u[0].Url == "http://localhost/playlist/video.mp4" && m3u[0].Image.EndsWith("/playlist/poster.png"), "Relative media and artwork links resolve against the response URL");
    Check(m3u[0].Kind == "movie" && m3u[1].Kind == "live", "M3U direct movies and live entries remain playable");
    await Reject(async () => { await foreach (var e in ProviderClient.ParseM3u(new StringReader("<html>bad</html>"), new Uri("http://localhost/"))) { } }, "HTML error pages are rejected as playlists");
    using var detailDoc = JsonDocument.Parse("""{"info":{"plot":"plot","cast":"actor","director":"director","rating":8.2},"episodes":{"2":[{"id":20,"episode_num":10,"container_extension":"mkv"},{"id":12,"episode_num":2}],"1":[{"id":1,"episode_num":1}]}}""");
    var detail = ProviderClient.ParseDetails(new("9", "Series", "series"), detailDoc.RootElement);
    Check(detail.Episodes.Select(e => e.Entry.Id).SequenceEqual(new[] { "1", "12", "20" }), "Seasons and episodes sort numerically ascending");
    Check(detail.Cast == "actor" && detail.Director == "director" && detail.Rating == "8.2", "Details preserve provider metadata");
    var handler = new FixtureHandler(); using var client = new ProviderClient(handler); var store = new CatalogStore(Path.Combine(temp, "catalog.sqlite"), vault);
    provider = new Provider("provider-a", "A", "xtream", "http://fixture.local", "u", "p"); users.Put(provider);
    Check(!File.ReadAllText(Path.Combine(temp, "profile.enc")).Contains("fixture.local"), "Provider credentials and endpoints are encrypted on disk");
    await store.Import(provider, client, null, CancellationToken.None);
    Check(await store.Ready(provider), "Successful import publishes a usable generation");
    var movies = await store.Read(provider, "movie", limit: 100);
    Check(movies.Total == 231 && movies.Items.Count == 100, "Catalog uses paged reads without truncating total count");
    Check(movies.Items[0].Id == "0" && movies.Items[99].Id == "99", "Provider item order is retained");
    Check((await store.Read(provider, "movie", offset: 200, limit: 100)).Items.Count == 31, "Last catalog page returns the remaining items");
    Check((await store.Categories(provider, "movie")).Select(x => x.Id).SequenceEqual(new[] { "9", "2" }), "Category order is not sorted by numeric ID");
    Check((await store.Read(provider, "movie", category: "9")).Total == 116, "Category filters use the selected provider and group");
    Check((await store.Read(provider, "movie", search: "video 22")).Total == 11, "Search returns prefix matches from the first typed characters");
    Check((await store.Read(provider, "movie", search: "' OR 1=1 --")).Total == 0, "Search terms are SQL parameters rather than interpolated commands");
    handler.FailKind = "movie";
    await Reject(() => store.Import(provider, client, null, CancellationToken.None), "A failed section prevents publishing a partial refresh");
    Check((await store.Read(provider, "movie")).Total == 231, "Failed refresh keeps the previous complete catalog");
    handler.FailKind = ""; handler.EmptyKind = "series";
    await Reject(() => store.Import(provider, client, null, CancellationToken.None), "A previously nonempty section cannot silently disappear");
    Check((await store.Read(provider, "series")).Total == 1, "Missing-section rejection retains the old series list");
    handler.EmptyKind = ""; handler.Delay = true;
    using (var cancel = new CancellationTokenSource(50)) await Reject(() => store.Import(provider, client, null, cancel.Token), "Cancellation interrupts a refresh");
    handler.Delay = false;
    Check(await store.Ready(provider) && (await store.Read(provider, "movie")).Total == 231, "Cancellation does not damage the active catalog");
    Check(!await store.Ready(provider with { Password = "changed" }), "Changed credentials cannot reuse an unrelated catalog fingerprint");
    Check((await store.Read(provider with { Id = "provider-b" }, "movie")).Total == 0, "A different provider cannot see another provider's catalog");
    var item = movies.Items[0]; await store.SaveWatch(provider, item, 45000, 120000, true);
    Check((await store.WatchState(provider, item)) is { Position: 45000, Favorite: true }, "Favorites and resume position persist");
    await store.SaveWatch(provider, item, 55000, 120000);
    Check((await store.WatchState(provider, item)) is { Position: 55000, Favorite: true }, "Saving playback progress preserves favorite state");
    Check((await store.Library(provider, "continue")).Count == 1 && (await store.Library(provider, "favorites")).Count == 1, "Continue and favorites library queries return saved entries");
    Check(await store.WatchState(provider with { Password = "changed" }, item) == null, "A changed server identity does not inherit another catalog's resume point");
    var fromPortal = provider with { Url = "http://unrelated.example", FromPortal = true };
    Check(users.MergePortal(new[] { fromPortal }) == 0 && users.Data.Providers[0].Url == provider.Url, "Portal sync cannot overwrite an explicitly local playlist");
    using var portal = new PortalClient("https://fixture.local", new FixtureHandler());
    Check((await portal.Check(users.Data.Identity, CancellationToken.None)).Allowed, "Activation client accepts a real-shaped API response");
    Check((await portal.Playlists(users.Data.Identity, CancellationToken.None)).Count == 1, "Portal playlist endpoint is parsed with credentials scoped to the device");
    File.WriteAllText(Path.Combine(temp, "profile.enc"), "corrupt");
    await Reject(() => Task.FromResult(new UserStore(temp, vault)), "A corrupted profile does not silently reset device identity");
    var result = new { passed = true, checks = checks.ToArray(), scope = "Core integration: HTTP handler fixture, actual SQLite and encryption; no production providers" };
    Console.WriteLine(JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
    string output = args.FirstOrDefault() ?? "core-verification.json"; File.WriteAllText(output, JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
}
catch (Exception ex) { Console.Error.WriteLine(ex); Environment.ExitCode = 1; }
finally { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); try { Directory.Delete(temp, true); } catch { } }

sealed class FixtureHandler : HttpMessageHandler
{
    public string FailKind = "", EmptyKind = ""; public bool Delay;
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        if (Delay) await Task.Delay(5000, ct);
        var path = request.RequestUri!.AbsolutePath; var q = Urls.Query(request.RequestUri.Query); var action = q.GetValueOrDefault("action", "");
        string kind = action.Contains("vod") ? "movie" : action.Contains("series") ? "series" : "live";
        object result;
        if (path.EndsWith("activation/check")) result = new { status = "active", expiresAt = (long?)null, serverTime = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
        else if (path.EndsWith("playlists/list")) result = new { items = new[] { new { id = "remote", name = "Remote", providerType = "xtream", baseUrl = "http://fixture.local", username = "u", password = "p" } } };
        else if (action == "") result = new { user_info = new { auth = 1, status = "Active" } };
        else if (kind == FailKind) return new HttpResponseMessage(HttpStatusCode.BadGateway);
        else if (action.EndsWith("categories")) result = new[] { new { category_id = "9", category_name = "First" }, new { category_id = "2", category_name = "Second" } };
        else if (kind == EmptyKind) result = Array.Empty<object>();
        else if (kind == "series") result = new[] { new { series_id = 1, name = "Series", category_id = "9", cover = "" } };
        else result = Enumerable.Range(0, kind == "movie" ? 231 : 5).Select(i => new { stream_id = i, name = "video " + i, category_id = i % 2 == 0 ? "9" : "2", stream_icon = "http://fixture.local/poster?secret=private", container_extension = "mp4", rating = "8.2" }).ToArray();
        return new HttpResponseMessage(HttpStatusCode.OK) { RequestMessage = request, Content = new StringContent(JsonSerializer.Serialize(result), Encoding.UTF8, "application/json") };
    }
}
