using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace Blofy.Windows.Runtime;

public sealed partial class RuntimeWindow : Window
{
    private readonly RuntimeServices _services;
    private readonly Artwork _artwork = new();
    private readonly ContentControl _page = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch, VerticalContentAlignment = VerticalAlignment.Stretch };
    private readonly TextBlock _status = Text("", 13, "#DCC2FF");
    private readonly Grid _overlay = new() { Background = Brush("#D907050C"), Visibility = Visibility.Collapsed };
    private readonly TextBlock _loading = Text("جاري التحميل...", 20);
    private readonly Stack<Frame> _history = new();
    private readonly CancellationTokenSource _lifetime = new();
    private CancellationTokenSource _pageCts = new();
    private CancellationTokenSource? _workCts;
    private Task _operation = Task.CompletedTask;
    private Frame? _current;
    private Frame? _beforeFullscreen;
    private Panel? _previewHost;
    private bool _working, _closing, _fullscreen;
    private WindowState _oldState;
    private WindowStyle _oldStyle;
    private Entitlement? _gate;
    private long _gateChecked;
    private Provider? _active;
    private List<Episode> _episodeQueue = [];
    private int _episodeIndex = -1;
    private readonly DispatcherTimer _entitlementTimer;
    public Playback Playback { get; }
    public RuntimeLogin Login { get; }
    public string Route => _current?.Route ?? "";
    public string StatusText => _status.Text;
    public Provider? Active => _active;
    public RuntimeCatalog? CurrentCatalog { get; private set; }
    public bool IsFullscreen => _fullscreen;
    private sealed record Frame(string Route, UIElement View, IInputElement? Focus = null);

    public RuntimeWindow(RuntimeServices services)
    {
        _services = services;
        Title = "BLOFY PLAYER"; Width = 1340; Height = 880; MinWidth = 1120; MinHeight = 740;
        WindowStartupLocation = WindowStartupLocation.CenterScreen; Icon = Brand.Logo;
        Background = Gradient("#17102A", "#030308");
        var root = new Grid { FlowDirection = FlowDirection.LeftToRight };
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.Children.Add(_page);
        _status.Margin = new Thickness(18, 3, 18, 6); _status.MaxHeight = 55; root.Children.Add(_status); Grid.SetRow(_status, 1);
        var loadingPanel = new StackPanel { Width = 620, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        loadingPanel.Children.Add(_loading); loadingPanel.Children.Add(new ProgressBar { IsIndeterminate = true, Height = 5, Margin = new Thickness(0, 20, 0, 20) });
        loadingPanel.Children.Add(ActionButton("إلغاء", () => _workCts?.Cancel())); _overlay.Children.Add(loadingPanel); root.Children.Add(_overlay); Grid.SetRowSpan(_overlay, 2); Content = root;
        Playback = new Playback(services.Catalog, () => services.Users.Data.Preferences, Dispatcher);
        Playback.Status += Notice; Playback.FullscreenRequested += () => { if (_fullscreen) Forget(ExitFullscreen()); else EnterFullscreen(); };
        Playback.Ended += () => { if (!_closing && _episodeIndex >= 0 && _episodeIndex + 1 < _episodeQueue.Count && services.Users.Data.Preferences.AutoplayNext) Forget(Work(ct => PlayEpisode(++_episodeIndex, ct))); };
        Login = new RuntimeLogin(services, () => Forget(Work(ct => RefreshActivation(true, ct))), p => Forget(ConnectAsync(p)), () => ShowManager());
        Set(new ContentControl { Content = Login, ContentTemplate = (DataTemplate)FindResource("AndroidLoginView") }, "login", false);
        PreviewKeyDown += Keys; MouseDown += (_, e) => { if (e.ChangedButton == MouseButton.XButton1) { e.Handled = true; Forget(Back()); } };
        Closing += async (_, e) =>
        {
            if (_closing) return; e.Cancel = true;
            if (!Confirm("الخروج من BLOFY PLAYER؟", "هل تريد إغلاق التطبيق؟")) return;
            _closing = true; _workCts?.Cancel(); _lifetime.Cancel(); _pageCts.Cancel(); _entitlementTimer?.Stop();
            try { await _operation; await Playback.DisposeAsync(); } catch { }
            _artwork.Dispose(); _services.Dispose(); Close();
        };
        _entitlementTimer = new DispatcherTimer(TimeSpan.FromSeconds(30), DispatcherPriority.Background, (_, _) =>
        {
            if (!_closing && _gate != null && !_gate.Allowed && Route != "login")
            { Notice("انتهت مدة التفعيل"); Forget(ReturnToLogin()); }
        }, Dispatcher);
    }
    public Task InitializeAsync() => Work(ct => RefreshActivation(true, ct));
    private void Notice(string text) { if (!_closing) _status.Text = text; }
    private async void Forget(Task task) { try { await task; } catch (Exception ex) { Notice(Urls.Error(ex)); } }
    private Task Work(Func<CancellationToken, Task> action)
    {
        if (_working || _closing) return Task.CompletedTask;
        _working = true; _page.IsEnabled = false; _overlay.Visibility = Visibility.Visible; _loading.Text = "جاري التحميل...";
        _workCts = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
        async Task Execute()
        {
            try { await action(_workCts.Token); }
            catch (Exception ex) { Notice(Urls.Error(ex)); Login.Status = Urls.Error(ex); }
            finally { _working = false; _page.IsEnabled = true; _overlay.Visibility = Visibility.Collapsed; _workCts.Dispose(); _workCts = null; }
        }
        return _operation = Execute();
    }
    private async Task RefreshActivation(bool sync, CancellationToken ct)
    {
        _loading.Text = "التحقق من تفعيل الجهاز";
        _gate = await _services.Portal.Check(_services.Users.Data.Identity, ct); _gateChecked = Stopwatch.GetTimestamp();
        Login.Status = _gate.Label; Notice(_gate.Label);
        if (!_gate.Allowed && Playback.Current != null) await ReturnToLogin();
        if (sync)
        {
            try
            {
                var remote = await _services.Portal.Playlists(_services.Users.Data.Identity, ct);
                ct.ThrowIfCancellationRequested(); int changed = _services.Users.MergePortal(remote);
                Login.RefreshList(_services.Users.Data.Providers);
                if (changed > 0) Notice("تمت مزامنة " + changed + " قائمة مرتبطة بهذا الجهاز");
            }
            catch (OperationCanceledException) { throw; }
            catch { Notice(_gate.Label + " • تعذرت مزامنة الموقع؛ القوائم المحلية محفوظة"); }
        }
    }
    private async Task RequireActivation(CancellationToken ct)
    {
        if (_gate == null || !_gate.Allowed || Stopwatch.GetElapsedTime(_gateChecked) > TimeSpan.FromMinutes(2)) await RefreshActivation(false, ct);
        if (_gate?.Allowed != true) throw new InvalidDataException(_gate?.Label ?? "يلزم تفعيل الجهاز");
    }
    public Task ConnectAsync(Provider provider) => Work(ct => ConnectCore(provider, ct));
    private async Task ConnectCore(Provider provider, CancellationToken ct, bool force = false)
    {
        await RequireActivation(ct);
        if (force || !await _services.Catalog.Ready(provider))
        {
            var progress = new Progress<ImportStatus>(p => _loading.Text = p.Message + "\n" + p.Count.ToString("N0") + " عنصر");
            await _services.Catalog.Import(provider, _services.Providers, progress, ct);
        }
        ct.ThrowIfCancellationRequested(); await Playback.Stop();
        _services.Users.Select(provider); _active = provider; _history.Clear();
        ShowHome(); Notice("متصل • " + provider.Name);
    }
    private void ShowHome() => Set(new ContentControl { Content = new HomeViewModel(r => Forget(Navigate(r))), ContentTemplate = (DataTemplate)FindResource("AndroidHomeView") }, "home", false);
    public Task Navigate(string route) => Work(async ct =>
    {
        if (_active == null) throw new InvalidDataException("اختر قائمة تشغيل أولًا");
        if (_fullscreen) await ExitFullscreen();
        await Playback.Stop();
        switch (route)
        {
            case "home": ShowHome(); break;
            case "movie": case "series": await ShowCatalog(route, ct); break;
            case "live": await ShowLive(ct); break;
            case "favorites": case "continue": case "recent": await ShowLibrary(route, ct); break;
            case "settings": ShowSettings(); break;
            case "search": await ShowSearch(ct); break;
        }
    });
    private void Set(UIElement view, string route, bool remember = true)
    {
        _pageCts.Cancel(); _pageCts.Dispose(); _pageCts = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
        if (remember && _current != null) _history.Push(_current with { Focus = Keyboard.FocusedElement });
        _current = new Frame(route, view); _page.Content = view;
        Dispatcher.BeginInvoke(DispatcherPriority.Loaded, new Action(() =>
        {
            if (_closing) return;
            var first = MainWindow.Visuals<Control>(view).FirstOrDefault(c => c.Focusable && c.IsEnabled && c.IsVisible); first?.Focus();
        }));
    }
    private async Task ReturnToLogin()
    {
        if (_fullscreen) await ExitFullscreen(); await Playback.Stop(); _active = null; _history.Clear(); Login.RefreshList(_services.Users.Data.Providers);
        Set(new ContentControl { Content = Login, ContentTemplate = (DataTemplate)FindResource("AndroidLoginView") }, "login", false);
    }
    public async Task Back()
    {
        if (_working) { _workCts?.Cancel(); return; }
        if (_fullscreen) { await ExitFullscreen(); return; }
        await Playback.Stop();
        if (_history.TryPop(out var frame))
        {
            Set(frame.View, frame.Route, false); _ = Dispatcher.BeginInvoke(DispatcherPriority.Loaded, new Action(() => frame.Focus?.Focus()));
            if (frame.Route == "live" && _previewHost != null) Playback.Attach(_previewHost);
        }
        else if (Route != "login") await ReturnToLogin(); else Close();
    }
    public void EnterFullscreen()
    {
        if (_fullscreen || Playback.Current == null) return;
        _beforeFullscreen = _current; _oldStyle = WindowStyle; _oldState = WindowState;
        var host = new Grid { Background = Brushes.Black }; Playback.Attach(host); Playback.SetPreview(Playback.IsLive);
        _page.Content = host; _status.Visibility = Visibility.Collapsed; _fullscreen = true;
        WindowStyle = WindowStyle.None; WindowState = WindowState.Maximized;
    }
    public async Task ExitFullscreen()
    {
        if (!_fullscreen) return; bool live = Playback.IsLive;
        _fullscreen = false; WindowStyle = _oldStyle; WindowState = _oldState; _status.Visibility = Visibility.Visible;
        if (_beforeFullscreen != null) { _current = _beforeFullscreen; _page.Content = _beforeFullscreen.View; }
        if (live && _beforeFullscreen?.Route == "live" && _previewHost != null) { Playback.Attach(_previewHost); Playback.SetPreview(true); }
        else await Playback.Stop();
    }
    private void Keys(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape || e.Key == Key.BrowserBack || e.Key == Key.Back && Keyboard.FocusedElement is not TextBox && Keyboard.FocusedElement is not PasswordBox)
        { e.Handled = true; Forget(Back()); return; }
        if (e.Key == Key.F11) { e.Handled = true; if (_fullscreen) Forget(ExitFullscreen()); else EnterFullscreen(); return; }
        if (_fullscreen)
        {
            if (Playback.IsLive && e.Key is Key.Up or Key.Down && _liveList != null && _beforeFullscreen?.Route == "live") { _liveList.SelectedIndex = Math.Clamp(_liveList.SelectedIndex + (e.Key == Key.Down ? 1 : -1), 0, Math.Max(0, _liveList.Items.Count - 1)); e.Handled = true; }
            else if (e.Key == Key.Space) { Playback.TogglePause(); e.Handled = true; }
            else if (!Playback.IsLive && e.Key is Key.Left or Key.Right) { Playback.SeekBy(e.Key == Key.Left ? -10000 : 10000); e.Handled = true; }
        }
    }
    private bool Confirm(string title, string text)
    {
        var dialog = new Window { Title = title, Width = 500, Height = 245, ResizeMode = ResizeMode.NoResize, WindowStartupLocation = WindowStartupLocation.CenterOwner, Owner = this, Background = Brush("#130E1C"), Foreground = Brushes.White };
        var stack = new StackPanel { Margin = new Thickness(24) }; stack.Children.Add(Text(title, 22)); stack.Children.Add(Text(text, 16, "#E4DDEC"));
        var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 22, 0, 0) };
        var no = ActionButton("لا، رجوع", () => dialog.DialogResult = false); no.IsCancel = true;
        row.Children.Add(no); row.Children.Add(ActionButton("نعم", () => dialog.DialogResult = true)); stack.Children.Add(row); dialog.Content = stack;
        return dialog.ShowDialog() == true;
    }
    internal async Task ShutdownForVerification()
    {
        _closing = true; _workCts?.Cancel(); _lifetime.Cancel(); _pageCts.Cancel(); _entitlementTimer.Stop();
        try { await _operation; await Playback.DisposeAsync(); } finally { _artwork.Dispose(); _services.Dispose(); Close(); }
    }
    private static SolidColorBrush Brush(string hex) => new((Color)ColorConverter.ConvertFromString(hex));
    private static LinearGradientBrush Gradient(string a, string b) => new((Color)ColorConverter.ConvertFromString(a), (Color)ColorConverter.ConvertFromString(b), new Point(0, 0), new Point(1, 1));
    private static TextBlock Text(string value, double size = 16, string color = "#FFFFFF") => new() { Text = value, FontSize = size, Foreground = Brush(color), TextWrapping = TextWrapping.Wrap, FlowDirection = FlowDirection.RightToLeft, TextAlignment = TextAlignment.Right, Margin = new Thickness(0, 5, 0, 5) };
    private Button ActionButton(string title, Action action)
    {
        var b = new Button { Content = title, MinHeight = 46, Margin = new Thickness(4), Padding = new Thickness(16, 8, 16, 8), Style = (Style)FindResource("LoginButton") };
        b.Click += (_, _) => action(); return b;
    }
    private static Border Panel(UIElement child, string color = "#E8191023") => new() { Child = child, Padding = new Thickness(20), CornerRadius = new CornerRadius(20), BorderThickness = new Thickness(1), BorderBrush = Brush("#5F3B7B"), Background = Brush(color) };
    private UIElement PageWithHeader(string title, UIElement content)
    {
        var grid = new Grid { Margin = new Thickness(34, 22, 34, 26) }; grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(65) }); grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        var header = Text(title, 30); header.FontWeight = FontWeights.Bold; grid.Children.Add(header); var back = ActionButton("رجوع", () => Forget(Back())); back.HorizontalAlignment = HorizontalAlignment.Left; back.VerticalAlignment = VerticalAlignment.Center; grid.Children.Add(back);
        grid.Children.Add(content); Grid.SetRow(content, 1); return grid;
    }
}
