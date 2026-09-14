using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace Blofy.Windows;

public sealed class UiCommand(Action<object?> execute, Func<object?, bool>? canExecute = null) : ICommand
{
    public bool CanExecute(object? parameter) => canExecute?.Invoke(parameter) ?? true;
    public void Execute(object? parameter) { if (CanExecute(parameter)) execute(parameter); }
    public event EventHandler? CanExecuteChanged;
    public void Invalidate() => CanExecuteChanged?.Invoke(this, EventArgs.Empty);
}

public abstract class ObservableViewModel : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;
    protected void Changed([CallerMemberName] string? name = null) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

public static class Brand
{
    public const string AndroidReference = "dc0b0c84d7dd5973e8d0426f16793f14b9b06417";
    public static ImageSource Logo { get; } = LoadLogo();
    private static ImageSource LoadLogo()
    {
        var image = new BitmapImage();
        image.BeginInit(); image.UriSource = new Uri("pack://application:,,,/Assets/blofy_logo.png", UriKind.Absolute); image.CacheOption = BitmapCacheOption.OnLoad; image.EndInit(); image.Freeze();
        return image;
    }
}

public sealed record NavEntry(string Key, string Title, string Icon = "", string Subtitle = "");
public sealed record PlaylistTile(string Id, string Name);

/// <summary>UI contract only: no fabricated device identity, QR, activation, or playlist credentials.</summary>
public sealed class LoginViewModel
{
    public ImageSource Logo => Brand.Logo;
    public ImageSource? QrImage => null;
    public string DeviceId => "—";
    public string ActivationCode => "—";
    public string Status => "التفعيل غير مربوط في نسخة مراجعة الواجهات";
    public ObservableCollection<PlaylistTile> Playlists { get; } = [];
    public Visibility EmptyPlaylistsVisibility => Playlists.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    public ICommand RefreshActivationCommand { get; }
    public ICommand ConnectPlaylistCommand { get; }
    public ICommand ConnectActiveCommand { get; }
    public ICommand ManagePlaylistsCommand { get; }
    public LoginViewModel(Action<string> explain)
    {
        RefreshActivationCommand = new UiCommand(_ => explain("ربط خدمة التفعيل لم يُنفذ في هذه المرحلة. لا توجد هوية جهاز أو مدة تجريبية وهمية."));
        ConnectPlaylistCommand = new UiCommand(_ => { }, _ => false);
        ConnectActiveCommand = new UiCommand(_ => { }, _ => false);
        ManagePlaylistsCommand = new UiCommand(_ => explain("هذه نسخة مراجعة واجهات، وليست المشغل الكامل. استخدم F2 لمراجعة الرئيسية، وF3 للأفلام وF4 للمسلسلات. لم تُحفظ أي بيانات سيرفر."));
    }
}

public sealed class HomeViewModel
{
    public ImageSource Logo => Brand.Logo;
    public ICommand NavigateCommand { get; }
    public IReadOnlyList<NavEntry> Navigation { get; } = [
        new("live", "بث مباشر", "◉"), new("movie", "الأفلام", "▣"), new("series", "المسلسلات", "▤"),
        new("favorites", "المفضلة", "♡"), new("search", "بحث", "⌕"), new("settings", "الإعدادات", "⚙")
    ];
    public IReadOnlyList<NavEntry> Stories { get; } = [
        new("live", "البث المباشر", Subtitle: "شاهد الآن"), new("movie", "أحدث الأفلام", Subtitle: "سينما"),
        new("series", "أحدث المسلسلات", Subtitle: "حلقات جديدة"), new("favorites", "المفضلة", Subtitle: "اختياراتك"),
        new("continue", "تابع المشاهدة", Subtitle: "من حيث توقفت")
    ];
    public HomeViewModel(Action<string> navigate) => NavigateCommand = new UiCommand(key => { if (key is string route) navigate(route); });
}

public sealed record CategoryEntry(string Id, string Name);
public sealed record PosterRow(IReadOnlyList<PosterItem> Items);
public sealed class PosterItem
{
    public required string Key { get; init; }
    public required string Title { get; init; }
    public string CategoryId { get; init; } = "";
    public string Metadata { get; init; } = "";
    public string Rating { get; init; } = "";
    public ImageSource? Artwork { get; init; }
    public bool HasRating => !string.IsNullOrWhiteSpace(Rating);
    public string RatingText => HasRating ? "★ " + Rating : "";
    public ICommand OpenCommand { get; set; } = new UiCommand(_ => { }, _ => false);
}

/// <summary>Preserves provider order and groups rows without sorting or starting playback.</summary>
public sealed class CatalogViewModel : ObservableViewModel
{
    public const int Columns = 5;
    public string Kind { get; }
    public string Title => Kind == "series" ? "المسلسلات" : "الأفلام";
    public string CountText => $"{_visibleCount} {(Kind == "series" ? "مسلسل" : "فيلم")}";
    public ObservableCollection<CategoryEntry> Categories { get; } = [];
    public ObservableCollection<PosterRow> Rows { get; } = [];
    private IReadOnlyList<PosterItem> _all = [];
    private CategoryEntry? _selected;
    private int _visibleCount;
    public Action<PosterItem>? OpenRequested { get; set; }
    public CategoryEntry? SelectedCategory
    {
        get => _selected;
        set
        {
            if (Equals(_selected, value)) return;
            _selected = value; Changed(); Rebuild();
        }
    }
    public CatalogViewModel(string kind)
    {
        if (kind is not ("movie" or "series")) throw new ArgumentException("Catalog kind must be movie or series", nameof(kind));
        Kind = kind; SetCatalog([], []);
    }
    public void SetCatalog(IEnumerable<CategoryEntry> categories, IEnumerable<PosterItem> items)
    {
        var selectedId = SelectedCategory?.Id;
        _all = items.ToArray();
        foreach (var item in _all) item.OpenCommand = new UiCommand(_ => OpenRequested?.Invoke(item));
        Categories.Clear();
        Categories.Add(new("__all__", Kind == "series" ? "كل المسلسلات" : "كل الأفلام"));
        foreach (var category in categories) if (category.Id != "__all__") Categories.Add(category);
        _selected = Categories.FirstOrDefault(c => c.Id == selectedId) ?? Categories[0];
        Changed(nameof(SelectedCategory)); Rebuild();
    }
    private void Rebuild()
    {
        var visible = _selected is null || _selected.Id == "__all__" ? _all : _all.Where(i => i.CategoryId == _selected.Id).ToArray();
        _visibleCount = visible.Count;
        Rows.Clear();
        for (var i = 0; i < visible.Count; i += Columns) Rows.Add(new(visible.Skip(i).Take(Columns).ToArray()));
        Changed(nameof(CountText));
    }
}
