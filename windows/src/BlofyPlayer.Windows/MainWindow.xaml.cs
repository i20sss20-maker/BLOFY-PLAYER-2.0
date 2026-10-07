using BlofyPlayer.Windows.Core;
using BlofyPlayer.Windows.Core.Identity;
using BlofyPlayer.Windows.Core.Playback;
using LibVLCSharp.WPF;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;

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
    private CancellationTokenSource? _syncCts;
    private ActivationCheckResponse? _activationState;
    private ProviderAccount? _activeProvider;
    private PlaybackService? _previewPlayback;
    private int _liveSelectionSerial;
    private string _currentPage = "home";

    public MainWindow()
    {
        InitializeComponent();
        DeviceIdText.Text = _identity.DeviceId;
        Loaded += async (_, _) => await InitializeAsync();
        Closed += (_, _) =>
        {
            _syncCts?.Cancel();
            DisposePreview();
            _catalog?.Dispose();
            _activation.Dispose();
            _portal.Dispose();
        };
    }

    private async Task InitializeAsync()
    {
        await _store.LoadAsync();
        _catalog = new CatalogCoordinator(_store);
        await CheckActivationAsync();
        await SyncPortalAsync();

        _activeProvider = _store.ActiveProvider();
        if (_activeProvider is not null)
        {
            var cached = await _catalog.LoadCachedAsync(_activeProvider);
            if (cached is not null)
            {
                PageSubtitle.Text = _activeProvider.Name + " • " + cached.Streams.Count.ToString("N0") + " عنصر";
                ShowHome();
            }

            if (_activationState?.CanUse() == true)
                _ = SyncCatalogAsync(false);
        }
        else ShowHome();
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
        _activeProvider = _store.ActiveProvider();
        if (_activeProvider is null)
        {
            if (userRequested) ShowProviders();
            return;
        }
        if (_activationState?.CanUse() != true)
        {
            if (userRequested) ShowActivation();
            return;
        }

        _syncCts?.Cancel();
        _syncCts = new CancellationTokenSource();
        var progress = new Progress<(int Percent, string Text)>(p =>
        {
            ProgressText.Text = p.Percent + "% • " + p.Text;
        });

        try
        {
            await _catalog.SyncAsync(_activeProvider, progress, _syncCts.Token);
            PageSubtitle.Text = _activeProvider.Name + " • " + _catalog.Snapshot.Streams.Count.ToString("N0") + " عنصر";
            ProgressText.Text = "جاهز";
            RefreshCurrentPage();
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            ProgressText.Text = "تعذر التحديث";
            if (userRequested)
                MessageBox.Show(this, ex.Message, "BLOFY PLAYER");
        }
    }

    private void Nav_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: string page }) return;
        _currentPage = page;
        RefreshCurrentPage();
    }

    private void RefreshCurrentPage()
    {
        DisposePreview();
        switch (_currentPage)
        {
            case "home": ShowHome(); break;
            case "live": ShowBrowser("live"); break;
            case "movie": ShowBrowser("movie"); break;
            case "series": ShowBrowser("series"); break;
            case "favorites": ShowFavorites(); break;
            case "search": ShowSearch(); break;
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
        PageTitle.Text = "الرئيسية";
        var root = Vertical();

        if (_activationState?.CanUse() != true)
        {
            root.Children.Add(ActivationCard());
            ContentHost.Content = new ScrollViewer { Content = root, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
            return;
        }

        var hero = new Border
        {
            Height = 290,
            CornerRadius = new CornerRadius(18),
            BorderBrush = Brush("#665E437A"),
            BorderThickness = new Thickness(1),
            Background = new LinearGradientBrush(Brush("#4B276A").Color, Bg.Color, 25),
            Padding = new Thickness(26),
            Margin = new Thickness(0, 0, 0, 22)
        };
        var heroContent = Vertical();
        heroContent.VerticalAlignment = VerticalAlignment.Center;
        heroContent.Children.Add(Txt("BLOFY PLAYER", 11, Accent, FontWeights.Bold));
        heroContent.Children.Add(Txt("كل محتواك في مكان واحد", 31, Text, FontWeights.Bold, 0, 8, 0, 5));
        heroContent.Children.Add(Txt("بث مباشر • أفلام • مسلسلات • مفضلة • متابعة المشاهدة", 13, Muted));
        var heroActions = Horizontal(0, 18, 0, 0);
        heroActions.Children.Add(Action("شاهد الآن", true, (_, _) => { _currentPage = "live"; ShowBrowser("live"); }));
        heroActions.Children.Add(Action("استكشف الأفلام", false, (_, _) => { _currentPage = "movie"; ShowBrowser("movie"); }, 10));
        heroContent.Children.Add(heroActions);
        hero.Child = heroContent;
        root.Children.Add(hero);

        var counts = Horizontal();
        counts.Children.Add(Stat("القنوات", Items("live").Count));
        counts.Children.Add(Stat("الأفلام", Items("movie").Count, 12));
        counts.Children.Add(Stat("المسلسلات", Items("series").Count, 12));
        counts.Children.Add(Stat("المفضلة", _store.State.Favorites.Count, 12));
        root.Children.Add(counts);

        var continueItems = _store.State.WatchStates.Values
            .Where(w => !w.Completed && w.PositionMs > 30_000)
            .OrderByDescending(w => w.UpdatedAt)
            .Select(w => _catalog?.Snapshot.Streams.FirstOrDefault(s => s.Key == w.Key))
            .Where(s => s is not null).Cast<StreamItem>().Take(12).ToList();

        if (continueItems.Count > 0)
            root.Children.Add(ContentRow("متابعة المشاهدة", continueItems));

        var latestMovies = Items("movie").OrderByDescending(i => i.AddedAt).Take(16).ToList();
        if (latestMovies.Count > 0) root.Children.Add(ContentRow("أحدث الأفلام", latestMovies));

        var latestSeries = Items("series").OrderByDescending(i => i.AddedAt).Take(16).ToList();
        if (latestSeries.Count > 0) root.Children.Add(ContentRow("أحدث المسلسلات", latestSeries));

        root.Children.Add(ActivationCompact());
        ContentHost.Content = new ScrollViewer { Content = root, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
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

    private string ActivationPortalUrl() =>
        "https://api.blofyplayer.com/connect#deviceId=" + Uri.EscapeDataString(_identity.DeviceId) +
        "&code=" + Uri.EscapeDataString(_identity.ActivationCode);

    private void ShowBrowser(string kind)
    {
        if (kind == "live")
        {
            ShowLiveBrowser();
            return;
        }
        DisposePreview();
        var label = kind switch { "live" => "البث المباشر", "movie" => "الأفلام", _ => "المسلسلات" };
        PageTitle.Text = label;

        var all = Items(kind);
        if (all.Count == 0)
        {
            ContentHost.Content = EmptyState("لا يوجد محتوى محمّل في " + label, "اضغط تحديث أو أضف قائمة من «القوائم».");
            return;
        }

        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(240) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(18) });
        grid.ColumnDefinitions.Add(new ColumnDefinition());

        var cats = new ListBox
        {
            Background = Surface2,
            Foreground = Text,
            BorderBrush = Brush("#443D2756"),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(6)
        };
        cats.Items.Add("الكل");
        foreach (var cat in (_catalog?.Snapshot.Categories ?? []).Where(c => c.Kind == kind))
            cats.Items.Add(cat);
        cats.DisplayMemberPath = "Name";
        cats.SelectedIndex = 0;
        Grid.SetColumn(cats, 0);
        grid.Children.Add(cats);

        var scroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        var wrap = new WrapPanel { Orientation = Orientation.Horizontal };
        scroll.Content = wrap;
        Grid.SetColumn(scroll, 2);
        grid.Children.Add(scroll);

        void Fill()
        {
            wrap.Children.Clear();
            var selected = cats.SelectedItem as CategoryItem;
            var filtered = selected is null ? all : all.Where(i => i.CategoryId == selected.RemoteId).ToList();
            foreach (var item in filtered)
                wrap.Children.Add(ContentCard(item, kind == "live" ? 260 : 160));
        }
        cats.SelectionChanged += (_, _) => Fill();
        Fill();

        ContentHost.Content = grid;
    }

    private void ShowLiveBrowser()
    {
        DisposePreview();
        PageTitle.Text = "البث المباشر";
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

        var cats = new ListBox
        {
            Background = Surface2, Foreground = Text,
            BorderBrush = Brush("#443D2756"), BorderThickness = new Thickness(1),
            Padding = new Thickness(6)
        };
        cats.Items.Add("الكل");
        foreach (var cat in (_catalog?.Snapshot.Categories ?? []).Where(c => c.Kind == "live"))
            cats.Items.Add(cat);
        cats.DisplayMemberPath = "Name";
        cats.SelectedIndex = 0;
        grid.Children.Add(cats);

        var channels = new ListBox
        {
            Background = Surface2, Foreground = Text,
            BorderBrush = Brush("#443D2756"), BorderThickness = new Thickness(1),
            Padding = new Thickness(6), DisplayMemberPath = "Name"
        };
        Grid.SetColumn(channels, 2);
        grid.Children.Add(channels);

        var right = Vertical();
        Grid.SetColumn(right, 4);
        grid.Children.Add(right);

        var previewBorder = new Border
        {
            Height = 330, CornerRadius = new CornerRadius(14),
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
            if (channels.SelectedItem is StreamItem selected) await PlayItemAsync(selected);
        });
        actions.Children.Add(playFull);
        right.Children.Add(actions);

        right.Children.Add(Txt("دليل البرامج EPG", 15, Accent, FontWeights.Bold, 0, 10, 0, 8));
        var epgPanel = Vertical();
        right.Children.Add(new ScrollViewer
        {
            Content = epgPanel,
            MaxHeight = 270,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto
        });

        void FillChannels()
        {
            channels.Items.Clear();
            var selectedCat = cats.SelectedItem as CategoryItem;
            IEnumerable<StreamItem> filtered = all;
            if (selectedCat is not null) filtered = filtered.Where(s => s.CategoryId == selectedCat.RemoteId);
            foreach (var item in filtered) channels.Items.Add(item);
            if (channels.Items.Count > 0) channels.SelectedIndex = 0;
        }

        cats.SelectionChanged += (_, _) => FillChannels();
        channels.MouseDoubleClick += async (_, _) =>
        {
            if (channels.SelectedItem is StreamItem selected) await PlayItemAsync(selected);
        };

        channels.SelectionChanged += async (_, _) =>
        {
            if (channels.SelectedItem is not StreamItem selected || _activeProvider is null) return;
            var serial = ++_liveSelectionSerial;
            channelTitle.Text = selected.Name;
            nowText.Text = selected.ArchiveEnabled
                ? "يدعم الاسترجاع حتى " + selected.ArchiveDurationDays + " يوم"
                : "بث مباشر";

            if (_store.State.Settings.AutoplayLive && _previewPlayback is not null)
            {
                var url = _activeProvider.ProviderType == "m3u"
                    ? selected.DirectSource
                    : _catalog!.Xtream(_activeProvider).StreamUrl(_activeProvider, selected, _store.State.Settings.LiveFormat);
                _previewPlayback.Play(url);
            }

            epgPanel.Children.Clear();
            epgPanel.Children.Add(Txt("جاري تحميل الدليل…", 11, Muted));
            if (_activeProvider.ProviderType != "xtream")
            {
                epgPanel.Children.Clear();
                epgPanel.Children.Add(Txt("EPG غير متاح لهذه القائمة.", 11, Muted));
                return;
            }

            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
                var epg = await _catalog!.Xtream(_activeProvider).GetShortEpgAsync(_activeProvider, selected.RemoteId, timeout.Token);
                if (serial != _liveSelectionSerial) return;
                epgPanel.Children.Clear();
                if (epg.Count == 0)
                {
                    epgPanel.Children.Add(Txt("لا توجد بيانات EPG من السيرفر.", 11, Muted));
                    return;
                }

                var now = DateTimeOffset.Now;
                foreach (var entry in epg)
                {
                    var isNow = entry.Start <= now && entry.End > now;
                    var text = entry.Start.ToLocalTime().ToString("HH:mm") + "  " + entry.Title;
                    if (isNow) text = "● الآن  " + text;
                    var button = Action(text, isNow, async (_, _) =>
                    {
                        if (!selected.ArchiveEnabled || entry.End > DateTimeOffset.Now)
                            return;
                        var catchupUrl = _catalog!.Xtream(_activeProvider).CatchupUrl(_activeProvider, selected, entry.Start, entry.End);
                        var player = new PlayerWindow(selected.Name + " • " + entry.Title, catchupUrl) { Owner = this };
                        player.ShowDialog();
                        await Task.CompletedTask;
                    }, 0, 0, 0, 6);
                    button.HorizontalContentAlignment = HorizontalAlignment.Right;
                    button.ToolTip = entry.Description;
                    epgPanel.Children.Add(button);
                }
            }
            catch
            {
                if (serial != _liveSelectionSerial) return;
                epgPanel.Children.Clear();
                epgPanel.Children.Add(Txt("تعذر تحميل EPG الآن.", 11, Muted));
            }
        };

        FillChannels();
        ContentHost.Content = grid;
    }

    private Button ContentCard(StreamItem item, int width)
    {
        var stack = Vertical();
        var imageBorder = new Border
        {
            Width = width - 18,
            Height = item.Kind == "live" ? 100 : 210,
            CornerRadius = new CornerRadius(10),
            Background = Surface2,
            BorderBrush = Brush("#443D2756"),
            BorderThickness = new Thickness(1)
        };

        if (!string.IsNullOrWhiteSpace(item.Icon))
        {
            try
            {
                imageBorder.Child = new Image
                {
                    Source = new BitmapImage(new Uri(item.Icon)),
                    Stretch = item.Kind == "live" ? Stretch.Uniform : Stretch.UniformToFill
                };
            }
            catch { }
        }

        stack.Children.Add(imageBorder);
        stack.Children.Add(Txt(item.Name, 12, Text, FontWeights.SemiBold, 2, 7, 2, 0));
        if (!string.IsNullOrWhiteSpace(item.Rating) && item.Kind != "live")
            stack.Children.Add(Txt("★ " + item.Rating, 10, Accent));

        var button = new Button
        {
            Width = width,
            Height = item.Kind == "live" ? 155 : 270,
            Content = stack,
            Background = Brushes.Transparent,
            BorderBrush = Brushes.Transparent,
            Padding = new Thickness(6),
            Margin = new Thickness(0, 0, 12, 14),
            Cursor = Cursors.Hand,
            ToolTip = item.Name,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Stretch
        };
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
        PageTitle.Text = item.Name;

        ProviderDetails? providerDetails = null;
        if (_activeProvider is not null && _activeProvider.ProviderType == "xtream")
        {
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
                providerDetails = await _catalog!.Xtream(_activeProvider).GetDetailsAsync(_activeProvider, item, timeout.Token);
            }
            catch { }
        }

        var root = Vertical();

        var hero = new Border
        {
            MinHeight = 250,
            CornerRadius = new CornerRadius(18),
            BorderBrush = Brush("#665E437A"),
            BorderThickness = new Thickness(1),
            Background = new LinearGradientBrush(Brush("#4B276A").Color, Bg.Color, 15),
            Padding = new Thickness(24)
        };

        var info = Vertical();
        info.Children.Add(Txt(item.Kind == "series" ? "BLOFY SERIES" : "BLOFY MOVIE", 10, Accent, FontWeights.Bold));
        info.Children.Add(Txt(item.Name, 30, Text, FontWeights.Bold, 0, 8, 0, 6));

        var detailGenre = providerDetails?.Genre is { Length: > 0 } dg ? dg : item.Genre;
        var detailRating = providerDetails?.Rating is { Length: > 0 } dr ? dr : item.Rating;
        var detailDuration = providerDetails?.Duration is { Length: > 0 } dd ? dd : item.Duration;
        var detailRelease = providerDetails?.ReleaseDate is { Length: > 0 } rd ? rd : item.ReleaseDate;
        var detailPlot = providerDetails?.Plot is { Length: > 0 } dp ? dp : item.Plot;
        var meta = string.Join("  •  ", new[] { item.Year, detailRelease, detailGenre, string.IsNullOrWhiteSpace(detailRating) ? "" : "★ " + detailRating, detailDuration }
            .Where(s => !string.IsNullOrWhiteSpace(s)));
        info.Children.Add(Txt(meta, 12, Muted));
        if (!string.IsNullOrWhiteSpace(providerDetails?.Country))
            info.Children.Add(Txt("الدولة: " + providerDetails.Country, 11, Accent, marginTop: 7));
        if (!string.IsNullOrWhiteSpace(providerDetails?.Network))
            info.Children.Add(Txt("الشبكة: " + providerDetails.Network, 11, Muted, marginTop: 4));
        if (!string.IsNullOrWhiteSpace(detailPlot))
            info.Children.Add(Txt(detailPlot, 13, Text, FontWeights.Normal, 0, 14, 0, 14));
        if (!string.IsNullOrWhiteSpace(providerDetails?.Cast))
            info.Children.Add(Txt("الممثلون: " + providerDetails.Cast, 11, Muted, marginBottom: 6));
        if (!string.IsNullOrWhiteSpace(providerDetails?.Director))
            info.Children.Add(Txt("المخرج: " + providerDetails.Director, 11, Muted, marginBottom: 6));

        var actions = Horizontal();
        if (item.Kind == "movie")
            actions.Children.Add(Action("▶ تشغيل", true, async (_, _) => await PlayItemAsync(item)));
        var fav = Action(item.Favorite ? "★ إزالة من المفضلة" : "☆ إضافة للمفضلة", false, async (s, _) =>
        {
            await _store.ToggleFavoriteAsync(item);
            if (s is Button b) b.Content = item.Favorite ? "★ إزالة من المفضلة" : "☆ إضافة للمفضلة";
        }, 10);
        actions.Children.Add(fav);
        info.Children.Add(actions);
        hero.Child = info;
        root.Children.Add(hero);

        if (item.Kind == "series" && _activeProvider is not null && _activeProvider.ProviderType == "xtream")
        {
            var loading = Txt("جاري تحميل المواسم والحلقات…", 13, Muted, marginTop: 20);
            root.Children.Add(loading);
            ContentHost.Content = new ScrollViewer { Content = root, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };

            try
            {
                var episodes = await _catalog!.Xtream(_activeProvider).GetEpisodesAsync(_activeProvider, item.RemoteId);
                root.Children.Remove(loading);
                if (episodes.Count == 0)
                    root.Children.Add(Txt("لا توجد حلقات متاحة من السيرفر.", 13, Muted, marginTop: 20));
                else
                {
                    foreach (var season in episodes.GroupBy(e => e.Season))
                    {
                        root.Children.Add(Txt("الموسم " + season.Key, 20, Text, FontWeights.Bold, 0, 22, 0, 10));
                        var row = new WrapPanel();
                        foreach (var ep in season)
                        {
                            var epButton = Action("الحلقة " + ep.Episode + "\n" + ep.Title, false, async (_, _) =>
                                await PlayEpisodeAsync(item, ep, episodes), 0);
                            epButton.Width = 190;
                            epButton.Height = 70;
                            epButton.Margin = new Thickness(0, 0, 10, 10);
                            row.Children.Add(epButton);
                        }
                        root.Children.Add(row);
                    }
                }
            }
            catch (Exception ex)
            {
                root.Children.Remove(loading);
                root.Children.Add(Txt("تعذر تحميل الحلقات: " + ex.Message, 12, Muted, marginTop: 20));
            }
        }

        ContentHost.Content = new ScrollViewer { Content = root, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
    }

    private async Task PlayItemAsync(StreamItem item)
    {
        if (_activeProvider is null) return;
        string url;
        if (_activeProvider.ProviderType == "m3u") url = item.DirectSource;
        else url = _catalog!.Xtream(_activeProvider).StreamUrl(_activeProvider, item, _store.State.Settings.LiveFormat);

        long resume = 0;
        if (item.Kind != "live" && _store.State.WatchStates.TryGetValue(item.Key, out var state) && !state.Completed && state.PositionMs > 30_000)
        {
            if (!_store.State.Settings.ResumePrompt ||
                MessageBox.Show(this, "متابعة من " + TimeSpan.FromMilliseconds(state.PositionMs).ToString(@"hh\:mm\:ss") + "؟", "BLOFY PLAYER",
                    MessageBoxButton.YesNo) == MessageBoxResult.Yes)
                resume = state.PositionMs;
        }

        var sameKind = item.Kind == "live" ? Items("live") : [];
        var idx = item.Kind == "live" ? sameKind.FindIndex(x => x.Key == item.Key) : -1;
        Func<StreamItem, string>? resolver = item.Kind == "live"
            ? s => _activeProvider.ProviderType == "m3u" ? s.DirectSource :
                _catalog!.Xtream(_activeProvider).StreamUrl(_activeProvider, s, _store.State.Settings.LiveFormat)
            : null;

        var player = new PlayerWindow(
            item.Name,
            url,
            resume,
            sameKind,
            idx,
            resolver,
            item.Kind == "live" ? null : async (pos, len) => await _store.SaveWatchStateAsync(item.Key, pos, len))
        { Owner = this };
        player.ShowDialog();
    }

    private async Task PlayEpisodeAsync(StreamItem series, EpisodeItem episode, IReadOnlyList<EpisodeItem> episodes)
    {
        if (_activeProvider is null) return;
        var key = episode.Key;
        var resume = 0L;
        if (_store.State.WatchStates.TryGetValue(key, out var state) && !state.Completed && state.PositionMs > 30_000)
            resume = state.PositionMs;
        var url = _catalog!.Xtream(_activeProvider).EpisodeUrl(_activeProvider, episode);
        var player = new PlayerWindow(series.Name + " • S" + episode.Season + "E" + episode.Episode,
            url, resume, savePosition: async (pos, len) => await _store.SaveWatchStateAsync(key, pos, len))
        { Owner = this };
        player.ShowDialog();
    }

    private void ShowFavorites()
    {
        DisposePreview();
        PageTitle.Text = "المفضلة";
        var items = _catalog?.Snapshot.Streams.Where(i => i.Favorite).ToList() ?? [];
        if (items.Count == 0)
        {
            ContentHost.Content = EmptyState("المفضلة فارغة", "اضغط ☆ في تفاصيل الفيلم أو المسلسل لإضافته.");
            return;
        }
        var wrap = new WrapPanel();
        foreach (var item in items) wrap.Children.Add(ContentCard(item, item.Kind == "live" ? 260 : 160));
        ContentHost.Content = new ScrollViewer { Content = wrap, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
    }

    private void ShowSearch()
    {
        DisposePreview();
        PageTitle.Text = "البحث";
        var root = Vertical();
        var search = new TextBox { FontSize = 17, Height = 44, ToolTip = "ابحث من أول حرف…" };
        root.Children.Add(search);
        var results = new WrapPanel { Margin = new Thickness(0, 18, 0, 0) };
        root.Children.Add(results);

        void Run()
        {
            results.Children.Clear();
            var q = NormalizeSearch(search.Text);
            if (q.Length == 0) return;
            foreach (var item in (_catalog?.Snapshot.Streams ?? [])
                         .Where(i => NormalizeSearch(i.Name).Contains(q, StringComparison.OrdinalIgnoreCase))
                         .Take(150))
                results.Children.Add(ContentCard(item, item.Kind == "live" ? 260 : 160));
        }

        search.TextChanged += (_, _) => Run();
        ContentHost.Content = new ScrollViewer { Content = root, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        search.Focus();
    }

    private static string NormalizeSearch(string value)
    {
        return value.Trim().ToLowerInvariant()
            .Replace("أ", "ا").Replace("إ", "ا").Replace("آ", "ا")
            .Replace("ة", "ه").Replace("ى", "ي")
            .Replace("ـ", "");
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
            Background = Surface2,
            Foreground = Text,
            BorderBrush = Brush("#443D2756")
        };
        foreach (var provider in _store.State.Providers.OrderByDescending(p => p.Active).ThenByDescending(p => p.UpdatedAt))
            list.Items.Add(provider);
        list.DisplayMemberPath = "Name";
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
            url.Text = editing.BaseUrl;
            username.Text = editing.Username;
            password.Password = editing.Password;
            m3u.Text = editing.M3uUrl;
            type.SelectedIndex = editing.ProviderType == "m3u" ? 1 : 0;
        };

        var buttons = Horizontal(0, 18, 0, 0);
        buttons.Children.Add(Action("حفظ واتصال", true, async (_, _) =>
        {
            var isM3u = type.SelectedIndex == 1;
            var provider = editing ?? new ProviderAccount();
            provider.Name = string.IsNullOrWhiteSpace(name.Text) ? "BLOFY Server" : name.Text.Trim();
            provider.ProviderType = isM3u ? "m3u" : "xtream";
            provider.BaseUrl = url.Text.Trim();
            provider.Username = username.Text.Trim();
            provider.Password = password.Password;
            provider.M3uUrl = m3u.Text.Trim();
            provider.Active = true;
            provider.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            if (!isM3u)
            {
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
            else if (string.IsNullOrWhiteSpace(provider.M3uUrl))
            {
                MessageBox.Show(this, "أدخل رابط أو مسار M3U.", "BLOFY PLAYER");
                return;
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
        ContentHost.Content = root;
    }

    private void ShowSettings()
    {
        DisposePreview();
        PageTitle.Text = "الإعدادات";
        var root = Vertical();

        var theme = Choice("المظهر", [("داكن BLOFY", "dark"), ("فاتح", "light")], _store.State.Settings.Theme);
        var language = Choice("اللغة", [("العربية", "ar"), ("English", "en")], _store.State.Settings.Language);
        var liveFormat = Choice("صيغة البث المباشر", [("TS", "ts"), ("HLS / M3U8", "m3u8")], _store.State.Settings.LiveFormat);
        var subtitle = Choice("الترجمة", [("العربية أولًا", "ar"), ("تلقائي", "auto"), ("إيقاف", "off")], _store.State.Settings.SubtitleLanguage);
        var subtitleSize = Choice("حجم الترجمة", [("صغير", "small"), ("متوسط", "medium"), ("كبير", "large")], _store.State.Settings.SubtitleSize);
        var aspect = Choice("أبعاد الصورة", [("ملاءمة", "fit"), ("ملء", "fill"), ("تكبير", "zoom")], _store.State.Settings.Aspect);
        var autoNext = Choice("الحلقة التالية", [("اسأل", "ask"), ("تشغيل تلقائي", "on"), ("إيقاف", "off")], _store.State.Settings.AutoNext);
        var density = Choice("كثافة المحتوى", [("مريح", "comfortable"), ("مضغوط", "compact")], _store.State.Settings.CatalogDensity);

        foreach (var row in new UIElement[] { theme.View, language.View, liveFormat.View, subtitle.View, subtitleSize.View, aspect.View, autoNext.View, density.View })
            root.Children.Add(row);

        var autoplay = new CheckBox { Content = "تشغيل أول قناة تلقائيًا", IsChecked = _store.State.Settings.AutoplayLive, Foreground = Text, Margin = new Thickness(0, 8, 0, 8) };
        var resume = new CheckBox { Content = "اسأل قبل متابعة المشاهدة", IsChecked = _store.State.Settings.ResumePrompt, Foreground = Text, Margin = new Thickness(0, 8, 0, 8) };
        root.Children.Add(autoplay);
        root.Children.Add(resume);

        var userAgent = new TextBox { Text = _store.State.Settings.UserAgent, FlowDirection = FlowDirection.LeftToRight };
        root.Children.Add(Labeled("User-Agent", userAgent));

        root.Children.Add(Action("حفظ الإعدادات", true, async (_, _) =>
        {
            _store.State.Settings.Theme = theme.Value();
            _store.State.Settings.Language = language.Value();
            _store.State.Settings.LiveFormat = liveFormat.Value();
            _store.State.Settings.SubtitleLanguage = subtitle.Value();
            _store.State.Settings.SubtitleSize = subtitleSize.Value();
            _store.State.Settings.Aspect = aspect.Value();
            _store.State.Settings.AutoNext = autoNext.Value();
            _store.State.Settings.CatalogDensity = density.Value();
            _store.State.Settings.AutoplayLive = autoplay.IsChecked == true;
            _store.State.Settings.ResumePrompt = resume.IsChecked == true;
            _store.State.Settings.UserAgent = string.IsNullOrWhiteSpace(userAgent.Text)
                ? "BLOFY PLAYER/2.0 (Windows)" : userAgent.Text.Trim();
            await _store.SaveAsync();
            MessageBox.Show(this, "تم حفظ الإعدادات.", "BLOFY PLAYER");
        }, 0, 20, 0, 0));

        ContentHost.Content = new ScrollViewer { Content = root, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
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

    private void DisposePreview()
    {
        if (_previewPlayback is null) return;
        try { _previewPlayback.Stop(); } catch { }
        _previewPlayback.Dispose();
        _previewPlayback = null;
    }

    private List<StreamItem> Items(string kind) =>
        _catalog?.Snapshot.Streams.Where(s => s.Kind == kind).ToList() ?? [];

    private UIElement ContentRow(string title, IReadOnlyList<StreamItem> items)
    {
        var section = Vertical(0, 22, 0, 0);
        section.Children.Add(Txt(title, 19, Text, FontWeights.Bold, 0, 0, 0, 10));
        var panel = new StackPanel { Orientation = Orientation.Horizontal };
        foreach (var item in items) panel.Children.Add(ContentCard(item, 160));
        section.Children.Add(new ScrollViewer
        {
            Content = panel,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Hidden,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled
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

    private static SolidColorBrush Brush(string value) =>
        new((Color)ColorConverter.ConvertFromString(value));

    private void Window_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.F5)
        {
            _ = SyncCatalogAsync(true);
            e.Handled = true;
        }
        else if (e.Key == Key.Escape && _currentPage != "home")
        {
            _currentPage = "home";
            ShowHome();
            e.Handled = true;
        }
    }
}
