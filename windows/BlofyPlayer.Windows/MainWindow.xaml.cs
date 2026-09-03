using System.Collections.ObjectModel;
using System.Net.Http;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using LibVLCSharp.Shared;

namespace BlofyPlayer.Windows;

public partial class MainWindow : Window
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(25) };
    private readonly LibVLC _libVlc;
    private readonly MediaPlayer _player;
    private readonly ObservableCollection<XtreamRow> _categories = new();
    private readonly ObservableCollection<XtreamRow> _items = new();
    private string _baseUrl = "";
    private string _username = "";
    private string _password = "";
    private string _kind = "live";

    public MainWindow()
    {
        InitializeComponent();
        _libVlc = new LibVLC("--network-caching=800", "--file-caching=300", "--avcodec-hw=any");
        _player = new MediaPlayer(_libVlc);
        VideoView.MediaPlayer = _player;
        CategoryList.ItemsSource = _categories;
        ItemList.ItemsSource = _items;
        Loaded += (_, _) => LoadSavedConnection();
        Closed += (_, _) => { _player.Dispose(); _libVlc.Dispose(); _http.Dispose(); };
    }

    private void LoadSavedConnection()
    {
        var settings = ConnectionStore.Load();
        if (settings is null) return;
        ServerBox.Text = settings.BaseUrl;
        UsernameBox.Text = settings.Username;
        PasswordBox.Password = settings.Password;
    }

    private async void Connect_Click(object sender, RoutedEventArgs e)
    {
        _baseUrl = ServerBox.Text.Trim().TrimEnd('/');
        _username = UsernameBox.Text.Trim();
        _password = PasswordBox.Password;
        if (!_baseUrl.StartsWith("http", StringComparison.OrdinalIgnoreCase) || string.IsNullOrWhiteSpace(_username) || string.IsNullOrWhiteSpace(_password))
        {
            StatusText.Text = "تأكد من رابط السيرفر واسم المستخدم وكلمة المرور";
            return;
        }
        try
        {
            StatusText.Text = "جاري التحقق من السيرفر...";
            var authUrl = Api("", false);
            using var response = await _http.GetAsync(authUrl);
            response.EnsureSuccessStatusCode();
            var body = await response.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(body);
            if (!doc.RootElement.TryGetProperty("user_info", out var userInfo)) throw new Exception("رد السيرفر غير صالح");
            if (userInfo.TryGetProperty("auth", out var auth) && auth.ToString() != "1") throw new Exception("بيانات الدخول غير صحيحة");
            ConnectionStore.Save(new ConnectionSettings(_baseUrl, _username, _password));
            LoginPanel.Visibility = Visibility.Collapsed;
            BrowserPanel.Visibility = Visibility.Visible;
            await LoadKindAsync("live");
            StatusText.Text = "متصل • BLOFY Windows";
        }
        catch (Exception ex)
        {
            StatusText.Text = "تعذر الاتصال: " + ex.Message;
        }
    }

    private async Task LoadKindAsync(string kind)
    {
        _kind = kind;
        SectionTitle.Text = kind switch { "movie" => "الأفلام", "series" => "المسلسلات", _ => "البث المباشر" };
        _player.Stop();
        _items.Clear();
        _categories.Clear();
        StatusText.Text = "جاري تحميل الفئات...";
        var action = kind switch { "movie" => "get_vod_categories", "series" => "get_series_categories", _ => "get_live_categories" };
        var rows = await GetRowsAsync(Api(action));
        _categories.Add(new XtreamRow("__all__", "الكل"));
        foreach (var row in rows)
        {
            var id = row.String("category_id");
            var name = row.String("category_name");
            if (!string.IsNullOrWhiteSpace(id) && !string.IsNullOrWhiteSpace(name)) _categories.Add(new XtreamRow(id, name));
        }
        CategoryList.SelectedIndex = 0;
        StatusText.Text = $"{_categories.Count - 1} فئة";
    }

    private async void CategoryList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (CategoryList.SelectedItem is not XtreamRow category || string.IsNullOrWhiteSpace(_baseUrl)) return;
        try
        {
            StatusText.Text = "جاري تحميل المحتوى...";
            _items.Clear();
            var action = _kind switch { "movie" => "get_vod_streams", "series" => "get_series", _ => "get_live_streams" };
            var rows = await GetRowsAsync(Api(action));
            foreach (var row in rows)
            {
                var idKey = _kind == "series" ? "series_id" : "stream_id";
                var id = row.String(idKey);
                var name = row.String("name");
                var categoryId = row.String("category_id");
                if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(name)) continue;
                if (category.Id != "__all__" && categoryId != category.Id) continue;
                var ext = row.String("container_extension") ?? (_kind == "live" ? "ts" : "mp4");
                _items.Add(new XtreamRow(id, name, ext));
            }
            StatusText.Text = $"{_items.Count} عنصر";
        }
        catch (Exception ex)
        {
            StatusText.Text = "تعذر تحميل القسم: " + ex.Message;
        }
    }

    private void ItemList_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (ItemList.SelectedItem is not XtreamRow item) return;
        if (_kind == "series")
        {
            StatusText.Text = "المسلسلات: اختيار الحلقات سيكون في التحديث التالي للنسخة التجريبية";
            return;
        }
        var path = _kind == "movie"
            ? $"movie/{Uri.EscapeDataString(_username)}/{Uri.EscapeDataString(_password)}/{item.Id}.{item.Extension}"
            : $"live/{Uri.EscapeDataString(_username)}/{Uri.EscapeDataString(_password)}/{item.Id}.{item.Extension}";
        var url = $"{_baseUrl}/{path}";
        using var media = new Media(_libVlc, new Uri(url));
        _player.Play(media);
        StatusText.Text = "تشغيل • " + item.Name;
    }

    private async Task<List<JsonElement>> GetRowsAsync(string url)
    {
        using var response = await _http.GetAsync(url);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync();
        var doc = await JsonDocument.ParseAsync(stream);
        return doc.RootElement.ValueKind == JsonValueKind.Array ? doc.RootElement.EnumerateArray().Select(x => x.Clone()).ToList() : new List<JsonElement>();
    }

    private string Api(string action, bool includeAction = true)
    {
        var url = $"{_baseUrl}/player_api.php?username={Uri.EscapeDataString(_username)}&password={Uri.EscapeDataString(_password)}";
        return includeAction && !string.IsNullOrWhiteSpace(action) ? url + "&action=" + Uri.EscapeDataString(action) : url;
    }

    private async void LiveNav_Click(object sender, RoutedEventArgs e) => await LoadKindAsync("live");
    private async void MoviesNav_Click(object sender, RoutedEventArgs e) => await LoadKindAsync("movie");
    private async void SeriesNav_Click(object sender, RoutedEventArgs e) => await LoadKindAsync("series");
    private async void Refresh_Click(object sender, RoutedEventArgs e) => await LoadKindAsync(_kind);
    private void ShowLogin_Click(object sender, RoutedEventArgs e) { BrowserPanel.Visibility = Visibility.Collapsed; LoginPanel.Visibility = Visibility.Visible; SectionTitle.Text = "إعدادات الاتصال"; }
}

internal record XtreamRow(string Id, string Name, string Extension = "ts")
{
    public override string ToString() => Name;
}

internal static class JsonExtensions
{
    public static string? String(this JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value)) return null;
        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.ToString(),
            _ => null
        };
    }
}
