using System.Text.RegularExpressions;
using BlofyPlayer.Windows.Core;
using BlofyPlayer.Windows.Core.Identity;
using BlofyPlayer.Windows.Core.Playback;
using LibVLCSharp.WPF;
using Microsoft.Win32;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Interop;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace BlofyPlayer.Windows;

public partial class MainWindow : Window
{
    private static readonly SolidColorBrush Bg = Brush("#08060D");
    private static readonly SolidColorBrush Surface = Brush("#241536");
    private static readonly SolidColorBrush Surface2 = Brush("#180F23");
    private static readonly SolidColorBrush Text = Brush("#F3F4F6");
    private static readonly SolidColorBrush Muted = Brush("#C9BCD9");
    private static readonly SolidColorBrush Accent = Brush("#D0B2FF");

    private readonly BlofyIdentity _identity = WindowsDeviceIdentity.Get();
    private readonly ActivationClient _activation = new();
    private readonly PortalService _portal = new();
    private readonly LocalStore _store = new();
    private CatalogCoordinator? _catalog;
    private CatalogViewIndex _viewIndex = CatalogViewIndex.Empty;
    private readonly Dictionary<string, ProviderDetails?> _detailsCache = new(StringComparer.Ordinal);
    private readonly Dictionary<string, List<EpisodeItem>> _episodesCache = new(StringComparer.Ordinal);
    private CancellationTokenSource? _syncCts;
    private CancellationTokenSource? _searchCts;
    private CancellationTokenSource? _homeRenderCts;
    private ActivationCheckResponse? _activationState;
    private ProviderAccount? _activeProvider;
    private PlaybackService? _previewPlayback;
    private int _liveSelectionSerial;
    private CancellationTokenSource? _livePreviewCts;
    private string _currentPage = "home";
    private readonly DispatcherTimer _clockTimer = new() { Interval = TimeSpan.FromSeconds(30) };
    private readonly DispatcherTimer _heroTimer = new() { Interval = TimeSpan.FromSeconds(8) };
    private List<StreamItem> _heroCandidates = [];
    private int _heroIndex;
    private ContentControl? _heroHost;
    private readonly Stack<UIElement> _overlayStack = new();
    private UIElement? _currentOverlay;
    private bool _overlayFullscreen;
    private Rect _overlayRestoreBounds;
    private WindowStyle _overlayRestoreWindowStyle;
    private ResizeMode _overlayRestoreResizeMode;
    private bool _overlayRestoreTopmost;
    private WindowState _overlayRestoreWindowState;
    private Action? _pageBackAction;
    private bool _detailsOpen;
    private readonly Dictionary<string, int> _browserPageByKind = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, string> _browserCategoryByKind = new(StringComparer.OrdinalIgnoreCase);
    private string? _lastFocusedContentKey;
    private TextBox? _activeBrowserSearch;

    public MainWindow()
    {
        InitializeComponent();
        DeviceIdText.Text = _identity.DeviceId;
        _clockTimer.Tick += (_, _) => UpdateHeaderClock();
        _heroTimer.Tick += (_, _) =>
        {
            if (_currentPage != "home" || _heroCandidates.Count < 2 || _heroHost is null) return;

            if (Keyboard.FocusedElement is Button focusedButton &&
                focusedButton.Tag is string focusedKey &&
                focusedKey.Contains(':'))
                return;

            _heroIndex = (_heroIndex + 1) % _heroCandidates.Count;
            _heroHost.Content = BuildAndroidHero(_heroCandidates[_heroIndex]);
        };
        Loaded += async (_, _) =>
        {
            try
            {
                await InitializeAsync();
                UpdateHeaderClock();
                _clockTimer.Start();
            }
            catch (Exception ex)
            {
                App.LogCrash("Startup initialization", ex);
                ProgressText.Text = "تعذر إكمال التهيئة";
                MessageBox.Show(this,
                    "تعذر إكمال تشغيل BLOFY PLAYER. تم حفظ تقرير الخطأ تلقائيًا.\n\n" +
                    ex.Message,
                    "BLOFY PLAYER", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        };
        Closed += (_, _) =>
        {
            _syncCts?.Cancel();
            _searchCts?.Cancel();
            _homeRenderCts?.Cancel();
            _livePreviewCts?.Cancel();
            _clockTimer.Stop();
            _heroTimer.Stop();
            DisposePreview();
            _catalog?.Dispose();
            _activation.Dispose();
            _portal.Dispose();
        };
    }

    private void PushOverlay(UIElement view)
    {
        if (_currentOverlay is not null)
            _overlayStack.Push(_currentOverlay);

        _currentOverlay = view;
        OverlayContent.Content = view;
        OverlayHost.Visibility = Visibility.Visible;
        Dispatcher.BeginInvoke(() => (view as UIElement)?.Focus());
    }

    private void CloseOverlay(UIElement view)
    {
        if (!ReferenceEquals(_currentOverlay, view)) return;

        if (_overlayFullscreen)
            SetOverlayFullscreen(false);

        if (view is IDisposable disposable)
            disposable.Dispose();

        RestorePreviousOverlay();
    }

    private async Task ClosePlayerOverlayAsync(PlayerOverlay player)
    {
        if (_overlayFullscreen)
            SetOverlayFullscreen(false);

        try { await player.DisposeAsync(); } catch { }

        if (ReferenceEquals(_currentOverlay, player))
            RestorePreviousOverlay();
    }

    private void RestorePreviousOverlay()
    {
        OverlayContent.Content = null;
        if (_overlayStack.Count > 0)
        {
            _currentOverlay = _overlayStack.Pop();
            OverlayContent.Content = _currentOverlay;
            OverlayHost.Visibility = Visibility.Visible;
            Dispatcher.BeginInvoke(() => _currentOverlay?.Focus());
        }
        else
        {
            _currentOverlay = null;
            OverlayHost.Visibility = Visibility.Collapsed;
            Focus();
        }
    }

    private Task ShowPlayerOverlayAsync(
        string title,
        string url,
        long resumePositionMs = 0,
        IReadOnlyList<StreamItem>? playlist = null,
        int playlistIndex = -1,
        Func<StreamItem, string>? urlResolver = null,
        Func<StreamItem, IReadOnlyList<string>>? recoveryResolver = null,
        IReadOnlyList<string>? recoveryUrls = null,
        Func<long, long, Task>? savePosition = null,
        Func<StreamItem, Task>? onPlaylistItemChanged = null,
        Func<StreamItem, bool>? favoriteResolver = null,
        Func<StreamItem, CancellationToken, Task<string>>? epgResolver = null,
        Func<Task>? previousAction = null,
        Func<Task>? nextAction = null,
        bool? favorite = null,
        Func<Task<bool>>? toggleFavorite = null,
        Func<Task>? onEnded = null)
    {
        var overlay = new PlayerOverlay(
            title,
            url,
            closeHandler: ClosePlayerOverlayAsync,
            fullscreenHandler: SetOverlayFullscreen,
            resumePositionMs: resumePositionMs,
            playlist: playlist,
            playlistIndex: playlistIndex,
            urlResolver: urlResolver,
            recoveryResolver: recoveryResolver,
            recoveryUrls: recoveryUrls,
            savePosition: savePosition,
            onPlaylistItemChanged: onPlaylistItemChanged,
            favoriteResolver: favoriteResolver,
            epgResolver: epgResolver,
            previousAction: previousAction,
            nextAction: nextAction,
            favorite: favorite,
            toggleFavorite: toggleFavorite,
            settings: _store.State.Settings,
            onEnded: onEnded);

        PushOverlay(overlay);
        return Task.CompletedTask;
    }

    private void SetOverlayFullscreen(bool enabled)
    {
        if (enabled == _overlayFullscreen) return;

        var hwnd = new WindowInteropHelper(this).Handle;
        if (hwnd == IntPtr.Zero) return;

        if (enabled)
        {
            _overlayRestoreBounds = new Rect(Left, Top, ActualWidth, ActualHeight);
            _overlayRestoreWindowState = WindowState;
            _overlayRestoreWindowStyle = WindowStyle;
            _overlayRestoreResizeMode = ResizeMode;
            _overlayRestoreTopmost = Topmost;

            var monitor = MonitorFromWindow(hwnd, 2);
            var info = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
            if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref info)) return;

            WindowState = WindowState.Normal;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
            Topmost = true;

            var width = info.rcMonitor.Right - info.rcMonitor.Left;
            var height = info.rcMonitor.Bottom - info.rcMonitor.Top;
            SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                info.rcMonitor.Left,
                info.rcMonitor.Top,
                width,
                height,
                SWP_FRAMECHANGED | SWP_SHOWWINDOW);

            _overlayFullscreen = true;
        }
        else
        {
            Topmost = _overlayRestoreTopmost;
            WindowStyle = _overlayRestoreWindowStyle;
            ResizeMode = _overlayRestoreResizeMode;
            WindowState = WindowState.Normal;
            Left = _overlayRestoreBounds.Left;
            Top = _overlayRestoreBounds.Top;
            Width = Math.Max(MinWidth, _overlayRestoreBounds.Width);
            Height = Math.Max(MinHeight, _overlayRestoreBounds.Height);
            WindowState = _overlayRestoreWindowState;
            _overlayFullscreen = false;
        }
    }

    private async Task InitializeAsync()
    {
        await _store.LoadAsync();
        _currentPage = NormalizeLastPage(_store.State.Settings.LastPage);
        ApplyTheme();
        UpdateProfileLabel();
        _catalog = new CatalogCoordinator(_store);

        var startupSession = StartupSessionTransfer.Take();
        if (startupSession.Activation is not null)
        {
            _activationState = startupSession.Activation;
            ActivationStatusText.Text = _activationState.Status.ToLowerInvariant() switch
            {
                "active" => ExpiryLabel("مفعّل"),
                "trial" => ExpiryLabel("تجربة"),
                "expired" => "انتهى الاشتراك — جدد من الباركود",
                "blocked" => "الجهاز موقوف",
                _ => _activationState.Message ?? "حالة غير معروفة"
            };
        }
        else
        {
            await CheckActivationAsync();
        }

        if (!startupSession.PortalSynced)
            await SyncPortalAsync();

        _activeProvider = _store.ActiveProvider();
        HeaderServerText.Text = _activeProvider?.Name ?? "BLOFY";
        if (_activeProvider is not null)
        {
            ProgressText.Text = "تحميل الكاش…";
            var cached = StartupCatalogTransfer.Take(_activeProvider.Id);
            if (cached is not null)
                _catalog.AdoptSnapshot(cached);
            else
                cached = await Task.Run(() => _catalog.LoadCachedAsync(_activeProvider));

            if (cached is not null)
            {
                ProgressText.Text = "فهرسة المحتوى…";
                _viewIndex = await Task.Run(() => CatalogViewIndex.Build(cached));
                PageSubtitle.Text = _activeProvider.Name + " • " + cached.Streams.Count.ToString("N0") + " عنصر";
                ProgressText.Text = "جاهز";
                RefreshCurrentPage();
            }

            var cacheAge = cached is null
                ? TimeSpan.MaxValue
                : DateTimeOffset.UtcNow - DateTimeOffset.FromUnixTimeMilliseconds(cached.UpdatedAt);
            if (_activationState?.CanUse() == true && (cached is null || cacheAge > TimeSpan.FromHours(6)))
                _ = SyncCatalogAsync(false);
        }
        else RefreshCurrentPage();
    }

    private async Task CheckActivationAsync()
    {
        ActivationStatusText.Text = "جاري التحقق من التفعيل…";
        try
        {
            _activationState = await _activation.CheckAsync(_identity);
            if (_activationState is null)
            {
                ActivationStatusText.Text = "تعذر التحقق من التفعيل";
                return;
            }

            ActivationStatusText.Text = _activationState.Status.ToLowerInvariant() switch
            {
                "active" => ExpiryLabel("مفعّل"),
                "trial" => ExpiryLabel("تجربة"),
                "expired" => "انتهى الاشتراك — جدد من الباركود",
                "blocked" => "الجهاز موقوف",
                _ => _activationState.Message ?? "حالة غير معروفة"
            };
        }
        catch
        {
            ActivationStatusText.Text = "غير متصل بخدمة التفعيل";
        }
    }

    private string ExpiryLabel(string prefix)
    {
        if (_activationState?.ExpiresAt is not long value) return prefix;
        var expiry = value > 10_000_000_000
            ? DateTimeOffset.FromUnixTimeMilliseconds(value)
            : DateTimeOffset.FromUnixTimeSeconds(value);
        return prefix + " • حتى " + expiry.ToLocalTime().ToString("yyyy/MM/dd");
    }

    private async Task SyncPortalAsync()
    {
        if (_activationState?.CanUse() != true) return;
        try
        {
            var remote = await _portal.FetchAsync(_identity);
            if (remote.Count == 0) return;

            foreach (var item in remote)
            {
                var existing = _store.State.Providers.FirstOrDefault(p => p.Id == item.Id);
                if (existing is null) _store.State.Providers.Add(item);
                else
                {
                    existing.Name = item.Name;
                    existing.BaseUrl = item.BaseUrl;
                    existing.Username = item.Username;
                    existing.Password = item.Password;
                    existing.SubscriberToken = item.SubscriberToken;
                    existing.Active = item.Active;
                    existing.UpdatedAt = item.UpdatedAt;
                }
            }

            var selected = remote.FirstOrDefault(p => p.Active) ?? remote.FirstOrDefault();
            if (selected is not null) _store.State.ActiveProviderId = selected.Id;
            await _store.SaveAsync();
        }
        catch { }
    }

    private async Task SyncCatalogAsync(bool userRequested)
    {
        if (_catalog is null) return;
        var provider = _store.ActiveProvider();
        _activeProvider = provider;
        if (provider is null)
        {
            if (userRequested) ShowProviders();
            return;
        }
        if (_activationState?.CanUse() != true)
        {
            if (userRequested) ShowActivation();
            return;
        }

        // Keep each refresh tied to its own provider/token. A second refresh
        // must never inherit the first one's token or replace its UI on finish.
        _syncCts?.Cancel();
        var sync = new CancellationTokenSource();
        _syncCts = sync;
        var progress = new Progress<(int Percent, string Text)>(p =>
        {
            if (ReferenceEquals(_syncCts, sync) && !sync.IsCancellationRequested)
                ProgressText.Text = p.Percent + "% • " + p.Text;
        });

        try
        {
            var snapshot = await Task.Run(() => _catalog.SyncAsync(provider, progress, sync.Token), sync.Token);
            if (!ReferenceEquals(_syncCts, sync) || sync.IsCancellationRequested ||
                _store.ActiveProvider()?.Id != provider.Id) return;

            ProgressText.Text = "فهرسة المحتوى…";
            var index = await Task.Run(() => CatalogViewIndex.Build(snapshot), sync.Token);
            if (!ReferenceEquals(_syncCts, sync) || sync.IsCancellationRequested ||
                _store.ActiveProvider()?.Id != provider.Id) return;

            _viewIndex = index;
            _detailsCache.Clear();
            _episodesCache.Clear();
            PageSubtitle.Text = provider.Name + " • " + snapshot.Streams.Count.ToString("N0") + " عنصر";
            ProgressText.Text = "جاهز";
            RefreshCurrentPage();
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            if (!ReferenceEquals(_syncCts, sync)) return;
            ProgressText.Text = "تعذر التحديث • المكتبة السابقة محفوظة";
            if (userRequested)
                MessageBox.Show(this, ex.Message, "BLOFY PLAYER");
        }
        finally
        {
            if (ReferenceEquals(_syncCts, sync)) _syncCts = null;
            sync.Dispose();
        }
    }

    private void HeaderBackButton_Click(object sender, RoutedEventArgs e) =>
        NavigateBack();

    private void NavigateBack()
    {
        if (_pageBackAction is not null)
        {
            var action = _pageBackAction;
            _pageBackAction = null;
            action();
            return;
        }

        if (_detailsOpen)
        {
            RefreshCurrentPage();
            return;
        }

        if (_currentPage != "home")
        {
            _currentPage = "home";
            _store.State.Settings.LastPage = "home";
            _store.ScheduleSave();
            RefreshCurrentPage();
            return;
        }

        if (UiDialogs.Confirm(this, "الخروج من BLOFY", "هل تريد إغلاق BLOFY PLAYER؟"))
            Close();
    }

    private void OpenSubpage(Action open)
    {
        var returnPage = _currentPage;
        _pageBackAction = () =>
        {
            _currentPage = returnPage;
            RefreshCurrentPage();
        };
        HeaderBackButton.Visibility = Visibility.Visible;
        open();
    }

    private void Nav_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: string page }) return;
        _currentPage = page;
        _store.State.Settings.LastPage = NormalizeLastPage(page);
        _store.ScheduleSave();
        RefreshCurrentPage();
    }

    private static string NormalizeLastPage(string? page) =>
        page is "home" or "live" or "movie" or "series" or "collections" or "favorites" or "search" or "settings"
            ? page
            : "home";

    private void RefreshCurrentPage()
    {
        _activeBrowserSearch = null;
        _detailsOpen = false;
        _pageBackAction = null;
        HeaderBackButton.Visibility = _currentPage == "home"
            ? Visibility.Collapsed
            : Visibility.Visible;
        _homeRenderCts?.Cancel();
        DisposePreview();
        if (_currentPage != "home")
        {
            _heroTimer.Stop();
            _heroHost = null;
        }
        UpdateNavigationState();
        switch (_currentPage)
        {
            case "home": ShowHome(); break;
            case "live": ShowBrowser("live"); break;
            case "movie": ShowBrowser("movie"); break;
            case "series": ShowBrowser("series"); break;
            case "collections": ShowCollections(); break;
            case "favorites": ShowFavorites(); break;
            case "search": ShowSearch(); break;
            case "profiles": ShowProfiles(); break;
            case "providers": ShowProviders(); break;
            case "settings": ShowSettings(); break;
            default: ShowHome(); break;
        }
    }

    private async void Refresh_Click(object sender, RoutedEventArgs e)
    {
        await CheckActivationAsync();
        await SyncPortalAsync();
        await SyncCatalogAsync(true);
    }

    private void ShowHome()
    {
        DisposePreview();
        PageTitle.Text = "BLOFY PLAYER";
        PageSubtitle.Text = "اليوم";
        HeaderServerText.Text = _activeProvider?.Name ?? "BLOFY";

        if (_activationState?.CanUse() != true)
        {
            var gated = Vertical();
            gated.Children.Add(ActivationCard());
            ContentHost.Content = new ScrollViewer
            {
                Content = gated,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto
            };
            return;
        }

        _homeRenderCts?.Cancel();
        _homeRenderCts?.Dispose();
        _homeRenderCts = new CancellationTokenSource();
        var token = _homeRenderCts.Token;

        var root = Vertical();
        var latest = _viewIndex.Collection("latest").Where(_store.IsContentVisible).Take(36).ToList();
        _heroCandidates = latest
            .Where(x => !string.IsNullOrWhiteSpace(x.Backdrop) || !string.IsNullOrWhiteSpace(x.Icon))
            .Take(6)
            .ToList();
        if (_heroCandidates.Count == 0) _heroCandidates = latest.Take(6).ToList();

        if (_heroCandidates.Count > 0)
        {
            _heroIndex = Math.Clamp(_heroIndex, 0, _heroCandidates.Count - 1);
            _heroHost = new ContentControl
            {
                Content = BuildAndroidHero(_heroCandidates[_heroIndex]),
                HorizontalContentAlignment = HorizontalAlignment.Stretch
            };
            root.Children.Add(_heroHost);
            _heroTimer.Start();
        }
        else
        {
            _heroHost = null;
            _heroTimer.Stop();
        }

        var continueItems = _store.WatchStates
            .Where(w => !w.Completed && w.PositionMs > 30_000)
            .OrderByDescending(w => w.UpdatedAt)
            .Select(w => _viewIndex.Find(w.Key))
            .Where(x => x is not null && _store.IsContentVisible(x))
            .Cast<StreamItem>()
            .Take(12)
            .ToList();
        if (continueItems.Count > 0)
            root.Children.Add(ContentRow("متابعة المشاهدة", continueItems, landscape: true));

        var recentChannels = _store.RecentChannels
            .Select(key => _viewIndex.Find(key))
            .Where(x => x is not null && x.Kind == "live" && _store.IsContentVisible(x))
            .Cast<StreamItem>()
            .Take(10)
            .ToList();
        if (recentChannels.Count > 0)
            root.Children.Add(ContentRow("آخر القنوات", recentChannels, landscape: true));

        var scroll = new ScrollViewer
        {
            Content = root,
            VerticalScrollBarVisibility = ScrollBarVisibility.Hidden,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled
        };
        ContentHost.Content = scroll;

        _ = PopulateHomeShelvesAsync(root, latest, token);
    }

    private async Task PopulateHomeShelvesAsync(StackPanel root, IReadOnlyList<StreamItem> latest, CancellationToken token)
    {
        async Task AddAsync(Func<UIElement?> factory)
        {
            await Task.Delay(70, token);
            token.ThrowIfCancellationRequested();
            if (_currentPage != "home") throw new OperationCanceledException(token);

            var element = factory();
            if (element is not null) root.Children.Add(element);
        }

        try
        {
            var recent = _store.WatchStates
                .OrderByDescending(w => w.UpdatedAt)
                .Select(w => _viewIndex.Find(w.Key))
                .Where(x => x is not null && _store.IsContentVisible(x))
                .Cast<StreamItem>()
                .DistinctBy(x => x.Key)
                .Take(10)
                .ToList();
            if (recent.Count > 0)
                await AddAsync(() => ContentRow("شاهدتها مؤخرًا", recent, landscape: true));

            if (latest.Count > 0)
                await AddAsync(() => ContentRow("أضيف حديثًا", latest.Take(10).ToList()));

            var top = _viewIndex.Collection("top").Where(_store.IsContentVisible).Take(14).ToList();
            if (top.Count > 0)
            {
                await AddAsync(() => TopTenRow(top.Take(10).ToList()));
                await AddAsync(() => ContentRow("أعلى تقييم", top.Take(10).ToList()));
            }

            var arabic = _viewIndex.Collection("arabic").Where(_store.IsContentVisible).Take(10).ToList();
            if (arabic.Count > 0)
                await AddAsync(() => ContentRow("مختارات عربية", arabic));

            var ultra = _viewIndex.Collection("4k").Where(_store.IsContentVisible).Take(10).ToList();
            if (ultra.Count > 0)
                await AddAsync(() => ContentRow("4K • UHD", ultra));

            await AddAsync(QuickLinksRow);
        }
        catch (OperationCanceledException) { }
    }

    private UIElement BuildAndroidHero(StreamItem item)
    {
        var hero = new Border
        {
            Height = 330,
            CornerRadius = new CornerRadius(18),
            BorderBrush = Brush("#52FFFFFF"),
            BorderThickness = new Thickness(1),
            ClipToBounds = true,
            Margin = new Thickness(0, 0, 0, 10)
        };

        var grid = new Grid
        {
            Background = new LinearGradientBrush(Brush("#241536").Color, Brush("#08060D").Color, 15)
        };
        var artwork = item.Backdrop;
        if (string.IsNullOrWhiteSpace(artwork)) artwork = item.Icon;
        if (!string.IsNullOrWhiteSpace(artwork))
        {
            var heroImage = new Image
            {
                Stretch = Stretch.UniformToFill,
                Opacity = .88
            };
            BindArtwork(heroImage, artwork, 1100);
            grid.Children.Add(heroImage);
        }

        grid.Children.Add(new Border
        {
            Background = new LinearGradientBrush(
                new GradientStopCollection
                {
                    new(Brush("#FA090B10").Color, 0),
                    new(Brush("#B3090B10").Color, .46),
                    new(Brush("#18090B10").Color, 1)
                },
                new Point(1, .5), new Point(0, .5))
        });

        var content = Vertical();
        content.Width = 620;
        content.VerticalAlignment = VerticalAlignment.Center;
        content.HorizontalAlignment = HorizontalAlignment.Right;
        content.Margin = new Thickness(28, 22, 28, 28);

        content.Children.Add(Txt(item.Kind == "series" ? "مسلسل جديد" : "فيلم جديد", 10, Accent, FontWeights.Bold));
        var title = Txt(item.Name, 30, Brushes.White, FontWeights.Bold, 0, 7, 0, 0);
        title.MaxWidth = 590;
        title.MaxHeight = 82;
        title.TextTrimming = TextTrimming.CharacterEllipsis;
        title.FlowDirection = DetectDirection(item.Name);
        content.Children.Add(title);

        var meta = string.Join("   •   ", new[]
        {
            item.Year,
            string.IsNullOrWhiteSpace(item.Rating) ? "" : "★ " + item.Rating,
            item.Genre?.Split(',').FirstOrDefault()?.Trim(),
            item.Kind == "series" ? "مسلسل" : "فيلم"
        }.Where(x => !string.IsNullOrWhiteSpace(x)));
        var metaText = Txt(meta, 11, Brush("#DDD3E9"), marginTop: 7);
        metaText.FlowDirection = FlowDirection.LeftToRight;
        content.Children.Add(metaText);

        var plot = Txt(string.IsNullOrWhiteSpace(item.Plot)
            ? (item.Kind == "series" ? "اكتشف تفاصيل المسلسل والحلقات." : "شاهد الفيلم الآن على BLOFY PLAYER.")
            : item.Plot, 12, Brush("#DAD5E1"), marginTop: 8, marginBottom: 10);
        plot.MaxWidth = 590;
        plot.MaxHeight = 48;
        plot.TextTrimming = TextTrimming.CharacterEllipsis;
        plot.FlowDirection = DetectDirection(plot.Text);
        content.Children.Add(plot);

        var actions = Horizontal();
        actions.Children.Add(Action(item.Kind == "series" ? "عرض المسلسل" : "شاهد الآن", true, async (_, _) =>
        {
            if (item.Kind == "series") await ShowDetailsAsync(item);
            else await PlayItemAsync(item);
        }));
        actions.Children.Add(Action("استكشف الأفلام", false, (_, _) =>
        {
            _currentPage = "movie";
            RefreshCurrentPage();
        }, 10));
        content.Children.Add(actions);

        if (_heroCandidates.Count > 1)
        {
            var dots = Horizontal(0, 18, 0, 0);
            for (var i = 0; i < _heroCandidates.Count; i++)
            {
                dots.Children.Add(new Border
                {
                    Width = i == _heroIndex ? 15 : 5,
                    Height = 4,
                    CornerRadius = new CornerRadius(2),
                    Background = i == _heroIndex ? Accent : Brush("#667B6A89"),
                    Margin = new Thickness(4, 0, 0, 0)
                });
            }
            content.Children.Add(dots);
        }

        grid.Children.Add(content);
        hero.Child = grid;
        return hero;
    }

    private UIElement TopTenRow(IReadOnlyList<StreamItem> items)
    {
        var section = Vertical(0, 18, 0, 0);
        section.Children.Add(Txt("TOP 10", 16, Text, FontWeights.SemiBold, marginBottom: 8));
        var row = Horizontal();
        for (var i = 0; i < items.Count; i++)
        {
            var wrap = new Grid { Width = 198, Height = 242, Margin = new Thickness(0, 0, 10, 0) };
            wrap.Children.Add(new TextBlock
            {
                Text = (i + 1).ToString(),
                FontSize = 52,
                FontWeight = FontWeights.Bold,
                Foreground = Brush("#606671"),
                VerticalAlignment = VerticalAlignment.Bottom,
                HorizontalAlignment = HorizontalAlignment.Left,
                Margin = new Thickness(0, 0, 0, 20)
            });
            var card = ContentCard(items[i], 150);
            card.HorizontalAlignment = HorizontalAlignment.Right;
            wrap.Children.Add(card);
            row.Children.Add(wrap);
        }
        section.Children.Add(new ScrollViewer
        {
            Content = row,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Hidden,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled
        });
        return section;
    }

    private UIElement QuickLinksRow()
    {
        var section = Vertical(0, 20, 0, 18);
        section.Children.Add(Txt("اختصارات سريعة", 16, Text, FontWeights.SemiBold, marginBottom: 8));
        var row = Horizontal();
        foreach (var entry in new[]
        {
            ("● البث المباشر", "live"),
            ("▣ الأفلام", "movie"),
            ("▤ المسلسلات", "series"),
            ("★ المفضلة", "favorites"),
            ("⌕ البحث", "search")
        })
        {
            var button = Action(entry.Item1, false, (_, _) =>
            {
                _currentPage = entry.Item2;
                RefreshCurrentPage();
            }, 0, 0, 9, 0);
            button.Width = 150;
            button.Height = 58;
            row.Children.Add(button);
        }
        section.Children.Add(row);
        return section;
    }

    private static FlowDirection DetectDirection(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return FlowDirection.RightToLeft;
        return value.Any(ch => ch >= '\u0600' && ch <= '\u06FF')
            ? FlowDirection.RightToLeft
            : FlowDirection.LeftToRight;
    }

    private UIElement ActivationCard()
    {
        var card = Card();
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition());
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(230) });

        var info = Vertical();
        info.Children.Add(Txt("تفعيل BLOFY PLAYER", 26, Text, FontWeights.Bold));
        info.Children.Add(Txt("امسح الباركود أو افتح موقع التفعيل ثم أدخل رقم الجهاز وكود التفعيل.", 13, Muted, FontWeights.Normal, 0, 8, 0, 18));
        info.Children.Add(Txt("رقم الجهاز", 11, Muted));
        info.Children.Add(Txt(_identity.DeviceId, 20, Accent, FontWeights.Bold, 0, 2, 0, 10, FlowDirection.LeftToRight));
        info.Children.Add(Txt("كود التفعيل", 11, Muted));
        info.Children.Add(Txt(_identity.ActivationCode, 30, Accent, FontWeights.Bold, 0, 2, 0, 16, FlowDirection.LeftToRight));
        info.Children.Add(Action("فتح صفحة التفعيل", true, (_, _) => OpenActivationPortal()));
        grid.Children.Add(info);

        var qr = new Image { Width = 210, Height = 210, Stretch = Stretch.Uniform };
        try { qr.Source = QrCodeHelper.Create(ActivationPortalUrl()); } catch { }
        Grid.SetColumn(qr, 1);
        grid.Children.Add(qr);
        card.Child = grid;
        return card;
    }

    private UIElement ActivationCompact()
    {
        var card = Card(0, 24, 0, 0);
        var row = Horizontal();
        var info = Vertical();
        info.Children.Add(Txt("الجهاز: " + _identity.DeviceId, 12, Text, FontWeights.Bold, flow: FlowDirection.LeftToRight));
        info.Children.Add(Txt("التفعيل: " + _identity.ActivationCode + " • " + ActivationStatusText.Text, 11, Muted, flow: FlowDirection.LeftToRight));
        row.Children.Add(info);
        var button = Action("إدارة التفعيل", false, (_, _) => ShowActivation(), 18);
        row.Children.Add(button);
        card.Child = row;
        return card;
    }

    private void ShowActivation()
    {
        PageTitle.Text = "التفعيل والاشتراك";
        var root = Vertical();
        root.Children.Add(ActivationCard());
        root.Children.Add(Txt("بعد الدفع أو التجديد اضغط «تحديث» أعلى الصفحة لتحديث حالة الجهاز فورًا.", 12, Muted, marginTop: 12));
        ContentHost.Content = root;
    }

    private void OpenActivationPortal()
    {
        try
        {
            Process.Start(new ProcessStartInfo(ActivationPortalUrl()) { UseShellExecute = true });
        }
        catch { }
    }

    private string ActivationPortalUrl() => BlofyEndpoints.ActivationPortal(_identity);

    private void ShowBrowser(string kind)
    {
        if (kind == "live") { ShowLiveBrowser(); return; }

        DisposePreview();
        var label = kind == "movie" ? "الأفلام" : "المسلسلات";
        PageTitle.Text = "BLOFY • " + label;
        PageSubtitle.Text = _activeProvider?.Name ?? "BLOFY";

        var all = Items(kind);
        if (all.Count == 0)
        {
            ContentHost.Content = EmptyState("لا يوجد محتوى محمّل في " + label, "اضغط تحديث أو أضف قائمة من «القوائم».");
            return;
        }

        var compact = _store.State.Settings.CatalogDensity == "compact";
        var posterWidth = compact ? 138 : 160;
        var batchSize = compact ? 42 : 30;
        var cellHeight = (int)Math.Round((posterWidth - 18) * 1.5) + 84;

        // Use two height-constrained columns. A vertical StackPanel directly in
        // a Grid gives its children infinite height, leaving the poster scroller
        // unable to scroll on smaller windows.
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(255) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(14) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var categoryColumn = new Grid();
        categoryColumn.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        categoryColumn.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        categoryColumn.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        Grid.SetColumn(categoryColumn, 0);
        grid.Children.Add(categoryColumn);

        var categoryHeader = Vertical(0, 0, 0, 8);
        categoryHeader.Children.Add(Txt("الفئات", 17, Accent, FontWeights.Bold, 4, 0, 0, 5));
        var categorySearch = new TextBox { Height = 38, FontSize = 13, ToolTip = "ابحث عن اسم الفئة" };
        categoryHeader.Children.Add(categorySearch);
        categoryColumn.Children.Add(categoryHeader);

        var cats = new ListBox
        {
            Style = Application.Current.FindResource("TvListBox") as Style,
            DisplayMemberPath = "Name",
            VerticalAlignment = VerticalAlignment.Stretch
        };
        VirtualizingPanel.SetIsVirtualizing(cats, true);
        VirtualizingPanel.SetVirtualizationMode(cats, VirtualizationMode.Recycling);
        ScrollViewer.SetCanContentScroll(cats, true);
        ScrollViewer.SetVerticalScrollBarVisibility(cats, ScrollBarVisibility.Auto);
        Grid.SetRow(cats, 1);
        categoryColumn.Children.Add(cats);

        var allCategories = new List<CategoryItem>
        {
            new() { RemoteId = "", Kind = kind, Name = "الكل" }
        };
        allCategories.AddRange((_catalog?.Snapshot.Categories ?? [])
            .Where(x => x.Kind == kind && !_store.IsCategoryHidden(kind, x.RemoteId)));
        var categoryFoot = Txt(allCategories.Count.ToString("N0") + " فئة  •  ↑↓ للتنقل", 11, Muted, marginTop: 8);
        Grid.SetRow(categoryFoot, 2);
        categoryColumn.Children.Add(categoryFoot);
        categorySearch.PreviewKeyDown += (_, e) =>
        {
            if (e.Key is not (Key.Down or Key.Enter)) return;
            FocusSelectedListItem(cats);
            e.Handled = true;
        };

        var right = new Grid();
        right.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        right.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        right.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        Grid.SetColumn(right, 2);
        grid.Children.Add(right);

        var searchHeader = Vertical(0, 0, 0, 10);
        var title = Txt("استعرض " + label, 15, Text, FontWeights.SemiBold, 0, 0, 0, 7);
        searchHeader.Children.Add(title);
        var contentSearch = new TextBox
        {
            Height = 43, FontSize = 15,
            ToolTip = "ابحث في جميع " + label + " مهما كانت الفئة — من أول حرف"
        };
        searchHeader.Children.Add(contentSearch);
        _activeBrowserSearch = contentSearch;
        searchHeader.Children.Add(Txt("البحث يشمل كل فئات " + label + " • Enter من الفئات ينقلك للبوسترات", 11, Muted, marginTop: 5));
        right.Children.Add(searchHeader);

        var scroll = new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            PanningMode = PanningMode.VerticalOnly,
            Focusable = false
        };
        var wrap = new WrapPanel
        {
            Orientation = Orientation.Horizontal,
            ItemWidth = posterWidth + 22,
            ItemHeight = cellHeight
        };
        scroll.Content = wrap;
        contentSearch.PreviewKeyDown += (_, e) =>
        {
            if (e.Key is not (Key.Down or Key.Enter)) return;
            if (wrap.Children.OfType<Button>().FirstOrDefault() is not Button first) return;
            first.Focus();
            first.BringIntoView();
            e.Handled = true;
        };
        Grid.SetRow(scroll, 1);
        right.Children.Add(scroll);

        IReadOnlyList<StreamItem> filtered = all;
        int visible = 0;
        bool appending = false;
        Button more = null!;
        var footer = Horizontal(0, 10, 0, 0);
        var countLabel = Txt("", 12, Muted, marginLeft: 12, marginTop: 8);
        more = Action("↓ عرض المزيد", false, (_, _) => AppendMore(true), 0, 0, 12, 0);
        more.MinWidth = 135;
        footer.Children.Add(more);
        footer.Children.Add(countLabel);
        Grid.SetRow(footer, 2);
        right.Children.Add(footer);

        CancellationTokenSource? filterRequest = null;
        string? remembered = _browserCategoryByKind.TryGetValue(kind, out var chosen) ? chosen : "";

        IReadOnlyList<StreamItem> CurrentCategory()
        {
            if (cats.SelectedItem is not CategoryItem category ||
                string.IsNullOrEmpty(category.RemoteId)) return all;
            return CategoryItems(kind, category.RemoteId);
        }

        void AppendMore(bool focusNew = false)
        {
            if (appending || visible >= filtered.Count) return;
            appending = true;
            var from = visible;
            var until = Math.Min(filtered.Count, from + batchSize);
            for (var i = from; i < until; i++)
                wrap.Children.Add(ContentCard(filtered[i], posterWidth));
            visible = until;
            countLabel.Text = "عرض " + visible.ToString("N0") + " من " +
                              filtered.Count.ToString("N0") + " " + (kind == "movie" ? "فيلم" : "مسلسل");
            more.Visibility = visible < filtered.Count ? Visibility.Visible : Visibility.Collapsed;
            appending = false;
            if (focusNew && until > from)
                _ = Dispatcher.BeginInvoke(() =>
                {
                    if (!ReferenceEquals(ContentHost.Content, grid)) return;
                    if (wrap.Children[from] is Button first) { first.Focus(); first.BringIntoView(); }
                });
        }

        void RenderInitial(IReadOnlyList<StreamItem> items)
        {
            filtered = items;
            visible = 0;
            wrap.Children.Clear();
            scroll.ScrollToTop();
            more.Visibility = Visibility.Collapsed;
            countLabel.Text = items.Count == 0 ? "لا توجد نتائج في هذا القسم" : "جاري عرض المحتوى…";
            AppendMore();
        }

        // Mouse, touch, wheel and keyboard scroll all bring in the next batch
        // without forcing the customer through hundreds of "التالي" pages.
        scroll.ScrollChanged += (_, e) =>
        {
            if (e.ExtentHeightChange == 0 && e.VerticalChange == 0) return;
            if (visible < filtered.Count &&
                scroll.ScrollableHeight - scroll.VerticalOffset < Math.Max(420, scroll.ViewportHeight * .6))
                AppendMore();
        };
        scroll.PreviewKeyDown += (_, e) =>
        {
            if (e.Key is not (Key.PageDown or Key.End)) return;
            if (visible >= filtered.Count) return;
            AppendMore();
        };

        cats.SelectionChanged += (_, _) =>
        {
            if (cats.SelectedItem is CategoryItem selected)
                _browserCategoryByKind[kind] = selected.RemoteId;
            // A typed title search spans the entire kind, not merely the current
            // category; switching categories while not searching is instantaneous.
            if (contentSearch.Text.Trim().Length == 0)
                RenderInitial(CurrentCategory());
        };

        categorySearch.TextChanged += (_, _) =>
        {
            var q = NormalizeSearch(categorySearch.Text);
            var rows = q.Length == 0
                ? allCategories
                : allCategories.Where(c => c.RemoteId.Length == 0 ||
                    NormalizeSearch(c.Name).Contains(q, StringComparison.Ordinal)).ToList();
            cats.ItemsSource = rows;
            var preferred = rows.FirstOrDefault(c => c.RemoteId == _browserCategoryByKind.GetValueOrDefault(kind))
                            ?? rows.FirstOrDefault();
            cats.SelectedItem = preferred;
            if (preferred is not null) cats.ScrollIntoView(preferred);
        };

        cats.PreviewKeyDown += (_, e) =>
        {
            if (e.Key is Key.PageDown or Key.PageUp or Key.Home or Key.End)
                return; // WPF virtualized list handles these and ScrollIntoView.
            if (e.Key is not (Key.Enter or Key.Space)) return;
            var first = wrap.Children.OfType<Button>().FirstOrDefault();
            if (first is null) return;
            first.Focus();
            first.BringIntoView();
            e.Handled = true;
        };

        contentSearch.TextChanged += (_, _) =>
        {
            filterRequest?.Cancel();
            var request = new CancellationTokenSource();
            filterRequest = request;
            _ = SearchCatalogAsync(request);
        };

        async Task SearchCatalogAsync(CancellationTokenSource request)
        {
            var token = request.Token;
            try
            {
                await Task.Delay(170, token);
                var term = NormalizeSearch(contentSearch.Text);
                if (term.Length == 0)
                {
                    if (!token.IsCancellationRequested && ReferenceEquals(ContentHost.Content, grid))
                        RenderInitial(CurrentCategory());
                    return;
                }
                countLabel.Text = "جاري البحث في كل " + label + "…";
                // Do large provider title scans off the UI thread.
                var matches = await Task.Run(() =>
                {
                    var found = new List<StreamItem>();
                    foreach (var item in all)
                    {
                        token.ThrowIfCancellationRequested();
                        if (NormalizeSearch(item.Name).Contains(term, StringComparison.Ordinal))
                            found.Add(item);
                    }
                    return found;
                }, token);
                if (!token.IsCancellationRequested && ReferenceEquals(filterRequest, request) &&
                    ReferenceEquals(ContentHost.Content, grid))
                    RenderInitial(matches);
            }
            catch (OperationCanceledException) { }
            finally
            {
                if (ReferenceEquals(filterRequest, request)) filterRequest = null;
                request.Dispose();
            }
        }

        cats.ItemsSource = allCategories;
        cats.SelectedItem = allCategories.FirstOrDefault(c => c.RemoteId == remembered) ?? allCategories[0];
        RenderInitial(CurrentCategory());
        ContentHost.Content = grid;
        _ = Dispatcher.BeginInvoke(() =>
        {
            if (!ReferenceEquals(ContentHost.Content, grid)) return;
            FocusSelectedListItem(cats);
        });
    }

    private void ShowLiveBrowser()
    {
        DisposePreview();
        PageTitle.Text = "BLOFY • البث المباشر";
        PageSubtitle.Text = _activeProvider?.Name ?? "BLOFY";
        var all = Items("live");
        if (all.Count == 0)
        {
            ContentHost.Content = EmptyState("لا توجد قنوات محمّلة", "اضغط تحديث أو أضف قائمة من «القوائم».");
            return;
        }

        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(210) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(14) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(330) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(14) });
        grid.ColumnDefinitions.Add(new ColumnDefinition());

        var categoriesColumn = new Grid();
        categoriesColumn.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        categoriesColumn.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        categoriesColumn.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        Grid.SetColumn(categoriesColumn, 0);
        grid.Children.Add(categoriesColumn);

        var categoriesHeading = Vertical(0, 0, 0, 8);
        categoriesHeading.Children.Add(Txt("فئات البث", 15, Accent, FontWeights.Bold, 0, 0, 0, 6));
        var categorySearch = new TextBox { Height = 38, FontSize = 12, ToolTip = "ابحث عن اسم فئة البث" };
        categoriesHeading.Children.Add(categorySearch);
        categoriesColumn.Children.Add(categoriesHeading);

        var cats = new ListBox
        {
            Style = Application.Current.FindResource("TvListBox") as Style,
            DisplayMemberPath = "Name",
            VerticalAlignment = VerticalAlignment.Stretch
        };
        ScrollViewer.SetVerticalScrollBarVisibility(cats, ScrollBarVisibility.Auto);
        VirtualizingPanel.SetIsVirtualizing(cats, true);
        VirtualizingPanel.SetVirtualizationMode(cats, VirtualizationMode.Recycling);
        Grid.SetRow(cats, 1);
        categoriesColumn.Children.Add(cats);
        var allCategories = new List<CategoryItem>
        {
            new() { RemoteId = "", Kind = "live", Name = "الكل" }
        };
        allCategories.AddRange((_catalog?.Snapshot.Categories ?? [])
            .Where(c => c.Kind == "live" && !_store.IsCategoryHidden("live", c.RemoteId)));
        var categoryCounter = Txt(allCategories.Count.ToString("N0") + " فئة  •  ↑↓ للتنقل", 10, Muted, marginTop: 8);
        Grid.SetRow(categoryCounter, 2);
        categoriesColumn.Children.Add(categoryCounter);
        categorySearch.PreviewKeyDown += (_, e) =>
        {
            if (e.Key is not (Key.Down or Key.Enter)) return;
            FocusSelectedListItem(cats);
            e.Handled = true;
        };

        var channelsColumn = new Grid();
        channelsColumn.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        channelsColumn.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        channelsColumn.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        Grid.SetColumn(channelsColumn, 2);
        grid.Children.Add(channelsColumn);
        var channelHeading = Vertical(0, 0, 0, 8);
        channelHeading.Children.Add(Txt("القنوات", 15, Accent, FontWeights.Bold, 0, 0, 0, 6));
        var channelSearch = new TextBox { Height = 38, FontSize = 12, ToolTip = "ابحث في جميع القنوات بغض النظر عن الفئة" };
        channelHeading.Children.Add(channelSearch);
        _activeBrowserSearch = channelSearch;
        channelsColumn.Children.Add(channelHeading);

        var channels = new ListBox
        {
            Style = Application.Current.FindResource("TvListBox") as Style,
            DisplayMemberPath = "Name"
        };
        VirtualizingPanel.SetIsVirtualizing(channels, true);
        VirtualizingPanel.SetVirtualizationMode(channels, VirtualizationMode.Recycling);
        ScrollViewer.SetCanContentScroll(channels, true);
        ScrollViewer.SetVerticalScrollBarVisibility(channels, ScrollBarVisibility.Auto);
        channelSearch.PreviewKeyDown += (_, e) =>
        {
            if (e.Key is not (Key.Down or Key.Enter)) return;
            FocusSelectedListItem(channels);
            e.Handled = true;
        };
        Grid.SetRow(channels, 1);
        channelsColumn.Children.Add(channels);
        var channelCounter = Txt("", 10, Muted, marginTop: 8);
        Grid.SetRow(channelCounter, 2);
        channelsColumn.Children.Add(channelCounter);

        var right = Vertical();
        var detailsScroll = new ScrollViewer
        {
            Content = right,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            PanningMode = PanningMode.VerticalOnly
        };
        Grid.SetColumn(detailsScroll, 4);
        grid.Children.Add(detailsScroll);

        var previewBorder = new Border
        {
            Height = 260, CornerRadius = new CornerRadius(14),
            Background = Brushes.Black, BorderBrush = Brush("#665E437A"), BorderThickness = new Thickness(1),
            ClipToBounds = true
        };
        _previewPlayback = new PlaybackService();
        var video = new VideoView { MediaPlayer = _previewPlayback.MediaPlayer };
        previewBorder.Child = video;
        right.Children.Add(previewBorder);

        var channelTitle = Txt("اختر قناة", 20, Text, FontWeights.Bold, 0, 12, 0, 4);
        right.Children.Add(channelTitle);
        var nowText = Txt("", 11, Muted);
        right.Children.Add(nowText);

        var actions = Horizontal(0, 10, 0, 8);
        var playFull = Action("▶ ملء الشاشة", true, async (_, _) =>
        {
            if (channels.SelectedItem is StreamItem selected) await PlayItemAsync(selected, CurrentLivePlaylist());
        });
        actions.Children.Add(playFull);
        right.Children.Add(actions);

        right.Children.Add(Txt("دليل البرامج EPG", 15, Accent, FontWeights.Bold, 0, 10, 0, 8));
        var epgPanel = Vertical();
        right.Children.Add(new ScrollViewer
        {
            Content = epgPanel,
            MaxHeight = 180,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto
        });

        void FillChannels(IReadOnlyList<StreamItem>? searchMatches = null)
        {
            var selectedCat = cats.SelectedItem as CategoryItem;
            IReadOnlyList<StreamItem> filtered = searchMatches ??
                (selectedCat is null || string.IsNullOrWhiteSpace(selectedCat.RemoteId)
                    ? all
                    : CategoryItems("live", selectedCat.RemoteId));

            channels.ItemsSource = filtered;
            channelCounter.Text = filtered.Count.ToString("N0") + " قناة";
            if (filtered.Count > 0) channels.SelectedIndex = 0;
        }

        IReadOnlyList<StreamItem> CurrentLivePlaylist() =>
            channels.ItemsSource as IReadOnlyList<StreamItem> ?? all;

        cats.SelectionChanged += (_, _) =>
        {
            if (channelSearch.Text.Trim().Length == 0) FillChannels();
        };
        categorySearch.TextChanged += (_, _) =>
        {
            var query = NormalizeSearch(categorySearch.Text);
            var shown = query.Length == 0 ? allCategories
                : allCategories.Where(cat => cat.RemoteId.Length == 0 ||
                    NormalizeSearch(cat.Name).Contains(query, StringComparison.Ordinal)).ToList();
            cats.ItemsSource = shown;
            cats.SelectedIndex = shown.Count > 0 ? 0 : -1;
            if (cats.SelectedItem is not null) cats.ScrollIntoView(cats.SelectedItem);
        };

        CancellationTokenSource? channelFilter = null;
        channelSearch.TextChanged += (_, _) =>
        {
            channelFilter?.Cancel();
            var task = new CancellationTokenSource();
            channelFilter = task;
            _ = SearchChannelsAsync(task);
        };
        async Task SearchChannelsAsync(CancellationTokenSource request)
        {
            try
            {
                await Task.Delay(180, request.Token);
                var query = NormalizeSearch(channelSearch.Text);
                if (query.Length == 0)
                {
                    if (ReferenceEquals(channelFilter, request) && ReferenceEquals(ContentHost.Content, grid))
                        FillChannels();
                    return;
                }
                var matching = await Task.Run(() =>
                {
                    var matches = new List<StreamItem>();
                    foreach (var channel in all)
                    {
                        request.Token.ThrowIfCancellationRequested();
                        if (NormalizeSearch(channel.Name).Contains(query, StringComparison.Ordinal))
                            matches.Add(channel);
                    }
                    return matches;
                }, request.Token);
                if (ReferenceEquals(channelFilter, request) && ReferenceEquals(ContentHost.Content, grid))
                    FillChannels(matching);
            }
            catch (OperationCanceledException) { }
            finally
            {
                if (ReferenceEquals(channelFilter, request)) channelFilter = null;
                request.Dispose();
            }
        }

        cats.PreviewKeyDown += (_, e) =>
        {
            if (e.Key is not Key.Enter and not Key.Space) return;
            FocusSelectedListItem(channels);
            e.Handled = true;
        };

        channels.PreviewKeyDown += async (_, e) =>
        {
            if (e.Key is not Key.Enter and not Key.Space) return;
            if (channels.SelectedItem is not StreamItem selected) return;
            e.Handled = true;
            await PlayItemAsync(selected, CurrentLivePlaylist());
        };

        channels.MouseDoubleClick += async (_, _) =>
        {
            if (channels.SelectedItem is StreamItem selected) await PlayItemAsync(selected, CurrentLivePlaylist());
        };

        channels.SelectionChanged += async (_, _) =>
        {
            if (channels.SelectedItem is not StreamItem selected || _activeProvider is null) return;

            _livePreviewCts?.Cancel();
            _livePreviewCts?.Dispose();
            _livePreviewCts = new CancellationTokenSource();
            var token = _livePreviewCts.Token;
            var serial = ++_liveSelectionSerial;

            channelTitle.Text = selected.Name;
            nowText.Text = selected.ArchiveEnabled
                ? "يدعم الاسترجاع حتى " + selected.ArchiveDurationDays + " يوم"
                : "بث مباشر";
            epgPanel.Children.Clear();
            epgPanel.Children.Add(Txt("جاري تجهيز القناة…", 11, Muted));

            try
            {
                await Task.Delay(180, token);
                if (token.IsCancellationRequested || serial != _liveSelectionSerial) return;

                if (_store.State.Settings.AutoplayLive && _previewPlayback is not null)
                {
                    var candidates = BuildStreamCandidates(selected);
                    var url = candidates.FirstOrDefault();
                    if (!string.IsNullOrWhiteSpace(url))
                    {
                        _previewPlayback.Stop();
                        _previewPlayback.Play(url, new Dictionary<string, string>
                        {
                            ["User-Agent"] = _store.State.Settings.UserAgent
                        });
                    }
                }

                epgPanel.Children.Clear();
                epgPanel.Children.Add(Txt("جاري تحميل الدليل…", 11, Muted));

                if (_activeProvider.ProviderType != "xtream")
                {
                    epgPanel.Children.Clear();
                    epgPanel.Children.Add(Txt("EPG غير متاح لهذه القائمة.", 11, Muted));
                    return;
                }

                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
                timeout.CancelAfter(TimeSpan.FromSeconds(6));
                var epg = await _catalog!.Xtream(_activeProvider)
                    .GetShortEpgAsync(_activeProvider, selected.RemoteId, timeout.Token);
                if (token.IsCancellationRequested || serial != _liveSelectionSerial) return;

                epgPanel.Children.Clear();
                if (epg.Count == 0)
                {
                    epgPanel.Children.Add(Txt("لا توجد بيانات EPG من السيرفر.", 11, Muted));
                    return;
                }

                var now = DateTimeOffset.Now;
                var currentProgram = epg.FirstOrDefault(entry => entry.Start <= now && entry.End > now);
                if (currentProgram is not null)
                {
                    nowText.Text = currentProgram.Start.ToLocalTime().ToString("HH:mm") +
                                   "–" + currentProgram.End.ToLocalTime().ToString("HH:mm") +
                                   "  •  " + currentProgram.Title;
                }
                else
                {
                    nowText.Text = selected.ArchiveEnabled
                        ? "يدعم الاسترجاع حتى " + selected.ArchiveDurationDays + " يوم"
                        : "بث مباشر";
                }

                foreach (var entry in epg)
                {
                    var isNow = entry.Start <= now && entry.End > now;
                    var text = entry.Start.ToLocalTime().ToString("HH:mm") + "  " + entry.Title;
                    if (isNow) text = "● الآن  " + text;
                    var button = Action(text, isNow, async (_, _) =>
                    {
                        if (!selected.ArchiveEnabled || entry.End > DateTimeOffset.Now)
                            return;
                        var catchupUrl = _catalog!.Xtream(_activeProvider)
                            .CatchupUrl(_activeProvider, selected, entry.Start, entry.End);
                        await ShowPlayerOverlayAsync(
                            selected.Name + " • " + entry.Title,
                            catchupUrl);
                    }, 0, 0, 0, 6);
                    button.HorizontalContentAlignment = HorizontalAlignment.Right;
                    button.ToolTip = entry.Description;
                    epgPanel.Children.Add(button);
                }
            }
            catch (OperationCanceledException)
            {
                // Selection moved to another channel; only the newest item is allowed to render.
            }
            catch
            {
                if (serial != _liveSelectionSerial) return;
                epgPanel.Children.Clear();
                epgPanel.Children.Add(Txt("تعذر تحميل EPG الآن.", 11, Muted));
            }
        };

        cats.ItemsSource = allCategories;
        cats.SelectedIndex = 0;
        FillChannels();
        ContentHost.Content = grid;
        _ = Dispatcher.BeginInvoke(() => FocusSelectedListItem(cats));
    }

    private static List<string> PosterBadges(StreamItem item)
    {
        var source = (item.Name + " " + item.Genre + " " + item.Extension).Trim();
        var result = new List<string>();

        if (Regex.IsMatch(source, "(?i)(4k|uhd|2160p)")) result.Add("4K");
        if (Regex.IsMatch(source, "(?i)(hdr|dolby\\s*vision)")) result.Add("HDR");
        if (source.Any(ch => ch >= '\u0600' && ch <= '\u06FF') ||
            source.Contains("arab", StringComparison.OrdinalIgnoreCase))
            result.Add("AR");

        var added = item.AddedAt;
        var addedMs = added is > 0 and < 10_000_000_000 ? added * 1000 : added;
        if (addedMs > 0 &&
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - addedMs < 30L * 24 * 60 * 60 * 1000)
            result.Add("NEW");

        return result.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    private static string? EpisodeHint(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        var match = Regex.Match(name, "(?i)(?:S\\d{1,2}E|الحلقة\\s*)(\\d{1,3})");
        return match.Success ? "حلقة " + match.Groups[1].Value : null;
    }

    private Button ContentCard(StreamItem item, int width, bool landscape = false)
    {
        var stack = Vertical();
        var imageHeight = landscape
            ? (int)Math.Round((width - 18) * 9d / 16d)
            : item.Kind == "live"
                ? 100
                : (int)Math.Round((width - 18) * 1.5d);
        var imageBorder = new Border
        {
            Width = width - 18,
            Height = imageHeight,
            CornerRadius = new CornerRadius(10),
            Background = Surface2,
            BorderBrush = Brush("#52FFFFFF"),
            BorderThickness = new Thickness(1),
            ClipToBounds = true
        };

        var imageGrid = new Grid();
        var artwork = landscape
            ? (!string.IsNullOrWhiteSpace(item.Backdrop) ? item.Backdrop : item.Icon)
            : item.Icon;
        if (!string.IsNullOrWhiteSpace(artwork))
        {
            var posterImage = new Image
            {
                Stretch = landscape || item.Kind != "live" ? Stretch.UniformToFill : Stretch.Uniform
            };
            BindArtwork(posterImage, artwork, landscape ? 360 : item.Kind == "live" ? 240 : 220);
            imageGrid.Children.Add(posterImage);
        }

        var badges = PosterBadges(item);
        if (badges.Count > 0)
        {
            var badgeRow = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(7)
            };
            foreach (var badge in badges.Take(3))
            {
                badgeRow.Children.Add(new Border
                {
                    Background = Brush("#DB12161D"),
                    BorderBrush = Brush("#665E437A"),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(8),
                    Padding = new Thickness(6, 2, 6, 2),
                    Margin = new Thickness(0, 0, 4, 0),
                    Child = new TextBlock
                    {
                        Text = badge,
                        Foreground = Brushes.White,
                        FontSize = 8.5,
                        FontWeight = FontWeights.Bold
                    }
                });
            }
            imageGrid.Children.Add(badgeRow);
        }

        if (item.Favorite)
        {
            imageGrid.Children.Add(new Border
            {
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(7),
                Background = Brush("#D908060D"),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(6, 3, 6, 3),
                Child = new TextBlock
                {
                    Text = "★",
                    Foreground = Accent,
                    FontSize = 11,
                    FontWeight = FontWeights.Bold
                }
            });
        }

        var watchState = item.Kind == "live" ? null : _store.WatchState(item.Key);
        if (watchState is { DurationMs: > 0, PositionMs: > 15000, Completed: false })
        {
            var percent = Math.Clamp(watchState.PositionMs * 100d / watchState.DurationMs, 1, 99);
            var progressShell = new Border
            {
                VerticalAlignment = VerticalAlignment.Bottom,
                Background = Brush("#B808060D"),
                Padding = new Thickness(8, 6, 8, 6)
            };
            progressShell.Child = new ProgressBar
            {
                Minimum = 0,
                Maximum = 100,
                Value = percent,
                Height = 4,
                Foreground = Accent,
                Background = Brush("#50443458")
            };
            imageGrid.Children.Add(progressShell);
        }

        imageBorder.Child = imageGrid;
        stack.Children.Add(imageBorder);
        var title = Txt(item.Name, 11.5, Text, FontWeights.SemiBold, 2, 7, 2, 0);
        title.MaxWidth = width - 12;
        title.MaxHeight = 38;
        title.TextTrimming = TextTrimming.CharacterEllipsis;
        title.FlowDirection = DetectDirection(item.Name);
        stack.Children.Add(title);
        if (item.Kind != "live" && !landscape)
        {
            var metaParts = new List<string>();
            if (!string.IsNullOrWhiteSpace(item.Year)) metaParts.Add(item.Year);
            if (!string.IsNullOrWhiteSpace(item.Rating)) metaParts.Add("★ " + item.Rating);
            var episodeHint = EpisodeHint(item.Name);
            if (!string.IsNullOrWhiteSpace(episodeHint)) metaParts.Add(episodeHint);
            if (metaParts.Count > 0)
                stack.Children.Add(Txt(string.Join("  •  ", metaParts), 9.5, Accent));
        }

        var button = new Button
        {
            Tag = item.Key,
            Width = width,
            Height = landscape ? imageHeight + 58 : item.Kind == "live" ? 155 : imageHeight + 60,
            Content = stack,
            Background = Brushes.Transparent,
            BorderBrush = Brushes.Transparent,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(6),
            Margin = new Thickness(4, 4, 14, 16),
            Cursor = Cursors.Hand,
            ToolTip = item.Name,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Stretch,
            RenderTransformOrigin = new Point(.5, .5),
            RenderTransform = new ScaleTransform(1, 1)
        };

        void Focus(bool active)
        {
            button.Background = active ? Brush("#3D2756") : Brushes.Transparent;
            button.BorderBrush = active ? Brush("#F0E1FF") : Brushes.Transparent;
            button.BorderThickness = active ? new Thickness(2) : new Thickness(1);
            Panel.SetZIndex(button, active ? 10 : 0);
            if (button.RenderTransform is ScaleTransform scale)
            {
                var factor = active && _store.State.Settings.Motion != "reduced" ? 1.012 : 1;
                scale.ScaleX = factor;
                scale.ScaleY = factor;
            }
        }

        button.GotKeyboardFocus += (_, _) =>
        {
            _lastFocusedContentKey = item.Key;
            Focus(true);
            button.BringIntoView(new Rect(0, 0, button.ActualWidth, button.ActualHeight));

            if (_currentPage == "home" && _heroHost is not null && item.Kind is "movie" or "series")
            {
                var idx = _heroCandidates.FindIndex(x => x.Key == item.Key);
                if (idx >= 0) _heroIndex = idx;
                _heroHost.Content = BuildAndroidHero(item);
                _heroTimer.Stop();
            }
        };
        button.LostKeyboardFocus += (_, _) =>
        {
            Focus(false);
            if (_currentPage == "home" && _heroCandidates.Count > 1)
                _heroTimer.Start();
        };
        button.MouseEnter += (_, _) => Focus(true);
        button.MouseLeave += (_, _) => Focus(false);
        button.Click += async (_, _) =>
        {
            if (item.Kind == "live") await PlayItemAsync(item);
            else await ShowDetailsAsync(item);
        };
        return button;
    }

    private async Task ShowDetailsAsync(StreamItem item)
    {
        DisposePreview();
        _detailsOpen = true;
        var detailsReturnPage = _currentPage;
        _pageBackAction = () =>
        {
            _currentPage = detailsReturnPage;
            RefreshCurrentPage();
        };
        HeaderBackButton.Visibility = Visibility.Visible;
        _lastFocusedContentKey = item.Key;
        if (_store.IsLocked(item.Key) && !EnsureParentalAccess()) return;

        PageTitle.Text = item.Kind == "series" ? "BLOFY SERIES" : "BLOFY MOVIE";
        PageSubtitle.Text = item.Name;

        ProviderDetails? providerDetails = null;
        if (_activeProvider is not null && _activeProvider.ProviderType == "xtream")
        {
            try
            {
                providerDetails = await GetProviderDetailsCachedAsync(item);
            }
            catch { }
        }

        var detailGenre = providerDetails?.Genre is { Length: > 0 } dg ? dg : item.Genre;
        var detailRating = providerDetails?.Rating is { Length: > 0 } dr ? dr : item.Rating;
        var detailDuration = providerDetails?.Duration is { Length: > 0 } dd ? dd : item.Duration;
        var detailRelease = providerDetails?.ReleaseDate is { Length: > 0 } rd ? rd : item.ReleaseDate;
        var detailPlot = providerDetails?.Plot is { Length: > 0 } dp ? dp : item.Plot;
        var detailBackdrop = providerDetails?.Backdrop is { Length: > 0 } db ? db : item.Backdrop;
        if (string.IsNullOrWhiteSpace(detailBackdrop)) detailBackdrop = item.Icon;

        var root = Vertical();
        var hero = new Grid
        {
            Height = 555,
            ClipToBounds = true,
            Margin = new Thickness(0, 0, 0, 20)
        };

        var heroBorder = new Border
        {
            CornerRadius = new CornerRadius(18),
            BorderBrush = Brush("#52FFFFFF"),
            BorderThickness = new Thickness(1),
            ClipToBounds = true
        };
        var heroLayer = new Grid();

        if (!string.IsNullOrWhiteSpace(detailBackdrop))
        {
            var bgImage = new Image
            {
                Stretch = Stretch.UniformToFill,
                Opacity = .88
            };
            BindArtwork(bgImage, detailBackdrop, 1200);
            heroLayer.Children.Add(bgImage);
        }

        heroLayer.Children.Add(new Border
        {
            Background = new LinearGradientBrush(
                new GradientStopCollection
                {
                    new(Brush("#F707050B").Color, 0),
                    new(Brush("#C10B0712").Color, .42),
                    new(Brush("#64130A1C").Color, .76),
                    new(Brush("#1607050B").Color, 1)
                },
                new Point(0, .5), new Point(1, .5))
        });
        heroLayer.Children.Add(new Border
        {
            Background = new LinearGradientBrush(
                new GradientStopCollection
                {
                    new(Brush("#D907050B").Color, 0),
                    new(Brush("#4207050B").Color, .55),
                    new(Brush("#0007050B").Color, 1)
                },
                new Point(.5, 1), new Point(.5, 0))
        });

        var body = new Grid { Margin = new Thickness(38, 28, 38, 28) };
        body.ColumnDefinitions.Add(new ColumnDefinition());
        body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(28) });
        body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(280) });

        var infoPanel = new Border
        {
            Background = Brush("#B8180F23"),
            BorderBrush = Brush("#52FFFFFF"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(16),
            Padding = new Thickness(24),
            VerticalAlignment = VerticalAlignment.Center
        };
        Grid.SetColumn(infoPanel, 0);

        var info = Vertical();
        info.Children.Add(Txt(item.Kind == "series" ? "BLOFY SERIES" : "BLOFY MOVIE",
            10, Accent, FontWeights.Bold, marginBottom: 6));

        var title = Txt(item.Name, 37, Brushes.White, FontWeights.Bold, marginBottom: 10);
        title.MaxHeight = 100;
        title.TextTrimming = TextTrimming.CharacterEllipsis;
        title.FlowDirection = DetectDirection(item.Name);
        info.Children.Add(title);

        var chips = new WrapPanel
        {
            Orientation = Orientation.Horizontal,
            FlowDirection = FlowDirection.RightToLeft,
            Margin = new Thickness(0, 0, 0, 12)
        };
        foreach (var value in new[]
        {
            item.Year,
            detailRelease,
            detailGenre?.Split(',').FirstOrDefault()?.Trim(),
            string.IsNullOrWhiteSpace(detailRating) ? "" : "★ " + detailRating,
            detailDuration,
            providerDetails?.Country
        }.Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().Take(8))
        {
            chips.Children.Add(MetadataChip(value!));
        }
        info.Children.Add(chips);

        if (!string.IsNullOrWhiteSpace(detailPlot))
        {
            var plot = Txt(detailPlot, 14, Brush("#DAD5E1"), marginBottom: 12);
            plot.MaxHeight = 88;
            plot.TextTrimming = TextTrimming.CharacterEllipsis;
            plot.FlowDirection = DetectDirection(detailPlot);
            info.Children.Add(plot);
        }

        if (!string.IsNullOrWhiteSpace(providerDetails?.Network))
            info.Children.Add(Txt("الشبكة: " + providerDetails.Network, 11, Accent, marginBottom: 5));
        if (!string.IsNullOrWhiteSpace(providerDetails?.Cast))
        {
            var cast = Txt("الممثلون: " + providerDetails.Cast, 11, Muted, marginBottom: 5);
            cast.MaxHeight = 42;
            cast.TextTrimming = TextTrimming.CharacterEllipsis;
            cast.FlowDirection = DetectDirection(cast.Text);
            info.Children.Add(cast);
        }
        if (!string.IsNullOrWhiteSpace(providerDetails?.Director))
        {
            var director = Txt("المخرج: " + providerDetails.Director, 11, Muted, marginBottom: 8);
            director.FlowDirection = DetectDirection(director.Text);
            info.Children.Add(director);
        }

        var actions = Horizontal(0, 8, 0, 0);
        actions.Children.Add(Action("← رجوع", false, (_, _) => RefreshCurrentPage()));
        if (item.Kind == "movie")
        {
            actions.Children.Add(Action("▶ تشغيل", true, async (_, _) => await PlayItemAsync(item)));
        }
        else if (item.Kind == "series")
        {
            actions.Children.Add(Action("▤ المواسم والحلقات", true, async (_, _) => await OpenEpisodesAsync(item)));
        }

        var fav = Action(item.Favorite ? "★ إزالة من المفضلة" : "☆ إضافة للمفضلة", false, async (s, _) =>
        {
            await _store.ToggleFavoriteAsync(item);
            if (s is Button b) b.Content = item.Favorite ? "★ إزالة من المفضلة" : "☆ إضافة للمفضلة";
        }, 8);
        actions.Children.Add(fav);

        var lockButton = Action(_store.IsLocked(item.Key) ? "🔓 إلغاء القفل" : "🔒 قفل المحتوى", false, async (s, _) =>
        {
            var locked = _store.IsLocked(item.Key);
            if (locked)
            {
                if (!EnsureParentalAccess()) return;
                await _store.SetLockedAsync(item.Key, false);
            }
            else
            {
                if (!_store.HasParentalPin)
                {
                    var newPin = UiDialogs.Prompt(this, "PIN أبوي",
                        "عيّن PIN من 4 إلى 8 أرقام قبل قفل المحتوى", password: true);
                    if (string.IsNullOrWhiteSpace(newPin)) return;
                    try { await _store.SetParentalPinAsync(newPin); }
                    catch (Exception ex) { MessageBox.Show(this, ex.Message, "BLOFY PLAYER"); return; }
                }
                await _store.SetLockedAsync(item.Key, true);
            }

            if (s is Button b) b.Content = _store.IsLocked(item.Key) ? "🔓 إلغاء القفل" : "🔒 قفل المحتوى";
        }, 8);
        actions.Children.Add(lockButton);
        info.Children.Add(actions);
        infoPanel.Child = info;
        body.Children.Add(infoPanel);

        var posterShell = new Border
        {
            Width = 280,
            Height = 420,
            CornerRadius = new CornerRadius(20),
            Background = Brush("#35110B18"),
            BorderBrush = Brush("#52FFFFFF"),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(2),
            VerticalAlignment = VerticalAlignment.Center,
            ClipToBounds = true
        };
        if (!string.IsNullOrWhiteSpace(item.Icon))
        {
            var posterImage = new Image { Stretch = Stretch.UniformToFill };
            BindArtwork(posterImage, item.Icon, 480);
            posterShell.Child = posterImage;
        }
        Grid.SetColumn(posterShell, 2);
        body.Children.Add(posterShell);

        heroLayer.Children.Add(body);
        heroBorder.Child = heroLayer;
        hero.Children.Add(heroBorder);
        root.Children.Add(hero);

        var pageScroll = new ScrollViewer
        {
            Content = root,
            VerticalScrollBarVisibility = ScrollBarVisibility.Hidden,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled
        };
        ContentHost.Content = pageScroll;

    }

    private async Task OpenEpisodesAsync(StreamItem series)
    {
        if (_activeProvider is null || _catalog is null || _activeProvider.ProviderType != "xtream")
        {
            MessageBox.Show(this, "الحلقات متاحة لقوائم Xtream فقط.", "BLOFY PLAYER");
            return;
        }

        EpisodesOverlay? overlay = null;
        overlay = new EpisodesOverlay(
            series,
            _store,
            async ct => await GetEpisodesCachedAsync(series, ct),
            async (episode, all) => await PlayEpisodeAsync(series, episode, all),
            close: () =>
            {
                if (overlay is not null) CloseOverlay(overlay);
            });
        PushOverlay(overlay);
        await Task.CompletedTask;
    }

    private async Task<string> GetLiveNowNextTextAsync(StreamItem item, CancellationToken ct)
    {
        if (_activeProvider is null || _catalog is null || _activeProvider.ProviderType != "xtream")
            return "بث مباشر";

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(6));

        var epg = await _catalog.Xtream(_activeProvider)
            .GetShortEpgAsync(_activeProvider, item.RemoteId, timeout.Token);
        if (epg.Count == 0) return "لا تتوفر معلومات البرنامج";

        var now = DateTimeOffset.Now;
        var current = epg.FirstOrDefault(entry => entry.Start <= now && entry.End > now)
                      ?? epg.FirstOrDefault(entry => entry.End > now);
        if (current is null) return "لا تتوفر معلومات البرنامج";

        var next = epg
            .Where(entry => entry.Start >= current.End)
            .OrderBy(entry => entry.Start)
            .FirstOrDefault();

        var lines = new List<string>
        {
            "الآن  " +
            current.Start.ToLocalTime().ToString("HH:mm") + "–" +
            current.End.ToLocalTime().ToString("HH:mm") + "   " +
            current.Title
        };

        if (next is not null)
        {
            lines.Add("التالي  " +
                      next.Start.ToLocalTime().ToString("HH:mm") + "   " +
                      next.Title);
        }

        return string.Join(Environment.NewLine, lines);
    }

    private async Task PlayItemAsync(StreamItem item, IReadOnlyList<StreamItem>? livePlaylistOverride = null)
    {
        if (_activeProvider is null) return;
        string url;
        if (_activeProvider.ProviderType == "m3u") url = item.DirectSource;
        else url = _catalog!.Xtream(_activeProvider).StreamUrl(_activeProvider, item, _store.State.Settings.LiveFormat);

        long resume = 0;
        var itemState = _store.WatchState(item.Key);
        if (item.Kind != "live" && itemState is not null && !itemState.Completed && itemState.PositionMs > 30_000)
        {
            var state = itemState;
            if (!_store.State.Settings.ResumePrompt ||
                MessageBox.Show(this, "متابعة من " + TimeSpan.FromMilliseconds(state.PositionMs).ToString(@"hh\:mm\:ss") + "؟", "BLOFY PLAYER",
                    MessageBoxButton.YesNo) == MessageBoxResult.Yes)
                resume = state.PositionMs;
        }

        var sameKind = item.Kind == "live"
            ? (livePlaylistOverride ??
               (!string.IsNullOrWhiteSpace(item.CategoryId)
                   ? CategoryItems("live", item.CategoryId)
                   : Items("live")))
            : Array.Empty<StreamItem>();
        var idx = -1;
        if (item.Kind == "live")
        {
            for (var i = 0; i < sameKind.Count; i++)
            {
                if (!sameKind[i].Key.Equals(item.Key, StringComparison.Ordinal)) continue;
                idx = i;
                break;
            }
        }
        Func<StreamItem, string>? resolver = item.Kind == "live"
            ? s => BuildStreamCandidates(s).FirstOrDefault() ?? ""
            : null;
        Func<StreamItem, IReadOnlyList<string>>? recoveryResolver = item.Kind == "live"
            ? s => BuildStreamCandidates(s)
            : null;

        var currentPlaybackItem = item;

        if (item.Kind == "live")
            await _store.AddRecentChannelAsync(item.Key);

        await ShowPlayerOverlayAsync(
            item.Name,
            url,
            resumePositionMs: resume,
            playlist: sameKind,
            playlistIndex: idx,
            urlResolver: resolver,
            recoveryResolver: recoveryResolver,
            recoveryUrls: BuildStreamCandidates(item),
            savePosition: item.Kind == "live" ? null : async (pos, len) =>
                await _store.SaveWatchStateAsync(item.Key, pos, len),
            onPlaylistItemChanged: item.Kind == "live"
                ? async changed =>
                {
                    currentPlaybackItem = changed;
                    await _store.AddRecentChannelAsync(changed.Key);
                }
                : null,
            favoriteResolver: item.Kind == "live" ? changed => changed.Favorite : null,
            epgResolver: item.Kind == "live" ? GetLiveNowNextTextAsync : null,
            favorite: item.Favorite,
            toggleFavorite: async () =>
            {
                await _store.ToggleFavoriteAsync(currentPlaybackItem);
                return currentPlaybackItem.Favorite;
            });
    }

    private async Task PlayEpisodeAsync(StreamItem series, EpisodeItem episode, IReadOnlyList<EpisodeItem> episodes)
    {
        if (_activeProvider is null) return;
        var key = episode.Key;
        var resume = 0L;
        var episodeState = _store.WatchState(key);
        if (episodeState is not null && !episodeState.Completed && episodeState.PositionMs > 30_000)
            resume = episodeState.PositionMs;
        var url = _catalog!.Xtream(_activeProvider).EpisodeUrl(_activeProvider, episode);

        Func<Task>? nextAction = null;
        var ordered = episodes.OrderBy(e => e.Season).ThenBy(e => e.Episode).ToList();
        var currentIndex = ordered.FindIndex(e => e.Key == episode.Key);
        var previousEpisode = currentIndex > 0 ? ordered[currentIndex - 1] : null;
        var nextEpisode = currentIndex >= 0 && currentIndex + 1 < ordered.Count ? ordered[currentIndex + 1] : null;

        Func<Task>? previousManual = previousEpisode is null
            ? null
            : async () => await PlayEpisodeAsync(series, previousEpisode, episodes);
        Func<Task>? nextManual = nextEpisode is null
            ? null
            : async () => await PlayEpisodeAsync(series, nextEpisode, episodes);

        if (nextEpisode is not null && _store.State.Settings.AutoNext != "off")
        {
            nextAction = async () =>
            {
                if (_store.State.Settings.AutoNext == "ask")
                {
                    var yes = MessageBox.Show(this,
                        "تشغيل الحلقة التالية؟\nS" + nextEpisode.Season + "E" + nextEpisode.Episode + " • " + nextEpisode.Title,
                        "BLOFY PLAYER", MessageBoxButton.YesNo) == MessageBoxResult.Yes;
                    if (!yes) return;
                }
                await PlayEpisodeAsync(series, nextEpisode, episodes);
            };
        }

        await ShowPlayerOverlayAsync(
            series.Name + " • S" + episode.Season + "E" + episode.Episode,
            url,
            resumePositionMs: resume,
            recoveryUrls: BuildEpisodeCandidates(episode),
            savePosition: async (pos, len) => await _store.SaveWatchStateAsync(key, pos, len),
            previousAction: previousManual,
            nextAction: nextManual,
            onEnded: nextAction);
    }

    private async Task<ProviderDetails?> GetProviderDetailsCachedAsync(StreamItem item)
    {
        if (_detailsCache.TryGetValue(item.Key, out var cached)) return cached;
        if (_activeProvider is null || _catalog is null || _activeProvider.ProviderType != "xtream")
            return null;

        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        var details = await _catalog.Xtream(_activeProvider)
            .GetDetailsAsync(_activeProvider, item, timeout.Token);
        _detailsCache[item.Key] = details;
        return details;
    }

    private async Task<List<EpisodeItem>> GetEpisodesCachedAsync(StreamItem series, CancellationToken ct)
    {
        if (_episodesCache.TryGetValue(series.Key, out var cached))
            return cached;
        if (_activeProvider is null || _catalog is null || _activeProvider.ProviderType != "xtream")
            return [];

        var episodes = await _catalog.Xtream(_activeProvider)
            .GetEpisodesAsync(_activeProvider, series.RemoteId, ct);
        episodes = episodes
            .OrderBy(x => x.Season)
            .ThenBy(x => x.Episode)
            .ToList();
        _episodesCache[series.Key] = episodes;
        return episodes;
    }

    private IReadOnlyList<string> BuildStreamCandidates(StreamItem item)
    {
        if (_activeProvider is null || _catalog is null) return Array.Empty<string>();

        var urls = new List<string>();
        void Add(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return;
            if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)) return;
            if (uri.Scheme is not ("http" or "https")) return;
            if (urls.Any(x => x.Equals(value.Trim(), StringComparison.OrdinalIgnoreCase))) return;
            urls.Add(value.Trim());
        }

        if (_activeProvider.ProviderType == "m3u")
        {
            Add(item.DirectSource);
            return urls;
        }

        var xtream = _catalog.Xtream(_activeProvider);
        if (item.Kind == "live")
        {
            var preferred = _store.State.Settings.LiveFormat == "m3u8" ? "m3u8" : "ts";
            var alternate = preferred == "ts" ? "m3u8" : "ts";
            Add(xtream.StreamUrl(_activeProvider, item, preferred));
            Add(item.DirectSource);
            Add(xtream.StreamUrl(_activeProvider, item, alternate));
        }
        else
        {
            Add(item.DirectSource);
            Add(xtream.StreamUrl(_activeProvider, item, _store.State.Settings.LiveFormat));
        }
        return urls;
    }

    private IReadOnlyList<string> BuildEpisodeCandidates(EpisodeItem episode)
    {
        if (_activeProvider is null || _catalog is null) return Array.Empty<string>();
        var urls = new List<string>();
        void Add(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return;
            if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)) return;
            if (uri.Scheme is not ("http" or "https")) return;
            if (urls.Any(x => x.Equals(value.Trim(), StringComparison.OrdinalIgnoreCase))) return;
            urls.Add(value.Trim());
        }

        Add(episode.DirectSource);
        Add(_catalog.Xtream(_activeProvider).EpisodeUrl(_activeProvider, episode));
        return urls;
    }

    private void ShowCollections()
    {
        DisposePreview();
        PageTitle.Text = "المجموعات";
        PageSubtitle.Text = "مختارات BLOFY";
        var root = Vertical();

        var top = _viewIndex.Collection("top").Where(_store.IsContentVisible).Take(24).ToList();
        var latest = _viewIndex.Collection("latest").Where(_store.IsContentVisible).Take(24).ToList();
        var arabic = _viewIndex.Collection("arabic").Where(_store.IsContentVisible).Take(24).ToList();
        var ultra = _viewIndex.Collection("4k").Where(_store.IsContentVisible).Take(24).ToList();

        if (top.Count > 0) root.Children.Add(ContentRow("أعلى تقييم", top));
        if (latest.Count > 0) root.Children.Add(ContentRow("أضيف حديثًا", latest));
        if (arabic.Count > 0) root.Children.Add(ContentRow("مختارات عربية", arabic));
        if (ultra.Count > 0) root.Children.Add(ContentRow("4K • UHD", ultra));

        if (root.Children.Count == 0)
        {
            ContentHost.Content = EmptyState("لا توجد مجموعات جاهزة", "حدّث المكتبة ثم حاول مرة أخرى.");
            return;
        }

        ContentHost.Content = new ScrollViewer
        {
            Content = root,
            VerticalScrollBarVisibility = ScrollBarVisibility.Hidden
        };
    }

    private void ShowFavorites()
    {
        DisposePreview();
        PageTitle.Text = "المفضلة";
        var items = _store.ActiveLibrary().Favorites
            .Select(key => _viewIndex.Find(key))
            .Where(i => i is not null && _store.IsContentVisible(i))
            .Cast<StreamItem>()
            .ToList();
        if (items.Count == 0)
        {
            ContentHost.Content = EmptyState("المفضلة فارغة", "اضغط ☆ في تفاصيل الفيلم أو المسلسل لإضافته.");
            return;
        }
        var compactCatalog = _store.State.Settings.CatalogDensity == "compact";
        var posterWidth = compactCatalog ? 138 : 160;
        var posterCellHeight = (int)Math.Round((posterWidth - 18) * 1.5) + 84;
        var wrap = new WrapPanel
        {
            Orientation = Orientation.Horizontal,
            ItemWidth = posterWidth + 22,
            ItemHeight = posterCellHeight
        };
        foreach (var item in items.Take(compactCatalog ? 84 : 60))
            wrap.Children.Add(ContentCard(item, posterWidth));
        ContentHost.Content = new ScrollViewer { Content = wrap, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
    }

    private static string NormalizeSearch(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        var text = value.Trim().ToLowerInvariant()
            .Replace("أ", "ا")
            .Replace("إ", "ا")
            .Replace("آ", "ا")
            .Replace("ى", "ي")
            .Replace("ؤ", "و")
            .Replace("ئ", "ي")
            .Replace("ة", "ه")
            .Replace("ـ", "");

        var chars = text.Where(ch =>
            ch is not ('َ' or 'ً' or 'ُ' or 'ٌ' or 'ِ' or 'ٍ' or 'ْ' or 'ّ')).ToArray();

        return new string(chars)
            .Replace("  ", " ")
            .Trim();
    }

    private void ShowSearch()
    {
        DisposePreview();
        PageTitle.Text = "البحث الشامل";
        PageSubtitle.Text = "كل الأفلام والمسلسلات والقنوات • بدون حد 12 نتيجة";

        // Grid's star-sized content area lets results genuinely scroll instead
        // of allowing a StackPanel to extend beyond the bottom of the window.
        var root = new Grid();
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var heading = Vertical(0, 0, 0, 10);
        heading.Children.Add(Txt("ابحث عن فيلم أو مسلسل أو قناة", 18, Text, FontWeights.Bold, 0, 0, 0, 7));
        var search = new TextBox
        {
            Height = 48,
            FontSize = 18,
            ToolTip = "بحث فوري في جميع أقسام مكتبتك، بالاسم العربي أو الإنجليزي"
        };
        heading.Children.Add(search);
        _activeBrowserSearch = search;
        var recent = _store.ActiveLibrary().RecentSearches.Take(6).ToList();
        if (recent.Count > 0)
            heading.Children.Add(Txt("آخر عمليات البحث: " + string.Join("  •  ", recent), 11, Muted, marginTop: 7));
        root.Children.Add(heading);

        var filters = Horizontal(0, 3, 0, 10);
        Grid.SetRow(filters, 1);
        root.Children.Add(filters);

        var scroll = new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            PanningMode = PanningMode.VerticalOnly
        };
        var wrap = new WrapPanel { Orientation = Orientation.Horizontal, ItemWidth = 182, ItemHeight = 294 };
        scroll.Content = wrap;
        search.PreviewKeyDown += (_, e) =>
        {
            if (e.Key is not (Key.Down or Key.Enter)) return;
            if (wrap.Children.OfType<Button>().FirstOrDefault() is not Button first) return;
            first.Focus();
            first.BringIntoView();
            e.Handled = true;
        };
        Grid.SetRow(scroll, 2);
        root.Children.Add(scroll);

        IReadOnlyList<StreamItem> matched = [];
        IReadOnlyList<StreamItem> displayed = [];
        var rendered = 0;
        const int batch = 36;
        bool adding = false;
        Button more = null!;
        var footer = Horizontal(0, 12, 0, 0);
        var status = Txt("ابدأ بالكتابة للبحث في المكتبة كاملة", 12, Muted, marginTop: 9);
        more = Action("↓ عرض نتائج إضافية", false, (_, _) => AppendMore(true), 0, 0, 15, 0);
        more.MinWidth = 175;
        footer.Children.Add(more);
        footer.Children.Add(status);
        Grid.SetRow(footer, 3);
        root.Children.Add(footer);

        string activeKind = "all";
        CancellationTokenSource? request = null;
        var filterButtons = new Dictionary<string, Button>();

        void RefreshTabs()
        {
            foreach (var (kind, button) in filterButtons)
            {
                var selected = kind == activeKind;
                button.Background = selected ? Accent : Surface2;
                button.Foreground = selected ? Bg : Text;
                button.BorderBrush = selected ? Accent : Brush("#665E437A");
            }
        }

        void AppendMore(bool focusFirst = false)
        {
            if (adding || rendered >= displayed.Count) return;
            adding = true;
            var firstIndex = rendered;
            var lastIndex = Math.Min(rendered + batch, displayed.Count);
            for (var i = firstIndex; i < lastIndex; i++)
            {
                var card = ContentCard(displayed[i], 160);
                card.ToolTip = (displayed[i].Kind switch
                {
                    "movie" => "فيلم",
                    "series" => "مسلسل",
                    _ => "قناة"
                }) + " • " + displayed[i].Name;
                wrap.Children.Add(card);
            }
            rendered = lastIndex;
            more.Visibility = rendered < displayed.Count ? Visibility.Visible : Visibility.Collapsed;
            status.Text = "عرض " + rendered.ToString("N0") + " من " + displayed.Count.ToString("N0") + " نتيجة";
            adding = false;
            if (focusFirst && lastIndex > firstIndex)
                _ = Dispatcher.BeginInvoke(() =>
                {
                    if (!ReferenceEquals(ContentHost.Content, root)) return;
                    if (wrap.Children[firstIndex] is Button first) { first.Focus(); first.BringIntoView(); }
                });
        }

        void ShowMatching()
        {
            displayed = activeKind == "all"
                ? matched
                : matched.Where(item => item.Kind == activeKind).ToList();
            rendered = 0;
            wrap.Children.Clear();
            scroll.ScrollToTop();
            more.Visibility = Visibility.Collapsed;
            if (displayed.Count > 0)
                AppendMore();
            else
                status.Text = search.Text.Trim().Length == 0
                    ? "ابدأ بالكتابة للبحث في المكتبة كاملة"
                    : "لا توجد نتائج في هذا القسم";
        }

        foreach (var (kind, label) in new[]
        {
            ("all", "الكل"), ("movie", "الأفلام"),
            ("series", "المسلسلات"), ("live", "القنوات")
        })
        {
            var key = kind;
            var button = Action(label, false, (_, _) =>
            {
                activeKind = key;
                RefreshTabs();
                ShowMatching();
            }, 0, 0, 10, 0);
            button.MinWidth = 112;
            filterButtons.Add(key, button);
            filters.Children.Add(button);
        }
        RefreshTabs();

        scroll.ScrollChanged += (_, e) =>
        {
            if (e.ExtentHeightChange == 0 && e.VerticalChange == 0) return;
            if (rendered < displayed.Count &&
                scroll.ScrollableHeight - scroll.VerticalOffset < Math.Max(450, scroll.ViewportHeight * .6))
                AppendMore();
        };
        scroll.PreviewKeyDown += (_, e) =>
        {
            if (e.Key is Key.PageDown or Key.End) AppendMore();
        };

        search.TextChanged += (_, _) =>
        {
            request?.Cancel();
            var current = new CancellationTokenSource();
            request = current;
            _ = SearchAsync(current);
        };

        async Task SearchAsync(CancellationTokenSource current)
        {
            var token = current.Token;
            try
            {
                await Task.Delay(180, token);
                var q = NormalizeSearch(search.Text);
                if (q.Length == 0)
                {
                    if (ReferenceEquals(request, current) && ReferenceEquals(ContentHost.Content, root))
                    {
                        matched = [];
                        ShowMatching();
                    }
                    return;
                }

                status.Text = "جاري البحث عن «" + search.Text.Trim() + "» في جميع الفئات…";
                // Scan the full locally cached catalog in the background; no
                // misleading "top 12" cutoff and no blocking the WPF dispatcher.
                var movies = Items("movie");
                var series = Items("series");
                var live = Items("live");
                var hits = await Task.Run(() =>
                {
                    var exactPrefix = new List<StreamItem>();
                    var remaining = new List<StreamItem>();
                    foreach (var collection in new[] { movies, series, live })
                    {
                        foreach (var item in collection)
                        {
                            token.ThrowIfCancellationRequested();
                            var name = NormalizeSearch(item.Name);
                            if (name.StartsWith(q, StringComparison.Ordinal)) exactPrefix.Add(item);
                            else if (name.Contains(q, StringComparison.Ordinal)) remaining.Add(item);
                        }
                    }
                    exactPrefix.AddRange(remaining);
                    return exactPrefix;
                }, token);

                if (!token.IsCancellationRequested && ReferenceEquals(request, current) &&
                    ReferenceEquals(ContentHost.Content, root))
                {
                    matched = hits;
                    ShowMatching();
                }
            }
            catch (OperationCanceledException) { }
            finally
            {
                if (ReferenceEquals(request, current)) request = null;
                current.Dispose();
            }
        }

        search.KeyDown += async (_, e) =>
        {
            if (e.Key != Key.Enter || search.Text.Trim().Length == 0) return;
            await _store.AddRecentSearchAsync(search.Text);
        };

        ContentHost.Content = root;
        search.Focus();
    }

    private void ShowProfiles()
    {
        DisposePreview();
        PageTitle.Text = "الملفات الشخصية";
        var root = Vertical();
        var active = _store.ActiveProfile();

        root.Children.Add(Txt("كل ملف له مفضلته وسجل مشاهدته وإعداداته الخاصة بالمحتوى.", 12, Muted, marginBottom: 16));

        foreach (var profile in _store.State.Profiles.OrderBy(p => p.CreatedAt))
        {
            var card = Card(0, 0, 0, 12);
            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition());
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var info = Vertical();
            var badges = profile.Kids ? " • أطفال" : profile.Guest ? " • ضيف" : "";
            if (!string.IsNullOrWhiteSpace(profile.PinHash)) badges += " • PIN";
            info.Children.Add(Txt(profile.Name + (profile.Id == active.Id ? "  ✓" : ""), 18, Text, FontWeights.Bold));
            info.Children.Add(Txt("ملف BLOFY" + badges, 11, profile.Id == active.Id ? Accent : Muted, marginTop: 4));
            grid.Children.Add(info);

            var actions = Horizontal();
            actions.Children.Add(Action(profile.Id == active.Id ? "الحالي" : "فتح", profile.Id != active.Id, async (_, _) =>
            {
                if (profile.Id == _store.ActiveProfile().Id) return;
                string? pin = null;
                if (!string.IsNullOrWhiteSpace(profile.PinHash))
                {
                    pin = UiDialogs.Prompt(this, "رمز PIN", "أدخل رمز PIN لهذا الملف", password: true);
                    if (pin is null) return;
                }
                if (!await _store.SelectProfileAsync(profile.Id, pin))
                {
                    MessageBox.Show(this, "رمز PIN غير صحيح.", "BLOFY PLAYER");
                    return;
                }

                UpdateProfileLabel();
                _catalog?.Snapshot.Streams.ToList().ForEach(x => x.Favorite = false);
                if (_catalog is not null) _store.ApplyFavoriteState(_catalog.Snapshot.Streams);
                _currentPage = "home";
                ShowHome();
            }));

            actions.Children.Add(Action("PIN", false, async (_, _) =>
            {
                var pin = UiDialogs.Prompt(this, "PIN", "أدخل PIN جديد من 4 إلى 8 أرقام، أو اتركه فارغًا للإزالة", password: true);
                if (pin is null) return;
                try
                {
                    await _store.SetProfilePinAsync(profile.Id, string.IsNullOrWhiteSpace(pin) ? null : pin);
                    ShowProfiles();
                }
                catch (Exception ex) { MessageBox.Show(this, ex.Message, "BLOFY PLAYER"); }
            }, 8));

            if (_store.State.Profiles.Count > 1)
                actions.Children.Add(Action("حذف", false, async (_, _) =>
                {
                    if (!UiDialogs.Confirm(this, "حذف الملف", "حذف «" + profile.Name + "» وكل مفضلته وسجله؟")) return;
                    await _store.DeleteProfileAsync(profile.Id);
                    UpdateProfileLabel();
                    ShowProfiles();
                }, 8));

            Grid.SetColumn(actions, 1);
            grid.Children.Add(actions);
            card.Child = grid;
            root.Children.Add(card);
        }

        var create = Horizontal(0, 8, 0, 0);
        create.Children.Add(Action("+ ملف", true, async (_, _) =>
        {
            var name = UiDialogs.Prompt(this, "ملف جديد", "اسم الملف");
            if (string.IsNullOrWhiteSpace(name)) return;
            try { await _store.CreateProfileAsync(name); ShowProfiles(); }
            catch (Exception ex) { MessageBox.Show(this, ex.Message, "BLOFY PLAYER"); }
        }));
        create.Children.Add(Action("+ أطفال", false, async (_, _) =>
        {
            var name = UiDialogs.Prompt(this, "ملف أطفال", "اسم ملف الأطفال", initial: "أطفال");
            if (string.IsNullOrWhiteSpace(name)) return;
            try { await _store.CreateProfileAsync(name, kids: true); ShowProfiles(); }
            catch (Exception ex) { MessageBox.Show(this, ex.Message, "BLOFY PLAYER"); }
        }, 8));
        create.Children.Add(Action("+ ضيف", false, async (_, _) =>
        {
            try { await _store.CreateProfileAsync("ضيف", guest: true); ShowProfiles(); }
            catch (Exception ex) { MessageBox.Show(this, ex.Message, "BLOFY PLAYER"); }
        }, 8));
        root.Children.Add(create);

        ContentHost.Content = new ScrollViewer { Content = root, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
    }

    private void ShowProviders()
    {
        DisposePreview();
        PageTitle.Text = "القوائم والسيرفرات";
        var root = new Grid();
        root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(330) });
        root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(18) });
        root.ColumnDefinitions.Add(new ColumnDefinition());

        var left = Vertical();
        var list = new ListBox
        {
            Height = 430,
            Style = Application.Current.FindResource("TvListBox") as Style
        };
        VirtualizingPanel.SetIsVirtualizing(list, true);
        VirtualizingPanel.SetVirtualizationMode(list, VirtualizationMode.Recycling);
        ScrollViewer.SetCanContentScroll(list, true);
        foreach (var provider in _store.State.Providers.OrderByDescending(p => p.Active).ThenByDescending(p => p.UpdatedAt))
            list.Items.Add(provider);
        list.DisplayMemberPath = "Name";
        if (list.Items.Count > 0) list.SelectedIndex = 0;
        left.Children.Add(list);

        var add = Action("+ قائمة جديدة", true, (_, _) => list.SelectedItem = null, 0, 10, 0, 0);
        left.Children.Add(add);
        root.Children.Add(left);

        var formCard = Card();
        Grid.SetColumn(formCard, 2);
        root.Children.Add(formCard);
        var form = Vertical();
        form.Children.Add(Txt("إضافة / تعديل قائمة", 22, Text, FontWeights.Bold));

        var type = new ComboBox { Margin = new Thickness(0, 14, 0, 0) };
        type.Items.Add("Xtream Codes");
        type.Items.Add("M3U / M3U8");
        type.Items.Add("مشترك BLOFY");
        type.SelectedIndex = 0;
        form.Children.Add(Labeled("النوع", type));

        var name = new TextBox();
        var url = new TextBox { FlowDirection = FlowDirection.LeftToRight };
        var username = new TextBox { FlowDirection = FlowDirection.LeftToRight };
        var password = new PasswordBox { FlowDirection = FlowDirection.LeftToRight };
        var m3u = new TextBox { FlowDirection = FlowDirection.LeftToRight };

        form.Children.Add(Labeled("الاسم", name));
        form.Children.Add(Labeled("رابط السيرفر", url));
        form.Children.Add(Labeled("اسم المستخدم", username));
        form.Children.Add(Labeled("كلمة المرور", password));
        form.Children.Add(Labeled("رابط/مسار M3U", m3u));
        form.Children.Add(Txt("في «مشترك BLOFY» تجاهل رابط السيرفر وM3U؛ أدخل اسم المستخدم وكلمة المرور فقط.",
            11, Muted, marginTop: 8));

        ProviderAccount? editing = null;
        list.SelectionChanged += (_, _) =>
        {
            editing = list.SelectedItem as ProviderAccount;
            if (editing is null)
            {
                name.Text = url.Text = username.Text = m3u.Text = "";
                password.Password = "";
                type.SelectedIndex = 0;
                return;
            }
            name.Text = editing.Name;
            m3u.Text = editing.M3uUrl;
            var managed = !string.IsNullOrWhiteSpace(editing.SubscriberToken);
            type.SelectedIndex = editing.ProviderType == "m3u" ? 1 : managed ? 2 : 0;
            if (managed)
            {
                // Never expose resolved upstream credentials in the UI. Re-enter BLOFY subscriber
                // credentials only when intentionally changing the managed account.
                url.Text = "";
                username.Text = "";
                password.Password = "";
            }
            else
            {
                url.Text = editing.BaseUrl;
                username.Text = editing.Username;
                password.Password = editing.Password;
            }
        };

        var buttons = Horizontal(0, 18, 0, 0);
        buttons.Children.Add(Action("حفظ واتصال", true, async (_, _) =>
        {
            var isM3u = type.SelectedIndex == 1;
            var isSubscriber = type.SelectedIndex == 2;
            var provider = editing ?? new ProviderAccount();
            provider.Active = true;
            provider.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            if (isSubscriber)
            {
                if (_activationState?.CanUse() != true)
                {
                    MessageBox.Show(this, "فعّل جهاز BLOFY أولًا قبل تسجيل مشترك BLOFY.", "BLOFY PLAYER");
                    return;
                }
                if (string.IsNullOrWhiteSpace(username.Text) || string.IsNullOrWhiteSpace(password.Password))
                {
                    MessageBox.Show(this, "أدخل اسم المستخدم وكلمة المرور لمشترك BLOFY.", "BLOFY PLAYER");
                    return;
                }

                try
                {
                    using var subscriber = new BlofySubscriberService();
                    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
                    var session = await subscriber.CreateSessionAsync(
                        _identity, username.Text.Trim(), password.Password, timeout.Token);

                    if (editing is null && Guid.TryParse(session.ProviderId, out _))
                        provider.Id = session.ProviderId;

                    provider.Name = string.IsNullOrWhiteSpace(name.Text) ? session.ProviderName : name.Text.Trim();
                    provider.ProviderType = "xtream";
                    provider.BaseUrl = session.BaseUrl;
                    provider.Username = session.Username;
                    provider.Password = session.Password;
                    provider.SubscriberToken = session.SessionToken;
                    provider.M3uUrl = "";
                }
                catch (Exception ex)
                {
                    MessageBox.Show(this, ex.Message, "BLOFY PLAYER");
                    return;
                }
            }
            else if (!isM3u)
            {
                provider.Name = string.IsNullOrWhiteSpace(name.Text) ? "BLOFY Server" : name.Text.Trim();
                provider.ProviderType = "xtream";
                provider.BaseUrl = url.Text.Trim();
                provider.Username = username.Text.Trim();
                provider.Password = password.Password;
                provider.SubscriberToken = "";
                provider.M3uUrl = "";

                if (!Uri.TryCreate(provider.BaseUrl, UriKind.Absolute, out _) ||
                    string.IsNullOrWhiteSpace(provider.Username) || string.IsNullOrWhiteSpace(provider.Password))
                {
                    MessageBox.Show(this, "أدخل رابط السيرفر واسم المستخدم وكلمة المرور.", "BLOFY PLAYER");
                    return;
                }
                try
                {
                    using var xtream = new XtreamService(_store.State.Settings.UserAgent);
                    if (!await xtream.AuthenticateAsync(provider))
                    {
                        MessageBox.Show(this, "بيانات Xtream غير صحيحة أو الحساب غير نشط.", "BLOFY PLAYER");
                        return;
                    }
                }
                catch (Exception ex)
                {
                    MessageBox.Show(this, "تعذر الاتصال بالسيرفر: " + ex.Message, "BLOFY PLAYER");
                    return;
                }
            }
            else
            {
                provider.Name = string.IsNullOrWhiteSpace(name.Text) ? "BLOFY M3U" : name.Text.Trim();
                provider.ProviderType = "m3u";
                provider.BaseUrl = "";
                provider.Username = "";
                provider.Password = "";
                provider.SubscriberToken = "";
                provider.M3uUrl = m3u.Text.Trim();
                if (string.IsNullOrWhiteSpace(provider.M3uUrl))
                {
                    MessageBox.Show(this, "أدخل رابط أو مسار M3U.", "BLOFY PLAYER");
                    return;
                }
            }

            foreach (var p in _store.State.Providers) p.Active = false;
            if (editing is null) _store.State.Providers.Add(provider);
            _store.State.ActiveProviderId = provider.Id;
            await _store.SaveAsync();

            if (!isM3u)
                try { await _portal.SaveAsync(_identity, provider); } catch { }

            _activeProvider = provider;
            editing = provider;
            await SyncCatalogAsync(true);
            ShowProviders();
        }));

        buttons.Children.Add(Action("حذف", false, async (_, _) =>
        {
            if (editing is null) return;
            var delete = editing;
            if (MessageBox.Show(this, "حذف القائمة «" + delete.Name + "»؟", "BLOFY PLAYER",
                MessageBoxButton.YesNo) != MessageBoxResult.Yes) return;
            _store.State.Providers.RemoveAll(p => p.Id == delete.Id);
            if (_store.State.ActiveProviderId == delete.Id)
                _store.State.ActiveProviderId = _store.State.Providers.FirstOrDefault()?.Id ?? "";
            await _store.SaveAsync();
            if (delete.ProviderType == "xtream")
                try { await _portal.DeleteAsync(_identity, delete.Id); } catch { }
            _activeProvider = _store.ActiveProvider();
            ShowProviders();
        }, 10));
        form.Children.Add(buttons);
        formCard.Child = new ScrollViewer { Content = form, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };

        list.PreviewKeyDown += (_, e) =>
        {
            if (e.Key is not Key.Enter and not Key.Space) return;
            if (list.SelectedItem is null)
            {
                add.Focus();
            }
            else
            {
                name.Focus();
                name.SelectAll();
            }
            e.Handled = true;
        };

        ContentHost.Content = root;
        _ = Dispatcher.BeginInvoke(() =>
        {
            if (list.Items.Count > 0) FocusSelectedListItem(list);
            else add.Focus();
        });
    }

    private void ShowHomePersonalization()
    {
        DisposePreview();
        PageTitle.Text = "تخصيص الرئيسية";
        var root = Vertical();
        root.Children.Add(Txt("رتّب الأقسام أو أخفِ ما لا تحتاجه. الإعداد يخص الملف الحالي.", 12, Muted, marginBottom: 14));

        var labels = new Dictionary<string, string>
        {
            ["continue"] = "متابعة المشاهدة",
            ["latest_movies"] = "أحدث الأفلام",
            ["latest_series"] = "أحدث المسلسلات"
        };

        void Rebuild()
        {
            root.Children.Clear();
            root.Children.Add(Txt("رتّب الأقسام أو أخفِ ما لا تحتاجه. الإعداد يخص الملف الحالي.", 12, Muted, marginBottom: 14));
            var visible = _store.HomeRows.ToList();

            foreach (var key in labels.Keys)
            {
                var card = Card(0, 0, 0, 10);
                var grid = new Grid();
                grid.ColumnDefinitions.Add(new ColumnDefinition());
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                var check = new CheckBox
                {
                    Content = labels[key],
                    IsChecked = visible.Contains(key),
                    Foreground = Text,
                    FontSize = 13,
                    VerticalAlignment = VerticalAlignment.Center
                };
                check.Click += async (_, _) =>
                {
                    await _store.SetHomeRowEnabledAsync(key, check.IsChecked == true);
                    Rebuild();
                };
                grid.Children.Add(check);

                var actions = Horizontal();
                var up = Action("↑", false, async (_, _) => { await _store.MoveHomeRowAsync(key, -1); Rebuild(); });
                var down = Action("↓", false, async (_, _) => { await _store.MoveHomeRowAsync(key, 1); Rebuild(); }, 6);
                up.IsEnabled = visible.Contains(key);
                down.IsEnabled = visible.Contains(key);
                actions.Children.Add(up);
                actions.Children.Add(down);
                Grid.SetColumn(actions, 1);
                grid.Children.Add(actions);
                card.Child = grid;
                root.Children.Add(card);
            }

            root.Children.Add(Action("استعادة الترتيب الافتراضي", false, async (_, _) =>
            {
                foreach (var key in labels.Keys) await _store.SetHomeRowEnabledAsync(key, false);
                foreach (var key in new[] { "continue", "latest_movies", "latest_series" })
                    await _store.SetHomeRowEnabledAsync(key, true);
                Rebuild();
            }, 0, 10, 0, 0));
        }

        Rebuild();
        ContentHost.Content = new ScrollViewer { Content = root, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
    }

    private void ShowCategoryManager()
    {
        DisposePreview();
        PageTitle.Text = "إدارة الفئات";
        var root = Vertical();
        root.Children.Add(Txt("إخفاء الفئات هنا يخص الملف الحالي فقط.", 12, Muted, marginBottom: 12));

        var kindChoice = new ComboBox { MinWidth = 220 };
        kindChoice.Items.Add(new ComboItem("البث المباشر", "live"));
        kindChoice.Items.Add(new ComboItem("الأفلام", "movie"));
        kindChoice.Items.Add(new ComboItem("المسلسلات", "series"));
        kindChoice.DisplayMemberPath = "Label";
        kindChoice.SelectedIndex = 0;
        root.Children.Add(Labeled("القسم", kindChoice));

        var list = Vertical(0, 14, 0, 0);
        root.Children.Add(list);

        void Rebuild()
        {
            list.Children.Clear();
            var kind = (kindChoice.SelectedItem as ComboItem)?.Value ?? "live";
            var categories = (_catalog?.Snapshot.Categories ?? []).Where(x => x.Kind == kind).ToList();
            if (categories.Count == 0)
            {
                list.Children.Add(Txt("لا توجد فئات محمّلة.", 12, Muted));
                return;
            }

            foreach (var category in categories)
            {
                var check = new CheckBox
                {
                    Content = category.Name,
                    IsChecked = !_store.IsCategoryHidden(kind, category.RemoteId),
                    Foreground = Text,
                    Margin = new Thickness(0, 6, 0, 6),
                    FontSize = 13
                };
                check.Click += async (_, _) =>
                    await _store.SetCategoryHiddenAsync(kind, category.RemoteId, check.IsChecked != true);
                list.Children.Add(check);
            }
        }

        kindChoice.SelectionChanged += (_, _) => Rebuild();
        Rebuild();

        root.Children.Add(Action("إظهار جميع فئات القسم", false, async (_, _) =>
        {
            var kind = (kindChoice.SelectedItem as ComboItem)?.Value ?? "live";
            foreach (var category in (_catalog?.Snapshot.Categories ?? []).Where(x => x.Kind == kind))
                await _store.SetCategoryHiddenAsync(kind, category.RemoteId, false);
            Rebuild();
        }, 0, 16, 0, 0));

        ContentHost.Content = new ScrollViewer { Content = root, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
    }

    private void ShowSubscriptionSummary()
    {
        var status = _activationState?.Status?.ToLowerInvariant() switch
        {
            "active" => "مفعّل",
            "trial" => "تجربة",
            "expired" => "منتهي",
            "blocked" => "موقوف",
            _ => "غير معروف"
        };

        var expiry = "بدون تاريخ محدد";
        if (_activationState?.ExpiresAt is long value)
        {
            var date = value > 10_000_000_000
                ? DateTimeOffset.FromUnixTimeMilliseconds(value)
                : DateTimeOffset.FromUnixTimeSeconds(value);
            expiry = date.ToLocalTime().ToString("yyyy/MM/dd HH:mm");
        }

        MessageBox.Show(this,
            "الحالة: " + status + Environment.NewLine +
            "الصلاحية حتى: " + expiry + Environment.NewLine +
            "رقم الجهاز: " + _identity.DeviceId,
            "باقتي • BLOFY PLAYER");
    }

    private void ShowConnectionSummary()
    {
        var provider = _activeProvider;
        var providerText = provider is null
            ? "لا يوجد سيرفر نشط"
            : provider.Name + " • " + (provider.ProviderType == "m3u" ? "M3U" : "Xtream");

        var snapshot = _catalog?.Snapshot;
        var live = snapshot?.Streams.Count(x => x.Kind == "live") ?? 0;
        var movies = snapshot?.Streams.Count(x => x.Kind == "movie") ?? 0;
        var series = snapshot?.Streams.Count(x => x.Kind == "series") ?? 0;

        MessageBox.Show(this,
            "السيرفر: " + providerText + Environment.NewLine +
            "القنوات: " + live.ToString("N0") + Environment.NewLine +
            "الأفلام: " + movies.ToString("N0") + Environment.NewLine +
            "المسلسلات: " + series.ToString("N0"),
            "حالة الاشتراك • BLOFY PLAYER");
    }

    private async Task RestoreDefaultSettingsAsync()
    {
        if (!UiDialogs.Confirm(this, "استعادة الإعدادات", "إرجاع إعدادات التشغيل والواجهة للوضع الافتراضي؟")) return;

        var lastPage = _store.State.Settings.LastPage;
        var language = _store.State.Settings.Language;
        _store.State.Settings = new AppSettings
        {
            LastPage = lastPage,
            Language = language
        };
        await _store.SaveAsync();
        ApplyTheme();
        ShowSettings();
    }

    private void ShowSettings()
    {
        DisposePreview();
        PageTitle.Text = "الإعدادات";
        PageSubtitle.Text = "BLOFY PLAYER";

        var root = Vertical();
        var status = Txt("يتم حفظ الإعدادات عند الضغط على «حفظ التغييرات».", 11, Muted, marginBottom: 8);
        root.Children.Add(status);

        var language = ChoiceControl([
            ("العربية", "ar"), ("English", "en"), ("Français", "fr"), ("Español", "es"),
            ("Deutsch", "de"), ("Türkçe", "tr"), ("Português", "pt"), ("Italiano", "it")
        ], _store.State.Settings.Language);
        var aspect = ChoiceControl([("ملاءمة", "fit"), ("تكبير", "zoom"), ("ملء", "fill")], _store.State.Settings.Aspect);
        var liveFormat = ChoiceControl([("TS", "ts"), ("HLS / M3U8", "m3u8")], _store.State.Settings.LiveFormat);
        var subtitle = ChoiceControl([("العربية أولًا", "ar"), ("تلقائي", "auto"), ("إيقاف", "off")], _store.State.Settings.SubtitleLanguage);
        var subtitleSize = ChoiceControl([("صغير", "small"), ("متوسط", "medium"), ("كبير", "large")], _store.State.Settings.SubtitleSize);
        var audioOutput = ChoiceControl([("تلقائي", "auto"), ("Stereo", "stereo")], _store.State.Settings.AudioOutput);
        var autoNext = ChoiceControl([("اسأل", "ask"), ("تلقائي", "on"), ("إيقاف", "off")], _store.State.Settings.AutoNext);
        var density = ChoiceControl([("مريح", "comfortable"), ("مضغوط", "compact")], _store.State.Settings.CatalogDensity);
        var motion = ChoiceControl([("ناعم", "smooth"), ("مخفض", "reduced")], _store.State.Settings.Motion);

        var autoplay = new CheckBox
        {
            IsChecked = _store.State.Settings.AutoplayLive,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Left
        };
        var resume = new CheckBox
        {
            IsChecked = _store.State.Settings.ResumePrompt,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Left
        };

        root.Children.Add(SettingsSection("عام",
            SettingTile("لغة التطبيق", "لغة واجهة BLOFY PLAYER", language.Control),
            SettingTile("حركة الواجهة", "حركة الفوكس والانتقال بين العناصر", motion.Control),
            SettingActionTile("ترتيب وإخفاء أقسام الرئيسية", "رتّب صفوف Home وأخفِ ما لا تحتاجه", (_, _) => OpenSubpage(ShowHomePersonalization)),
            SettingActionTile("باقتي", "مدة التفعيل وحالة الجهاز الحالية", (_, _) => ShowSubscriptionSummary()),
            SettingActionTile("حالة الاشتراك", "صلاحية المحتوى والسيرفر الحالي", (_, _) => ShowConnectionSummary()),
            SettingActionTile("بيانات الجهاز والباركود", "عرض رقم الجهاز ورمز التفعيل والباركود", (_, _) => OpenSubpage(ShowActivation)),
            SettingActionTile("الملفات الشخصية", "الرئيسي، الأطفال والضيف وPIN", (_, _) =>
            {
                OpenSubpage(() =>
                {
                    _currentPage = "profiles";
                    ShowProfiles();
                });
            })));

        root.Children.Add(SettingsSection("التشغيل",
            SettingTile("أبعاد الصورة", "طريقة عرض الفيديو على الشاشة", aspect.Control),
            SettingTile("حجم عرض البوسترات", "عدد البوسترات الظاهرة وخفة الواجهة", density.Control)));

        root.Children.Add(SettingsSection("البث المباشر",
            SettingTile("تشغيل القناة عند تحديدها", "المعاينة التلقائية للبث المباشر", autoplay),
            SettingTile("صيغة البث", "TS أو HLS حسب السيرفر", liveFormat.Control)));

        root.Children.Add(SettingsSection("الأفلام والمسلسلات",
            SettingTile("متابعة المشاهدة", "السؤال قبل متابعة آخر نقطة", resume),
            SettingTile("الحلقة التالية", "ما يحدث عند انتهاء الحلقة", autoNext.Control)));

        root.Children.Add(SettingsSection("الترجمة والصوت",
            SettingTile("مخرج الصوت", "تلقائي أو Stereo", audioOutput.Control),
            SettingTile("لغة الترجمة", "العربية أولًا أو تلقائي أو إيقاف", subtitle.Control),
            SettingTile("حجم الترجمة", "حجم نص الترجمة أثناء المشاهدة", subtitleSize.Control)));

        root.Children.Add(SettingsSection("القوائم والسيرفرات",
            SettingActionTile("إدارة السيرفرات والقوائم", "تبديل، تعديل ومزامنة السيرفرات", (_, _) => OpenSubpage(ShowProviders)),
            SettingActionTile("ترتيب وإخفاء الفئات", "البث والأفلام والمسلسلات", (_, _) => OpenSubpage(ShowCategoryManager)),
            SettingActionTile("تحديث المحتوى", "إعادة مزامنة المكتبة يدويًا", async (_, _) => await SyncCatalogAsync(true))));

        root.Children.Add(SettingsSection("الحماية",
            SettingActionTile("الحماية الأبوية وPIN", "تعيين أو تغيير رمز فتح المحتوى المقفل", async (_, _) => await ChangeParentalPinAsync()),
            SettingActionTile("إدارة الملفات وPIN", "PIN منفصل لكل ملف شخصي", (_, _) =>
            {
                OpenSubpage(() =>
                {
                    _currentPage = "profiles";
                    ShowProfiles();
                });
            })));

        root.Children.Add(SettingsSection("BLOFY Cloud والنسخ الاحتياطي",
            SettingActionTile("نسخ للسحابة", "حفظ الملف الحالي في BLOFY Cloud", async (_, _) => await CloudBackupAsync()),
            SettingActionTile("استعادة من السحابة", "استرجاع مفضلة وإعدادات الملف الحالي", async (_, _) => await CloudRestoreAsync()),
            SettingActionTile("إنشاء كود ربط", "نقل الملف إلى جهاز BLOFY آخر", async (_, _) => await CreatePairCodeAsync()),
            SettingActionTile("نسخ احتياطي محلي", "تصدير أو استعادة ملف بدون بيانات الدخول", async (_, _) => await ExportBackupAsync()),
            SettingActionTile("استعادة نسخة محلية", "استرجاع النسخة الاحتياطية من ملف", async (_, _) => await RestoreBackupAsync())));

        root.Children.Add(SettingsSection("التحديث وحول التطبيق",
            SettingActionTile("فحص تحديث Windows", "البحث عن إصدار BLOFY PLAYER جديد", async (_, _) => await CheckWindowsUpdateAsync()),
            SettingActionTile("تشخيص BLOFY", "الجهاز والمكتبة وتقرير الدعم", (_, _) => OpenSubpage(ShowDiagnostics)),
            SettingActionTile("تنظيف التخزين المؤقت", "يحذف الكاش فقط ولا يحذف بياناتك", (_, _) => CleanStorage()),
            SettingActionTile("استعادة الإعدادات الافتراضية", "إرجاع خيارات التشغيل والواجهة للوضع الافتراضي", async (_, _) => await RestoreDefaultSettingsAsync())));

        var save = Action("حفظ التغييرات", true, async (_, _) =>
        {
            _store.State.Settings.Theme = "dark";
            _store.State.Settings.Language = language.Value();
            _store.State.Settings.Aspect = aspect.Value();
            _store.State.Settings.LiveFormat = liveFormat.Value();
            _store.State.Settings.SubtitleLanguage = subtitle.Value();
            _store.State.Settings.SubtitleSize = subtitleSize.Value();
            _store.State.Settings.AudioOutput = audioOutput.Value();
            _store.State.Settings.AutoNext = autoNext.Value();
            _store.State.Settings.CatalogDensity = density.Value();
            _store.State.Settings.Motion = motion.Value();
            _store.State.Settings.AutoplayLive = autoplay.IsChecked == true;
            _store.State.Settings.ResumePrompt = resume.IsChecked == true;
            await _store.SaveAsync();
            ApplyTheme();
            status.Text = "تم حفظ الإعدادات ✓";
        }, 0, 18, 0, 8);
        save.Width = 170;
        root.Children.Add(save);
        root.Children.Add(Txt("BLOFY PLAYER Windows • Android UI parity", 10, Muted, marginBottom: 20));

        ContentHost.Content = new ScrollViewer
        {
            Content = root,
            VerticalScrollBarVisibility = ScrollBarVisibility.Hidden
        };
    }

    private UIElement SettingsSection(string title, params UIElement[] cards)
    {
        var section = Vertical(0, 18, 0, 0);
        section.Children.Add(Txt(title, 17, Text, FontWeights.Bold, marginBottom: 8));
        var wrap = new WrapPanel
        {
            Orientation = Orientation.Horizontal,
            FlowDirection = FlowDirection.RightToLeft
        };
        foreach (var card in cards) wrap.Children.Add(card);
        section.Children.Add(wrap);
        return section;
    }

    private UIElement SettingTile(string title, string subtitle, UIElement control)
    {
        var card = new Border
        {
            Width = 430,
            MinHeight = 92,
            Background = new LinearGradientBrush(Brush("#241536").Color, Brush("#160D22").Color, 35),
            BorderBrush = Brush("#52FFFFFF"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(12),
            Padding = new Thickness(15),
            Margin = new Thickness(0, 0, 10, 10)
        };

        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition());
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var text = Vertical();
        text.Children.Add(Txt(title, 13.5, Text, FontWeights.SemiBold));
        text.Children.Add(Txt(subtitle, 10.5, Muted, marginTop: 5));
        grid.Children.Add(text);

        if (control is FrameworkElement fe)
        {
            fe.MinWidth = control is CheckBox ? 28 : 145;
            fe.Margin = new Thickness(14, 0, 0, 0);
            fe.VerticalAlignment = VerticalAlignment.Center;
        }
        Grid.SetColumn(control, 1);
        grid.Children.Add(control);

        card.Child = grid;
        return card;
    }

    private UIElement SettingActionTile(string title, string subtitle, RoutedEventHandler click)
    {
        var button = new Button
        {
            Width = 430,
            MinHeight = 92,
            Background = Brushes.Transparent,
            BorderBrush = Brushes.Transparent,
            Padding = new Thickness(0),
            Margin = new Thickness(0, 0, 10, 10),
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Cursor = Cursors.Hand,
            RenderTransformOrigin = new Point(.5, .5),
            RenderTransform = new ScaleTransform(1, 1)
        };

        var card = new Border
        {
            Background = new LinearGradientBrush(Brush("#241536").Color, Brush("#160D22").Color, 35),
            BorderBrush = Brush("#52FFFFFF"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(12),
            Padding = new Thickness(15)
        };
        var text = Vertical();
        text.Children.Add(Txt(title, 13.5, Text, FontWeights.SemiBold));
        text.Children.Add(Txt(subtitle, 10.5, Muted, marginTop: 5));
        card.Child = text;
        button.Content = card;

        void Focus(bool active)
        {
            card.Background = active
                ? new LinearGradientBrush(Brush("#63408A").Color, Brush("#3D2756").Color, 35)
                : new LinearGradientBrush(Brush("#241536").Color, Brush("#160D22").Color, 35);
            card.BorderBrush = active ? Brush("#EBD8FF") : Brush("#52FFFFFF");
            card.BorderThickness = active ? new Thickness(2) : new Thickness(1);
            if (button.RenderTransform is ScaleTransform scale)
            {
                var factor = active && _store.State.Settings.Motion != "reduced" ? 1.018 : 1;
                scale.ScaleX = factor;
                scale.ScaleY = factor;
            }
        }

        button.GotKeyboardFocus += (_, _) => Focus(true);
        button.LostKeyboardFocus += (_, _) => Focus(false);
        button.MouseEnter += (_, _) => Focus(true);
        button.MouseLeave += (_, _) => Focus(false);
        button.Click += click;
        return button;
    }

    private (ComboBox Control, Func<string> Value) ChoiceControl((string Label, string Value)[] items, string selected)
    {
        var combo = new ComboBox { MinWidth = 145 };
        foreach (var item in items) combo.Items.Add(new ComboItem(item.Label, item.Value));
        combo.DisplayMemberPath = "Label";
        combo.SelectedItem = combo.Items.Cast<ComboItem>().FirstOrDefault(i => i.Value == selected) ?? combo.Items[0];
        return (combo, () => (combo.SelectedItem as ComboItem)?.Value ?? items[0].Value);
    }

    private (UIElement View, Func<string> Value) Choice(string title, (string Label, string Value)[] items, string selected)
    {
        var combo = new ComboBox { MinWidth = 220 };
        foreach (var item in items) combo.Items.Add(new ComboItem(item.Label, item.Value));
        combo.DisplayMemberPath = "Label";
        combo.SelectedItem = combo.Items.Cast<ComboItem>().FirstOrDefault(i => i.Value == selected) ?? combo.Items[0];
        return (Labeled(title, combo), () => (combo.SelectedItem as ComboItem)?.Value ?? items[0].Value);
    }

    private sealed record ComboItem(string Label, string Value);

    private bool EnsureParentalAccess()
    {
        if (!_store.HasParentalPin) return true;
        var pin = UiDialogs.Prompt(this, "الرقابة الأبوية", "أدخل PIN الأبوي", password: true);
        if (pin is null) return false;
        if (_store.VerifyParentalPin(pin)) return true;
        MessageBox.Show(this, "PIN غير صحيح.", "BLOFY PLAYER");
        return false;
    }

    private async Task ChangeParentalPinAsync()
    {
        if (_store.HasParentalPin && !EnsureParentalAccess()) return;
        var pin = UiDialogs.Prompt(this, "PIN الرقابة الأبوية",
            "PIN جديد من 4 إلى 8 أرقام، أو اتركه فارغًا لإزالة PIN", password: true);
        if (pin is null) return;
        try
        {
            await _store.SetParentalPinAsync(string.IsNullOrWhiteSpace(pin) ? null : pin);
            MessageBox.Show(this,
                string.IsNullOrWhiteSpace(pin) ? "تمت إزالة PIN الأبوي." : "تم حفظ PIN الأبوي.",
                "BLOFY PLAYER");
        }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "BLOFY PLAYER"); }
    }

    private void UpdateHeaderClock()
    {
        var now = DateTimeOffset.Now;
        string TimeIn(string id)
        {
            try
            {
                var zone = TimeZoneInfo.FindSystemTimeZoneById(id);
                return TimeZoneInfo.ConvertTime(now, zone).ToString("HH:mm");
            }
            catch { return "--:--"; }
        }

        HeaderClockText.Text = "الرياض " + TimeIn("Arab Standard Time") +
                               "  •  لندن " + TimeIn("GMT Standard Time") +
                               "\nدبي " + TimeIn("Arabian Standard Time") +
                               "  •  نيويورك " + TimeIn("Eastern Standard Time");
    }

    private void UpdateNavigationState()
    {
        foreach (var button in NavigationPanel.Children.OfType<Button>())
        {
            var selected = string.Equals(button.Tag as string, _currentPage, StringComparison.Ordinal);
            button.Background = selected ? Brush("#241536") : Brushes.Transparent;
            button.Foreground = selected ? Accent : Brush("#C9BCD9");
            button.BorderBrush = selected ? Brush("#66FFFFFF") : Brushes.Transparent;
            button.BorderThickness = selected ? new Thickness(1) : new Thickness(0);
        }
    }

    private void UpdateProfileLabel()
    {
        var profile = _store.ActiveProfile();
        ActiveProfileText.Text = profile.Name + (profile.Kids ? " • أطفال" : profile.Guest ? " • ضيف" : "");
    }

    private void ApplyTheme()
    {
        // Android parity mode: the reference Android TV UI is intentionally cinematic-dark.
        // Keep one visual language across Home, browser, details and settings.
        const string background = "#08060D";
        const string surface = "#241536";
        const string surface2 = "#180F23";
        const string sidebar = "#241536";
        const string text = "#F3F4F6";
        const string muted = "#C9BCD9";
        const string accent = "#D0B2FF";
        const string border = "#52FFFFFF";
        const string primaryText = "#08060D";

        Bg.Color = Brush(background).Color;
        Surface.Color = Brush(surface).Color;
        Surface2.Color = Brush(surface2).Color;
        Text.Color = Brush(text).Color;
        Muted.Color = Brush(muted).Color;
        Accent.Color = Brush(accent).Color;

        SetResourceColor("BackgroundBrush", background);
        SetResourceColor("SurfaceBrush", surface);
        SetResourceColor("Surface2Brush", surface2);
        SetResourceColor("SidebarBrush", sidebar);
        SetResourceColor("TextBrush", text);
        SetResourceColor("MutedBrush", muted);
        SetResourceColor("AccentBrush", accent);
        SetResourceColor("BorderBrush", border);
        SetResourceColor("PrimaryTextBrush", primaryText);
        Background = Bg;
    }

    private static void SetResourceColor(string key, string color)
    {
        // WPF may freeze Freezable resources after XAML load. Replacing the resource is safe,
        // while mutating a frozen SolidColorBrush can crash immediately after the window appears.
        Application.Current.Resources[key] = Brush(color);
    }

    private async Task ExportBackupAsync()
    {
        try
        {
            var dialog = new SaveFileDialog
            {
                Title = "تصدير نسخة BLOFY",
                Filter = "BLOFY Backup (*.blofy.json)|*.blofy.json|JSON (*.json)|*.json",
                FileName = "BLOFY-Backup-" + DateTime.Now.ToString("yyyyMMdd-HHmm") + ".blofy.json"
            };
            if (dialog.ShowDialog(this) != true) return;
            await File.WriteAllTextAsync(dialog.FileName, BackupService.Export(_store));
            MessageBox.Show(this, "تم حفظ النسخة الاحتياطية بدون بيانات الدخول.", "BLOFY PLAYER");
        }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "BLOFY PLAYER"); }
    }

    private async Task RestoreBackupAsync()
    {
        try
        {
            var dialog = new OpenFileDialog
            {
                Title = "استعادة نسخة BLOFY",
                Filter = "BLOFY Backup (*.blofy.json;*.json)|*.blofy.json;*.json"
            };
            if (dialog.ShowDialog(this) != true) return;
            var json = await File.ReadAllTextAsync(dialog.FileName);
            await BackupService.RestoreAsync(_store, json);
            ApplyTheme();
            if (_catalog is not null) _store.ApplyFavoriteState(_catalog.Snapshot.Streams);
            MessageBox.Show(this, "تمت الاستعادة.", "BLOFY PLAYER");
            ShowSettings();
        }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "BLOFY PLAYER"); }
    }

    private bool CloudReady()
    {
        if (_activationState?.CanUse() == true) return true;
        MessageBox.Show(this, "يجب أن يكون الجهاز مفعّلًا لاستخدام BLOFY Cloud.", "BLOFY PLAYER");
        return false;
    }

    private async Task CloudBackupAsync()
    {
        if (!CloudReady()) return;
        ProgressText.Text = "حفظ BLOFY Cloud…";
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(18));
            var result = await ProfileCloudService.BackupAsync(_store, _identity, timeout.Token);
            MessageBox.Show(this, "تم حفظ الملف في السحابة. Revision " + result.Revision, "BLOFY PLAYER");
        }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "BLOFY PLAYER"); }
        finally { ProgressText.Text = ""; }
    }

    private async Task CloudRestoreAsync()
    {
        if (!CloudReady()) return;
        if (!UiDialogs.Confirm(this, "استعادة BLOFY Cloud", "استبدال مفضلة وإعدادات الملف الحالي بالنسخة السحابية؟")) return;
        ProgressText.Text = "استعادة BLOFY Cloud…";
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(18));
            var result = await ProfileCloudService.RestoreAsync(_store, _identity, timeout.Token);
            if (result.Action == "no_backup")
            {
                MessageBox.Show(this, "لا توجد نسخة سحابية لهذا الملف.", "BLOFY PLAYER");
                return;
            }
            ApplyTheme();
            if (_catalog is not null) _store.ApplyFavoriteState(_catalog.Snapshot.Streams);
            MessageBox.Show(this, "تمت استعادة BLOFY Cloud.", "BLOFY PLAYER");
            ShowSettings();
        }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "BLOFY PLAYER"); }
        finally { ProgressText.Text = ""; }
    }

    private async Task CreatePairCodeAsync()
    {
        if (!CloudReady()) return;
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            var pair = await ProfileCloudService.CreatePairCodeAsync(_store, _identity, timeout.Token);
            Clipboard.SetText(pair.Code);
            var expiry = pair.ExpiresAt > 10_000_000_000
                ? DateTimeOffset.FromUnixTimeMilliseconds(pair.ExpiresAt)
                : DateTimeOffset.FromUnixTimeSeconds(pair.ExpiresAt);
            MessageBox.Show(this,
                "كود الربط: " + pair.Code + Environment.NewLine +
                "صالح حتى: " + expiry.ToLocalTime().ToString("HH:mm") + Environment.NewLine +
                "تم نسخ الكود للحافظة.",
                "BLOFY Cloud");
        }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "BLOFY PLAYER"); }
    }

    private async Task RestorePairCodeAsync()
    {
        if (!CloudReady()) return;
        var code = UiDialogs.Prompt(this, "استعادة بكود ربط", "أدخل كود BLOFY Cloud", initial: "");
        if (string.IsNullOrWhiteSpace(code)) return;
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(18));
            await ProfileCloudService.RestorePairCodeAsync(_store, _identity, code, timeout.Token);
            ApplyTheme();
            if (_catalog is not null) _store.ApplyFavoriteState(_catalog.Snapshot.Streams);
            MessageBox.Show(this, "تم نقل بيانات الملف من كود الربط.", "BLOFY PLAYER");
            ShowSettings();
        }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "BLOFY PLAYER"); }
    }

    private async Task CheckWindowsUpdateAsync()
    {
        ProgressText.Text = "فحص تحديث Windows…";
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            var update = await WindowsUpdateService.CheckAsync(timeout.Token);
            if (update is null)
            {
                MessageBox.Show(this, "لا يوجد إصدار Windows منشور أحدث حاليًا.", "BLOFY PLAYER");
                return;
            }
            var result = MessageBox.Show(this,
                "الإصدار المنشور: " + update.Version + Environment.NewLine +
                (string.IsNullOrWhiteSpace(update.Notes) ? "" : update.Notes + Environment.NewLine) +
                "فتح صفحة التحميل؟",
                "تحديث BLOFY PLAYER", MessageBoxButton.YesNo);
            if (result == MessageBoxResult.Yes)
                Process.Start(new ProcessStartInfo(update.DownloadUrl) { UseShellExecute = true });
        }
        catch (Exception ex) { MessageBox.Show(this, "تعذر فحص التحديث: " + ex.Message, "BLOFY PLAYER"); }
        finally { ProgressText.Text = ""; }
    }

    private void ShowDiagnostics()
    {
        var report = DiagnosticService.Build(_store, _identity, ActivationStatusText.Text, _catalog?.Snapshot);
        Clipboard.SetText(report);
        MessageBox.Show(this, report + Environment.NewLine + Environment.NewLine + "تم نسخ التقرير للحافظة.",
            "تشخيص BLOFY PLAYER");
    }

    private void CleanStorage()
    {
        var before = DiagnosticService.DirectoryBytes(_store.RootPath);
        var removed = _store.CleanCatalogCache();
        var artworkRemoved = ArtworkCache.Clear();
        var after = DiagnosticService.DirectoryBytes(_store.RootPath);
        MessageBox.Show(this,
            "تم حذف " + removed + " ملفات كتالوج مؤقتة و" + artworkRemoved + " صور مخزنة." + Environment.NewLine +
            "المساحة المحررة: " + DiagnosticService.FormatBytes(Math.Max(0, before - after)) +
            Environment.NewLine + "بيانات الدخول والمفضلة والسجل لم تُحذف.",
            "BLOFY PLAYER");
    }

    private void DisposePreview()
    {
        if (_previewPlayback is null) return;
        try { _previewPlayback.Stop(); } catch { }
        _previewPlayback.Dispose();
        _previewPlayback = null;
    }

    private IReadOnlyList<StreamItem> Items(string kind)
    {
        var items = _viewIndex.Kind(kind);
        if (!_store.IsKidsProfile) return items;
        return items.Where(_store.IsContentVisible).ToList();
    }

    private IReadOnlyList<StreamItem> CategoryItems(string kind, string categoryId)
    {
        var items = _viewIndex.Category(kind, categoryId);
        if (!_store.IsKidsProfile) return items;
        return items.Where(_store.IsContentVisible).ToList();
    }

    private int ItemCount(string kind)
    {
        var items = _viewIndex.Kind(kind);
        if (!_store.IsKidsProfile) return items.Count;
        return items.Count(_store.IsContentVisible);
    }

    private List<StreamItem> LatestItems(string kind, int take)
    {
        var latest = _viewIndex.Latest(kind);
        return latest.Where(_store.IsContentVisible).Take(take).ToList();
    }

    private UIElement ContentRow(string title, IReadOnlyList<StreamItem> items, bool landscape = false)
    {
        var section = Vertical(0, 18, 0, 0);
        section.Children.Add(Txt(title, 15, Text, FontWeights.SemiBold, 0, 0, 0, 7));
        var panel = new StackPanel { Orientation = Orientation.Horizontal, FlowDirection = FlowDirection.RightToLeft };
        var compact = _store.State.Settings.CatalogDensity == "compact";
        var width = landscape
            ? compact ? 205 : 224
            : compact ? 138 : 154;
        var take = compact ? 14 : 12;
        foreach (var item in items.Take(take))
            panel.Children.Add(ContentCard(item, width, landscape));

        section.Children.Add(new ScrollViewer
        {
            Content = panel,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Hidden,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            PanningMode = PanningMode.HorizontalOnly
        });
        return section;
    }

    private UIElement Stat(string label, int value, double left = 0)
    {
        var card = Card(left, 0, 0, 0);
        card.Width = 175;
        var stack = Vertical();
        stack.Children.Add(Txt(value.ToString("N0"), 25, Accent, FontWeights.Bold));
        stack.Children.Add(Txt(label, 11, Muted));
        card.Child = stack;
        return card;
    }

    private UIElement EmptyState(string title, string subtitle)
    {
        var card = Card();
        var stack = Vertical();
        stack.VerticalAlignment = VerticalAlignment.Center;
        stack.Children.Add(Txt(title, 24, Text, FontWeights.Bold));
        stack.Children.Add(Txt(subtitle, 13, Muted, marginTop: 8));
        card.Child = stack;
        return card;
    }

    private static Border Card(double left = 0, double top = 0, double right = 0, double bottom = 0) => new()
    {
        Background = Surface,
        BorderBrush = Brush("#443D2756"),
        BorderThickness = new Thickness(1),
        CornerRadius = new CornerRadius(14),
        Padding = new Thickness(18),
        Margin = new Thickness(left, top, right, bottom)
    };

    private static StackPanel Vertical(double left = 0, double top = 0, double right = 0, double bottom = 0) =>
        new() { Orientation = Orientation.Vertical, Margin = new Thickness(left, top, right, bottom) };

    private static StackPanel Horizontal(double left = 0, double top = 0, double right = 0, double bottom = 0) =>
        new() { Orientation = Orientation.Horizontal, Margin = new Thickness(left, top, right, bottom) };

    private static TextBlock Txt(string value, double size, Brush color, FontWeight weight = default,
        double marginLeft = 0, double marginTop = 0, double marginRight = 0, double marginBottom = 0,
        FlowDirection flow = FlowDirection.RightToLeft)
    {
        return new TextBlock
        {
            Text = value,
            FontSize = size,
            Foreground = color,
            FontWeight = weight == default ? FontWeights.Normal : weight,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(marginLeft, marginTop, marginRight, marginBottom),
            FlowDirection = flow
        };
    }

    private static Button Action(string label, bool primary, RoutedEventHandler click,
        double left = 0, double top = 0, double right = 0, double bottom = 0)
    {
        var button = new Button
        {
            Content = label,
            Style = Application.Current.FindResource(primary ? "PrimaryButton" : "SecondaryButton") as Style,
            Margin = new Thickness(left, top, right, bottom)
        };
        button.Click += click;
        return button;
    }

    private static UIElement Labeled(string label, Control control)
    {
        var stack = Vertical(0, 12, 0, 0);
        stack.Children.Add(Txt(label, 11, Muted, FontWeights.Normal, 0, 0, 0, 5));
        stack.Children.Add(control);
        return stack;
    }

    private static void BindArtwork(Image target, string? url, int decodeWidth)
    {
        if (string.IsNullOrWhiteSpace(url)) return;
        var requested = url;
        target.Tag = requested;
        target.Loaded += async (_, _) =>
        {
            if (!Equals(target.Tag, requested) || target.Source is not null) return;
            var image = await ArtworkCache.LoadAsync(requested, decodeWidth);
            if (image is null || !Equals(target.Tag, requested)) return;
            target.Source = image;
        };
    }

    private UIElement MetadataChip(string value)
    {
        return new Border
        {
            Background = Brush("#D421182D"),
            BorderBrush = Brush("#584768"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(10),
            Padding = new Thickness(10, 5, 10, 5),
            Margin = new Thickness(0, 0, 6, 6),
            Child = new TextBlock
            {
                Text = value,
                FontSize = 11,
                Foreground = Brush("#D2BBEE"),
                VerticalAlignment = VerticalAlignment.Center,
                FlowDirection = DetectDirection(value)
            }
        };
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    private static readonly IntPtr HWND_TOPMOST = new(-1);
    private const uint SWP_SHOWWINDOW = 0x0040;
    private const uint SWP_FRAMECHANGED = 0x0020;

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(
        IntPtr hWnd,
        IntPtr hWndInsertAfter,
        int X,
        int Y,
        int cx,
        int cy,
        uint uFlags);

    private static SolidColorBrush Brush(string value) =>
        new((Color)ColorConverter.ConvertFromString(value));

    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (OverlayHost.Visibility == Visibility.Visible) return;
        if (e.Key == Key.F && Keyboard.Modifiers.HasFlag(ModifierKeys.Control) &&
            _activeBrowserSearch is { IsVisible: true } finder)
        {
            finder.Focus();
            finder.SelectAll();
            e.Handled = true;
            return;
        }
        if (e.Key is not (Key.Left or Key.Right or Key.Up or Key.Down)) return;

        var focused = Keyboard.FocusedElement as DependencyObject;
        if (IsKeyboardEditingControl(focused)) return;

        var source = FindNavigationSource(focused);
        if (source is ListBoxItem or ListBox)
        {
            if (e.Key is Key.Up or Key.Down)
                return; // Native list navigation is better for long virtualized lists.
        }

        if (source is null)
        {
            FocusCurrentNavigationButton();
            e.Handled = true;
            return;
        }

        if (MoveRemoteFocus(source, e.Key))
            e.Handled = true;
    }

    private void FocusCurrentNavigationButton()
    {
        var target = NavigationPanel.Children
            .OfType<Button>()
            .FirstOrDefault(button => string.Equals(button.Tag as string, _currentPage, StringComparison.Ordinal))
            ?? NavigationPanel.Children.OfType<Button>().FirstOrDefault();
        target?.Focus();
    }

    private static void FocusSelectedListItem(ListBox list)
    {
        if (list.Items.Count == 0) return;
        if (list.SelectedIndex < 0) list.SelectedIndex = 0;

        // For virtualized categories the desired item may not have been
        // realized yet. Scroll it into view before resolving its container.
        var selected = list.SelectedItem;
        if (selected is null) { list.Focus(); return; }
        list.ScrollIntoView(selected);
        list.UpdateLayout();
        var container = list.ItemContainerGenerator.ContainerFromItem(selected) as ListBoxItem;
        if (container is not null)
        {
            container.Focus();
            container.BringIntoView();
            return;
        }

        list.Focus();
        _ = list.Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Loaded,
            new Action(() =>
            {
                if (!list.IsLoaded || list.SelectedItem != selected) return;
                list.ScrollIntoView(selected);
                if (list.ItemContainerGenerator.ContainerFromItem(selected) is ListBoxItem realized)
                    realized.Focus();
            }));
    }

    private bool MoveRemoteFocus(FrameworkElement current, Key key)
    {
        var candidates = EnumerateNavigationTargets(RootGrid)
            .Where(target => !ReferenceEquals(target, current))
            .ToList();

        if (current is ListBoxItem && key is Key.Left or Key.Right)
        {
            var posterButtons = candidates
                .OfType<Button>()
                .Where(button => button.Tag is string tag && tag.Contains(':'))
                .Cast<FrameworkElement>()
                .ToList();
            if (posterButtons.Count > 0 && TryFindDirectionalTarget(current, posterButtons, key, out var posterTarget))
                return FocusNavigationTarget(posterTarget);
        }

        return TryFindDirectionalTarget(current, candidates, key, out var target)
            && FocusNavigationTarget(target);
    }

    private bool FocusNavigationTarget(FrameworkElement target)
    {
        if (target is ListBoxItem item)
            item.IsSelected = true;

        var focused = target.Focus();
        if (!focused) return false;

        target.BringIntoView(new Rect(0, 0, Math.Max(1, target.ActualWidth), Math.Max(1, target.ActualHeight)));
        return true;
    }

    private bool TryFindDirectionalTarget(
        FrameworkElement current,
        IReadOnlyList<FrameworkElement> candidates,
        Key key,
        out FrameworkElement target)
    {
        target = null!;
        if (!TryCenter(current, out var from)) return false;

        var bestScore = double.MaxValue;
        foreach (var candidate in candidates)
        {
            if (!TryCenter(candidate, out var to)) continue;

            double primary;
            double cross;
            switch (key)
            {
                case Key.Left:
                    primary = from.X - to.X;
                    cross = Math.Abs(from.Y - to.Y);
                    break;
                case Key.Right:
                    primary = to.X - from.X;
                    cross = Math.Abs(from.Y - to.Y);
                    break;
                case Key.Up:
                    primary = from.Y - to.Y;
                    cross = Math.Abs(from.X - to.X);
                    break;
                case Key.Down:
                    primary = to.Y - from.Y;
                    cross = Math.Abs(from.X - to.X);
                    break;
                default:
                    return false;
            }

            if (primary <= 3) continue;

            // Prefer the control that is visually aligned in the requested direction.
            var score = primary + (cross * 2.35);
            if (cross > 260) score += cross * 1.5;
            if (score >= bestScore) continue;

            bestScore = score;
            target = candidate;
        }

        return bestScore < double.MaxValue;
    }

    private bool TryCenter(FrameworkElement element, out Point point)
    {
        point = default;
        if (!element.IsVisible || !element.IsEnabled || !element.Focusable ||
            element.ActualWidth <= 0 || element.ActualHeight <= 0)
            return false;

        try
        {
            var transform = element.TransformToAncestor(RootGrid);
            point = transform.Transform(new Point(element.ActualWidth / 2d, element.ActualHeight / 2d));
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static IEnumerable<FrameworkElement> EnumerateNavigationTargets(DependencyObject root)
    {
        var count = VisualTreeHelper.GetChildrenCount(root);
        for (var i = 0; i < count; i++)
        {
            var child = VisualTreeHelper.GetChild(root, i);
            if (child is FrameworkElement element &&
                element.IsVisible &&
                element.IsEnabled &&
                element.Focusable &&
                element is Button or ListBoxItem or CheckBox)
            {
                yield return element;
            }

            foreach (var descendant in EnumerateNavigationTargets(child))
                yield return descendant;
        }
    }

    private static FrameworkElement? FindNavigationSource(DependencyObject? current)
    {
        var node = current;
        while (node is not null)
        {
            if (node is Button or ListBoxItem or ListBox or CheckBox)
                return node as FrameworkElement;
            if (node is TextBox or PasswordBox or ComboBox or Slider)
                return null;

            node = node is Visual || node is System.Windows.Media.Media3D.Visual3D
                ? VisualTreeHelper.GetParent(node)
                : LogicalTreeHelper.GetParent(node);
        }
        return null;
    }

    private static bool IsKeyboardEditingControl(DependencyObject? current)
    {
        var node = current;
        while (node is not null)
        {
            if (node is TextBox or PasswordBox or ComboBox or Slider)
                return true;
            if (node is Button or ListBoxItem or ListBox or CheckBox)
                return false;

            node = node is Visual || node is System.Windows.Media.Media3D.Visual3D
                ? VisualTreeHelper.GetParent(node)
                : LogicalTreeHelper.GetParent(node);
        }
        return false;
    }

    private void Window_KeyDown(object sender, KeyEventArgs e)
    {
        if (OverlayHost.Visibility == Visibility.Visible)
            return;

        if (e.Key == Key.F5)
        {
            _ = SyncCatalogAsync(true);
            e.Handled = true;
            return;
        }

        if (e.Key is Key.Escape or Key.Back or Key.BrowserBack)
        {
            NavigateBack();
            e.Handled = true;
        }
    }

}
