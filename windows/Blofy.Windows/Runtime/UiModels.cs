using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using QRCoder;

namespace Blofy.Windows.Runtime;

public sealed class RuntimeServices : IDisposable
{
    public string Directory { get; }
    public SecretVault Vault { get; }
    public UserStore Users { get; }
    public CatalogStore Catalog { get; }
    public ProviderClient Providers { get; }
    public PortalClient Portal { get; }
    public RuntimeServices(string directory, string endpoint = PortalClient.ProductionBase)
    {
        Directory = directory; System.IO.Directory.CreateDirectory(directory);
        Vault = new SecretVault(directory); Users = new UserStore(directory, Vault);
        Catalog = new CatalogStore(Path.Combine(directory, "catalog.sqlite"), Vault);
        Providers = new ProviderClient(); Portal = new PortalClient(endpoint);
    }
    public void Dispose() { Providers.Dispose(); Portal.Dispose(); Vault.Dispose(); }
}

public sealed class RuntimeLogin : ObservableViewModel
{
    public ImageSource Logo => Brand.Logo;
    public ImageSource QrImage { get; }
    public string DeviceId { get; }
    public string ActivationCode { get; }
    public ObservableCollection<Provider> Playlists { get; } = [];
    public Visibility EmptyPlaylistsVisibility => Playlists.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    private string _status = "جاري التحقق من التفعيل...";
    public string Status { get => _status; set { _status = value; Changed(); } }
    public ICommand RefreshActivationCommand { get; }
    public ICommand ConnectPlaylistCommand { get; }
    public ICommand ConnectActiveCommand { get; }
    public ICommand ManagePlaylistsCommand { get; }
    public RuntimeLogin(RuntimeServices services, Action refresh, Action<Provider> connect, Action manage)
    {
        DeviceId = services.Users.Data.Identity.DeviceId; ActivationCode = services.Users.Data.Identity.Code;
        using var generator = new QRCodeGenerator(); using var data = generator.CreateQrCode(services.Portal.PublicUrl(services.Users.Data.Identity), QRCodeGenerator.ECCLevel.Q);
        using var png = new PngByteQRCode(data); QrImage = Artwork.Decode(png.GetGraphic(8), 400);
        RefreshActivationCommand = new UiCommand(_ => refresh());
        ConnectPlaylistCommand = new UiCommand(p => { if (p is Provider selected) connect(selected); });
        ConnectActiveCommand = new UiCommand(_ => { if (services.Users.Active is { } p) connect(p); }, _ => services.Users.Active != null);
        ManagePlaylistsCommand = new UiCommand(_ => manage());
        RefreshList(services.Users.Data.Providers);
    }
    public void RefreshList(IEnumerable<Provider> providers)
    { Playlists.Clear(); foreach (var p in providers) Playlists.Add(p); Changed(nameof(EmptyPlaylistsVisibility)); (ConnectActiveCommand as UiCommand)?.Invalidate(); }
}
public sealed class RuntimePoster : ObservableViewModel
{
    public Entry Entry { get; }
    public string Title => Entry.Name;
    public string Metadata => string.Join("  •  ", new[] { Entry.Year, Entry.Genre }.Where(s => s.Length > 0));
    public bool HasRating => Entry.Rating.Length > 0;
    public string RatingText => "★ " + Entry.Rating;
    private ImageSource? _artwork;
    public ImageSource? Artwork { get => _artwork; set { _artwork = value; Changed(); } }
    public ICommand OpenCommand { get; }
    public RuntimePoster(Entry entry, Action<Entry> open) { Entry = entry; OpenCommand = new UiCommand(_ => open(entry)); }
}
public sealed record RuntimeRow(IReadOnlyList<RuntimePoster> Items);
public sealed class RuntimeCatalog : ObservableViewModel
{
    public string Title { get; }
    public string Kind { get; }
    public int Total { get; private set; }
    public string CountText => Total + (Kind == "series" ? " مسلسل" : Kind == "movie" ? " فيلم" : " عنصر");
    public ObservableCollection<Category> Categories { get; } = [];
    public ObservableCollection<RuntimeRow> Rows { get; } = [];
    public List<Entry> Entries { get; } = [];
    public Action<Category?>? CategoryChanged { get; set; }
    private Category? _category;
    public Category? SelectedCategory { get => _category; set { if (_category == value) return; _category = value; Changed(); CategoryChanged?.Invoke(value); } }
    public RuntimeCatalog(string kind, string title) { Kind = kind; Title = title; }
    public void ResetCategories(IEnumerable<Category> categories)
    {
        Categories.Clear(); Categories.Add(new("__all__", Kind == "series" ? "كل المسلسلات" : Kind == "movie" ? "كل الأفلام" : "الكل", Kind, -1));
        foreach (var c in categories) Categories.Add(c); _category = Categories[0]; Changed(nameof(SelectedCategory));
    }
    public void Replace(CatalogPage page, Action<Entry> open, Artwork artwork, CancellationToken ct)
    { Entries.Clear(); Rows.Clear(); Add(page, open, artwork, ct); }
    public void Add(CatalogPage page, Action<Entry> open, Artwork artwork, CancellationToken ct)
    {
        Total = page.Total; Entries.AddRange(page.Items);
        // Every fetched page is a multiple of five, so appending cannot shift the previous row.
        foreach (var chunk in page.Items.Chunk(5))
        {
            var posters = chunk.Select(e => new RuntimePoster(e, open)).ToArray(); Rows.Add(new(posters));
            foreach (var p in posters) _ = artwork.Fill(p, ct);
        }
        Changed(nameof(CountText));
    }
}

public sealed class Artwork : IDisposable
{
    private readonly HttpClient _http = new(new SocketsHttpHandler { ConnectTimeout = TimeSpan.FromSeconds(5), MaxAutomaticRedirections = 5 }) { Timeout = TimeSpan.FromSeconds(12) };
    private readonly SemaphoreSlim _slots = new(4, 4);
    private readonly Dictionary<string, ImageSource> _cache = new();
    private readonly Queue<string> _order = new();
    public static BitmapSource Decode(byte[] bytes, int pixels = 400)
    {
        using var stream = new MemoryStream(bytes); var image = new BitmapImage(); image.BeginInit(); image.CacheOption = BitmapCacheOption.OnLoad; image.DecodePixelWidth = pixels; image.StreamSource = stream; image.EndInit(); image.Freeze(); return image;
    }
    public async Task<ImageSource?> Load(string url, CancellationToken ct)
    {
        if (url.Length == 0) return null;
        try
        {
            _ = Urls.Http(url); if (_cache.TryGetValue(url, out var cached)) return cached;
            await _slots.WaitAsync(ct);
            try
            {
                if (_cache.TryGetValue(url, out cached)) return cached;
                using var response = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
                if (!response.IsSuccessStatusCode || response.Content.Headers.ContentLength > 8_000_000) return null;
                await using var stream = await response.Content.ReadAsStreamAsync(ct); using var output = new MemoryStream();
                byte[] buffer = new byte[16384]; int count;
                while ((count = await stream.ReadAsync(buffer, ct)) > 0) { if (output.Length + count > 8_000_000) return null; output.Write(buffer, 0, count); }
                var bytes = output.ToArray(); var image = await Task.Run(() => Decode(bytes), ct);
                while (_cache.Count >= 160 && _order.TryDequeue(out var key)) _cache.Remove(key);
                _cache[url] = image; _order.Enqueue(url); return image;
            }
            finally { _slots.Release(); }
        }
        catch { return null; }
    }
    public async Task Fill(RuntimePoster poster, CancellationToken ct) { var image = await Load(poster.Entry.Image, ct); if (!ct.IsCancellationRequested) poster.Artwork = image; }
    public void Dispose() => _http.Dispose();
}
