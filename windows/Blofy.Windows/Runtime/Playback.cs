using LibVLCSharp.Shared;
using LibVLCSharp.WPF;
using Microsoft.Win32;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Threading;
using VlcPlayer = LibVLCSharp.Shared.MediaPlayer;

namespace Blofy.Windows.Runtime;

/// <summary>One native media session is reparented between preview and fullscreen, never duplicated.</summary>
public sealed class Playback : IAsyncDisposable
{
    public Grid Surface { get; } = new() { Background = Brushes.Black };
    public VideoView Video { get; } = new() { HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Stretch };
    public VlcPlayer? Player => _player;
    public Provider? Provider { get; private set; }
    public Entry? Current { get; private set; }
    public bool IsLive => Current?.Kind == "live";
    public long Position => _player?.Time ?? 0;
    public long Duration => _player?.Length ?? 0;
    public event Action<string>? Status;
    public event Action? Ended;
    public event Action? FullscreenRequested;
    private readonly Func<PlaybackPreferences> _preferences;
    private readonly CatalogStore _store;
    private readonly SemaphoreSlim _serial = new(1, 1);
    private LibVLC? _vlc;
    private VlcPlayer? _player;
    private readonly Dispatcher _ui;
    private readonly DispatcherTimer _timer;
    private readonly Slider _seek = new() { Minimum = 0, Maximum = 1000, Margin = new Thickness(14, 5, 14, 3) };
    private readonly TextBlock _time = new() { Foreground = Brushes.White, FontSize = 13, Margin = new Thickness(8), VerticalAlignment = VerticalAlignment.Center };
    private readonly StackPanel _controls = new() { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Center };
    private readonly Grid _footer = new() { Background = new SolidColorBrush(Color.FromRgb(19, 14, 28)) };
    private readonly ComboBox _audio = new() { MinWidth = 125, MaxWidth = 240, Margin = new Thickness(4) };
    private readonly ComboBox _subs = new() { MinWidth = 125, MaxWidth = 240, Margin = new Thickness(4) };
    private bool _drag, _trackUpdate, _disposed, _fallback, _starting;
    private long _generation, _lastMotion, _lastTime;
    private int _ticks;
    private string _trackSignature = "";
    public Playback(CatalogStore store, Func<PlaybackPreferences> preferences, Dispatcher dispatcher)
    {
        _store = store; _preferences = preferences; _ui = dispatcher;
        Surface.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Surface.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        Surface.Children.Add(Video); Surface.Children.Add(_footer); Grid.SetRow(_footer, 1);
        _footer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); _footer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _footer.Children.Add(_seek); _footer.Children.Add(_controls); Grid.SetRow(_controls, 1);
        _controls.Children.Add(Button("−10", () => SeekBy(-10000))); _controls.Children.Add(Button("▶ / Ⅱ", TogglePause)); _controls.Children.Add(Button("+10", () => SeekBy(10000)));
        _controls.Children.Add(_time); _controls.Children.Add(_audio); _controls.Children.Add(_subs);
        _controls.Children.Add(Button("ترجمة ملف", () => { var dialog = new OpenFileDialog { Filter = "Subtitles|*.srt;*.ass;*.ssa;*.vtt" }; if (dialog.ShowDialog() == true) _player?.AddSlave(MediaSlaveType.Subtitle, new Uri(dialog.FileName).AbsoluteUri, true); }));
        _controls.Children.Add(Button("⛶", () => FullscreenRequested?.Invoke()));
        var volume = new Slider { Minimum = 0, Maximum = 100, Value = preferences().Volume, Width = 90, Margin = new Thickness(8), VerticalAlignment = VerticalAlignment.Center, ToolTip = "الصوت" };
        volume.ValueChanged += (_, _) => { if (_player != null) _player.Volume = (int)volume.Value; }; _controls.Children.Add(volume);
        _audio.SelectionChanged += (_, _) => { if (!_trackUpdate && _audio.SelectedItem is TrackOption t) _player?.SetAudioTrack(t.Id); };
        _subs.SelectionChanged += (_, _) => { if (!_trackUpdate && _subs.SelectedItem is TrackOption t) _player?.SetSpu(t.Id); };
        _seek.AddHandler(Thumb.DragStartedEvent, new DragStartedEventHandler((_, _) => _drag = true));
        _seek.AddHandler(Thumb.DragCompletedEvent, new DragCompletedEventHandler((_, _) => { _drag = false; if (!IsLive && _player is { Length: > 0 }) _player.Time = (long)(_seek.Value * _player.Length / 1000); }));
        _seek.PreviewMouseLeftButtonUp += (_, _) => { if (!_drag && !IsLive && _player is { Length: > 0 }) _player.Time = (long)(_seek.Value * _player.Length / 1000); };
        Video.MouseDoubleClick += (_, _) => FullscreenRequested?.Invoke();
        _timer = new DispatcherTimer(TimeSpan.FromMilliseconds(500), DispatcherPriority.Background, Tick, dispatcher); _timer.Start();
        SetPreview(false);
    }
    private static Button Button(string title, Action action)
    {
        var b = new Button { Content = title, Margin = new Thickness(4), Padding = new Thickness(10, 6, 10, 6), MinHeight = 34 };
        b.Click += (_, _) => action(); return b;
    }
    private async Task EnsurePlayer()
    {
        if (_player != null) return;
        var prefs = _preferences();
        await Task.Run(() =>
        {
            LibVLCSharp.Shared.Core.Initialize(Path.Combine(AppContext.BaseDirectory, "libvlc", "win-x64"));
            _vlc = new LibVLC("--no-video-title-show", "--no-osd", "--quiet");
            _player = new VlcPlayer(_vlc) { EnableHardwareDecoding = prefs.Hardware, Volume = prefs.Volume };
        });
        Video.MediaPlayer = _player;
        _player!.EncounteredError += (_, _) => Dispatch(() => { if (!_starting && !_disposed) Status?.Invoke("تعذر تشغيل هذا المصدر؛ سيحاول التطبيق صيغة البث البديلة للبث المباشر"); });
        _player.EndReached += (_, _) => Dispatch(() => { if (!_disposed) Ended?.Invoke(); });
    }
    private void Dispatch(Action action) { if (!_disposed && !_ui.HasShutdownStarted) _ui.BeginInvoke(action); }
    public async Task Start(Provider provider, Entry entry, long resume = 0, CancellationToken ct = default)
    {
        long generation = Interlocked.Increment(ref _generation);
        await _serial.WaitAsync(ct);
        try
        {
            if (_disposed || generation != _generation) return;
            await EnsurePlayer(); await SavePosition();
            _starting = true;
            await Task.Run(() => _player!.Stop(), ct);
            ct.ThrowIfCancellationRequested(); if (_disposed || generation != _generation) return;
            Provider = provider; Current = entry; _fallback = false; _trackSignature = ""; _lastTime = 0;
            _lastMotion = Stopwatch.GetTimestamp();
            Status?.Invoke("جاري التشغيل • " + entry.Name);
            await PlayUrl(Urls.Stream(provider, entry), resume, ct);
            if (entry.Kind == "live") await _store.SaveWatch(provider, entry, 0, 0);
            _seek.Visibility = entry.Kind == "live" ? Visibility.Collapsed : Visibility.Visible;
            SetPreview(_footer.Visibility == Visibility.Collapsed);
        }
        finally { _starting = false; _serial.Release(); }
    }
    private async Task PlayUrl(Uri url, long resume, CancellationToken ct)
    {
        var p = Provider!; var item = Current!; var prefs = _preferences();
        await Task.Run(() =>
        {
            ct.ThrowIfCancellationRequested();
            using var media = new Media(_vlc!, url);
            media.AddOption(":network-caching=" + Math.Clamp(prefs.CacheMs, 200, 5000));
            var userAgent = item.HeaderUserAgent.Length > 0 ? item.HeaderUserAgent : p.UserAgent;
            media.AddOption(":http-user-agent=" + Urls.Header(string.IsNullOrWhiteSpace(userAgent) ? CompatibilityDefaults.UserAgent : userAgent));
            var referer = item.HeaderReferer.Length > 0 ? item.HeaderReferer : p.Referer;
            if (referer.Length > 0) media.AddOption(":http-referrer=" + Urls.Http(referer).AbsoluteUri);
            media.AddOption(":audio-language=" + Urls.Header(prefs.AudioLanguage));
            media.AddOption(":sub-language=" + Urls.Header(prefs.SubtitleLanguage));
            if (resume > 0) media.AddOption(":start-time=" + (resume / 1000.0).ToString(System.Globalization.CultureInfo.InvariantCulture));
            _player!.EnableHardwareDecoding = prefs.Hardware;
            if (!_player.Play(media)) throw new InvalidDataException("محرك التشغيل رفض مصدر الفيديو");
        }, ct);
    }
    public void Attach(Panel parent)
    {
        if (Surface.Parent is Panel old) old.Children.Remove(Surface);
        parent.Children.Add(Surface);
    }
    public void SetPreview(bool preview) => _footer.Visibility = preview ? Visibility.Collapsed : Visibility.Visible;
    public void TogglePause() { if (_player != null) _player.SetPause(_player.IsPlaying); }
    public void SeekBy(long offset) { if (!IsLive && _player is { Length: > 0 } p) p.Time = Math.Clamp(p.Time + offset, 0, p.Length); }
    public void Fit() { if (_player != null) _player.AspectRatio = _preferences().FillVideo ? "16:9" : null; }
    private async void Tick(object? sender, EventArgs e)
    {
        if (_disposed || _player == null || Current == null || _starting) return;
        try
        {
            long now = _player.Time, length = _player.Length;
            if (now != _lastTime) { _lastTime = now; _lastMotion = Stopwatch.GetTimestamp(); }
            _time.Text = IsLive ? "مباشر" : Format(now) + " / " + Format(length);
            if (!_drag && length > 0) _seek.Value = Math.Clamp(now * 1000.0 / length, 0, 1000);
            if (++_ticks % 4 == 0) UpdateTracks();
            if (_ticks % 10 == 0) await SavePosition();
            if (IsLive && Provider?.Type == "xtream" && Current.Url.Length == 0 && _player.State != VLCState.Paused && !_fallback && Stopwatch.GetElapsedTime(_lastMotion) > TimeSpan.FromSeconds(12))
            {
                _fallback = true; long retryGeneration = _generation; await _serial.WaitAsync();
                try
                {
                    if (_disposed || retryGeneration != _generation || !IsLive || Provider == null) return;
                    _starting = true; await Task.Run(() => _player.Stop());
                    string alt = Provider.LiveFormat == "ts" ? "m3u8" : "ts";
                    Status?.Invoke("البث تأخر؛ إعادة المحاولة تلقائيًا بصيغة " + alt.ToUpperInvariant()); _lastMotion = Stopwatch.GetTimestamp();
                    await PlayUrl(Urls.Stream(Provider, Current!, alt), 0, CancellationToken.None);
                }
                finally { _starting = false; _serial.Release(); }
            }
            else if (!IsLive && _player.State == VLCState.Error && Stopwatch.GetElapsedTime(_lastMotion) > TimeSpan.FromSeconds(8))
            {
                Status?.Invoke("تعذر استمرار الفيديو؛ جرّب تعطيل فك الترميز العتادي من الإعدادات لهذا الجهاز");
            }
        }
        catch (Exception ex) { Status?.Invoke(Urls.Error(ex)); }
    }
    private void UpdateTracks()
    {
        if (_player == null) return;
        var audio = _player.AudioTrackDescription; var subs = _player.SpuDescription;
        string signature = string.Join("|", audio.Select(t => "a" + t.Id + t.Name).Concat(subs.Select(t => "s" + t.Id + t.Name)));
        if (signature == _trackSignature) return; _trackSignature = signature;
        _trackUpdate = true;
        try
        {
            _audio.ItemsSource = audio.Select(t => new TrackOption(t.Id, "صوت: " + t.Name)).ToList();
            _audio.SelectedItem = _audio.Items.Cast<TrackOption>().FirstOrDefault(t => t.Id == _player.AudioTrack);
            _subs.ItemsSource = subs.Select(t => new TrackOption(t.Id, t.Id == -1 ? "بدون ترجمة" : "ترجمة: " + t.Name)).ToList();
            _subs.SelectedItem = _subs.Items.Cast<TrackOption>().FirstOrDefault(t => t.Id == _player.Spu);
        }
        finally { _trackUpdate = false; }
        Fit();
    }
    private static string Format(long ms) => ms <= 0 ? "00:00" : TimeSpan.FromMilliseconds(ms).TotalHours >= 1 ? TimeSpan.FromMilliseconds(ms).ToString(@"h\:mm\:ss") : TimeSpan.FromMilliseconds(ms).ToString(@"mm\:ss");
    public Task SavePosition()
    {
        var p = Provider; var current = Current; var player = _player;
        if (p == null || current == null || player == null || current.Kind == "live") return Task.CompletedTask;
        long pos = Math.Max(player.Time, 0), duration = Math.Max(player.Length, 0);
        if (pos <= 0) return Task.CompletedTask;
        return _store.SaveWatch(p, current, pos, duration);
    }
    public async Task Stop()
    {
        Interlocked.Increment(ref _generation); await _serial.WaitAsync();
        try { await SavePosition(); _starting = true; if (_player != null) await Task.Run(() => _player.Stop()); Current = null; Provider = null; }
        finally { _starting = false; _serial.Release(); }
    }
    public async ValueTask DisposeAsync()
    {
        if (_disposed) return; _timer.Stop(); await Stop(); _disposed = true; Video.MediaPlayer = null;
        await Task.Run(() => { _player?.Dispose(); _vlc?.Dispose(); }); Video.Dispose();
    }
    private sealed record TrackOption(int Id, string Name) { public override string ToString() => Name; }
}
