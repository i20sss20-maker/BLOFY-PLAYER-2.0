using BlofyPlayer.Windows.Core;
using LibVLCSharp.Shared;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Threading;

namespace BlofyPlayer.Windows;

public partial class PlayerOverlay : UserControl, IAsyncDisposable
{
    private readonly LibVLC _libVlc;
    private readonly MediaPlayer _player;
    private readonly DispatcherTimer _timer;
    private readonly DispatcherTimer _hudTimer;
    private readonly IReadOnlyList<StreamItem> _playlist;
    private readonly Func<StreamItem, string>? _urlResolver;
    private readonly Func<StreamItem, IReadOnlyList<string>>? _recoveryResolver;
    private readonly Func<long, long, Task>? _savePosition;
    private readonly Func<StreamItem, Task>? _onPlaylistItemChanged;
    private readonly Func<Task>? _onEnded;
    private readonly AppSettings _settings;
    private readonly Func<PlayerOverlay, Task> _closeHandler;
    private readonly Action<bool> _fullscreenHandler;
    private int _index;
    private bool _fullscreen;
    private bool _resumeApplied;
    private readonly long _resumePosition;
    private List<string> _recoveryUrls = [];
    private int _recoveryIndex;
    private long _lastObservedTime = -1;
    private DateTimeOffset _lastProgressAt = DateTimeOffset.UtcNow;
    private DateTimeOffset _playStartedAt = DateTimeOffset.UtcNow;
    private bool _videoOutputSeen;
    private int _automaticRecoveries;
    private long _pendingRecoveryResume;
    private bool _disposed;

    public PlayerOverlay(
        string title,
        string url,
        Func<PlayerOverlay, Task> closeHandler,
        Action<bool> fullscreenHandler,
        long resumePositionMs = 0,
        IReadOnlyList<StreamItem>? playlist = null,
        int playlistIndex = -1,
        Func<StreamItem, string>? urlResolver = null,
        Func<StreamItem, IReadOnlyList<string>>? recoveryResolver = null,
        IReadOnlyList<string>? recoveryUrls = null,
        Func<long, long, Task>? savePosition = null,
        Func<StreamItem, Task>? onPlaylistItemChanged = null,
        AppSettings? settings = null,
        Func<Task>? onEnded = null)
    {
        InitializeComponent();
        _closeHandler = closeHandler;
        _fullscreenHandler = fullscreenHandler;
        _settings = settings ?? new AppSettings();
        _onEnded = onEnded;

        Core.Initialize();
        var options = new List<string>
        {
            "--no-video-title-show",
            "--network-caching=650",
            "--live-caching=450",
            "--file-caching=500",
            "--avcodec-hw=any"
        };
        if (_settings.SubtitleLanguage is "ar" or "auto")
            options.Add("--sub-language=ara,ar,eng,en");
        var subtitleScale = _settings.SubtitleSize switch { "large" => 125, "medium" => 105, _ => 85 };
        options.Add("--sub-text-scale=" + subtitleScale);
        if (_settings.AudioOutput == "stereo") options.Add("--audio-channels=2");

        _libVlc = new LibVLC(options.ToArray());
        _player = new MediaPlayer(_libVlc);
        VideoView.MediaPlayer = _player;
        _playlist = playlist ?? [];
        _index = playlistIndex;
        _urlResolver = urlResolver;
        _recoveryResolver = recoveryResolver;
        _recoveryUrls = NormalizeRecoveryUrls(url, recoveryUrls);
        _savePosition = savePosition;
        _onPlaylistItemChanged = onPlaylistItemChanged;
        _resumePosition = resumePositionMs;

        TitleText.Text = title;
        TopTitleText.Text = title;
        EpgText.Text = _playlist.Count > 0 ? "بث مباشر" : "BLOFY PLAYER";

        _player.Playing += (_, _) => Dispatcher.Invoke(() =>
        {
            ApplyResumeOnce();
            _lastProgressAt = DateTimeOffset.UtcNow;
        });
        _player.EncounteredError += (_, _) => Dispatcher.Invoke(() =>
            TryRecoverPlayback("تعذر التشغيل — تجربة مسار بديل…"));
        _player.EndReached += (_, _) => Dispatcher.Invoke(HandleEnded);

        _timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
        _timer.Tick += (_, _) => RefreshHud();

        _hudTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(4) };
        _hudTimer.Tick += (_, _) => HideHud();

        Loaded += (_, _) =>
        {
            if (_disposed) return;
            _timer.Start();
            PlayCurrentCandidate();
            ShowHudBriefly();
            Focus();
        };
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        _timer.Stop();
        _hudTimer.Stop();
        try
        {
            if (_savePosition is not null)
                await _savePosition(Math.Max(0, _player.Time), Math.Max(0, _player.Length));
        }
        catch { }
        try { _player.Stop(); } catch { }
        _player.Dispose();
        _libVlc.Dispose();
    }

    private void PlayCurrentCandidate(long preservePosition = 0)
    {
        if (_recoveryUrls.Count == 0)
        {
            EpgText.Text = "لا يوجد رابط تشغيل صالح";
            ShowHudBriefly();
            return;
        }
        _recoveryIndex = Math.Clamp(_recoveryIndex, 0, _recoveryUrls.Count - 1);
        PlayUrl(_recoveryUrls[_recoveryIndex], preservePosition);
    }

    private void PlayUrl(string url, long preservePosition = 0)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
        {
            TryRecoverPlayback("رابط غير صالح — تجربة المسار التالي…");
            return;
        }

        _playStartedAt = DateTimeOffset.UtcNow;
        _lastProgressAt = _playStartedAt;
        _lastObservedTime = -1;
        _videoOutputSeen = false;

        if (preservePosition > 0)
        {
            _resumeApplied = false;
            _pendingRecoveryResume = preservePosition;
        }

        using var media = new Media(_libVlc, uri);
        media.AddOption(":http-user-agent=" + _settings.UserAgent);
        media.AddOption(":http-referrer=" + uri.GetLeftPart(UriPartial.Authority) + "/");
        media.AddOption(":network-caching=" + (_playlist.Count > 0 ? "450" : "850"));
        if (_settings.SubtitleLanguage == "off") media.AddOption(":no-spu");
        _player.Play(media);
        ApplyAspect(_settings.Aspect);
    }

    private static List<string> NormalizeRecoveryUrls(string primary, IReadOnlyList<string>? recovery)
    {
        var result = new List<string>();
        void Add(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return;
            if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)) return;
            if (uri.Scheme is not ("http" or "https")) return;
            if (result.Any(x => x.Equals(value.Trim(), StringComparison.OrdinalIgnoreCase))) return;
            result.Add(value.Trim());
        }

        Add(primary);
        if (recovery is not null)
            foreach (var value in recovery) Add(value);
        return result;
    }

    private void TryRecoverPlayback(string message)
    {
        if (_recoveryUrls.Count <= 1 || _automaticRecoveries >= Math.Min(3, _recoveryUrls.Count))
        {
            EpgText.Text = "تعذر التشغيل. جرّب إعادة فتح المحتوى.";
            ShowHudBriefly();
            return;
        }

        var preserve = Math.Max(_player.Time, _pendingRecoveryResume);
        _automaticRecoveries++;
        _recoveryIndex = (_recoveryIndex + 1) % _recoveryUrls.Count;
        EpgText.Text = message;
        ShowHudBriefly();
        PlayCurrentCandidate(preserve);
    }

    private async void HandleEnded()
    {
        if (_playlist.Count > 0 && _index >= 0 && _index + 1 < _playlist.Count)
        {
            ChangeChannel(1);
            return;
        }

        if (_onEnded is null) return;
        try
        {
            await _closeHandler(this);
            await _onEnded();
        }
        catch { }
    }

    private void ApplyResumeOnce()
    {
        if (_resumeApplied) return;
        var target = Math.Max(_resumePosition, _pendingRecoveryResume);
        if (target <= 0) return;
        _resumeApplied = true;
        _pendingRecoveryResume = 0;
        _player.Time = target;
    }

    private void RefreshHud()
    {
        var length = Math.Max(0, _player.Length);
        var time = Math.Max(0, _player.Time);
        SeekSlider.Maximum = Math.Max(1, length);
        if (!SeekSlider.IsMouseCaptureWithin) SeekSlider.Value = Math.Min(time, SeekSlider.Maximum);
        TimeText.Text = Format(time) + " / " + Format(length);
        PlayPauseButton.Content = _player.IsPlaying ? "⏸" : "▶";
        SeekSlider.Visibility = length > 0 ? Visibility.Visible : Visibility.Collapsed;
        PreviousButton.ToolTip = _playlist.Count > 0 ? "القناة السابقة" : "رجوع 10 ثوان";
        NextButton.ToolTip = _playlist.Count > 0 ? "القناة التالية" : "تقديم 10 ثوان";

        if (!_videoOutputSeen && HasVideoOutput()) _videoOutputSeen = true;

        if (_playlist.Count > 0 &&
            !_videoOutputSeen &&
            DateTimeOffset.UtcNow - _playStartedAt > TimeSpan.FromSeconds(8) &&
            _automaticRecoveries < Math.Min(3, _recoveryUrls.Count))
        {
            _playStartedAt = DateTimeOffset.UtcNow;
            TryRecoverPlayback("لا توجد صورة — تجربة مسار بديل…");
            return;
        }

        if (time > 0 && time != _lastObservedTime)
        {
            _lastObservedTime = time;
            _lastProgressAt = DateTimeOffset.UtcNow;
            if (_automaticRecoveries > 0 &&
                DateTimeOffset.UtcNow - _playStartedAt > TimeSpan.FromSeconds(30))
                _automaticRecoveries = 0;
        }
        else if (_player.IsPlaying && time > 0 &&
                 DateTimeOffset.UtcNow - _lastProgressAt > TimeSpan.FromSeconds(12))
        {
            _lastProgressAt = DateTimeOffset.UtcNow;
            TryRecoverPlayback("توقف البث — إعادة الاتصال…");
        }
        else if (!_player.IsPlaying &&
                 DateTimeOffset.UtcNow - _playStartedAt > TimeSpan.FromSeconds(10) &&
                 _automaticRecoveries == 0)
        {
            TryRecoverPlayback("تأخر بدء التشغيل — تجربة مسار بديل…");
        }
    }

    private static string Format(long ms)
    {
        var t = TimeSpan.FromMilliseconds(ms);
        return t.TotalHours >= 1 ? t.ToString(@"hh\:mm\:ss") : t.ToString(@"mm\:ss");
    }

    private void PlayPause_Click(object sender, RoutedEventArgs e)
    {
        if (_player.IsPlaying) _player.Pause();
        else _player.Play();
        ShowHudBriefly();
    }

    private void Back_Click(object sender, RoutedEventArgs e)
    {
        if (_playlist.Count > 0 && _urlResolver is not null) ChangeChannel(-1);
        else Seek(-10_000);
        ShowHudBriefly();
    }

    private void Forward_Click(object sender, RoutedEventArgs e)
    {
        if (_playlist.Count > 0 && _urlResolver is not null) ChangeChannel(1);
        else Seek(10_000);
        ShowHudBriefly();
    }

    private void Seek(long delta)
    {
        if (_player.Length <= 0) return;
        _player.Time = Math.Clamp(_player.Time + delta, 0, _player.Length);
    }

    private void SeekSlider_MouseUp(object sender, MouseButtonEventArgs e)
    {
        if (_player.Length > 0) _player.Time = (long)SeekSlider.Value;
    }

    private void Audio_Click(object sender, RoutedEventArgs e)
    {
        var menu = new ContextMenu { PlacementTarget = sender as Button, Placement = PlacementMode.Top };
        if (_player.AudioTrackDescription.Length == 0)
            menu.Items.Add(new MenuItem { Header = "لا توجد مسارات صوت", IsEnabled = false });
        else
        {
            foreach (var track in _player.AudioTrackDescription)
            {
                var item = new MenuItem
                {
                    Header = (track.Id == _player.AudioTrack ? "✓  " : "") + track.Name,
                    Tag = track.Id
                };
                item.Click += (_, _) =>
                {
                    _player.SetAudioTrack((int)item.Tag);
                    EpgText.Text = "الصوت: " + track.Name;
                    ShowHudBriefly();
                };
                menu.Items.Add(item);
            }
        }
        menu.IsOpen = true;
        ShowHudBriefly();
    }

    private void Subtitle_Click(object sender, RoutedEventArgs e)
    {
        var tracks = _player.SpuDescription;
        var menu = new ContextMenu { PlacementTarget = sender as Button, Placement = PlacementMode.Top };
        var off = new MenuItem { Header = _player.Spu < 0 ? "✓  إيقاف الترجمة" : "إيقاف الترجمة" };
        off.Click += (_, _) =>
        {
            _player.SetSpu(-1);
            EpgText.Text = "الترجمة: إيقاف";
            ShowHudBriefly();
        };
        menu.Items.Add(off);
        menu.Items.Add(new Separator());

        foreach (var track in tracks.Where(t => t.Id >= 0))
        {
            var item = new MenuItem
            {
                Header = (track.Id == _player.Spu ? "✓  " : "") + track.Name,
                Tag = track.Id
            };
            item.Click += (_, _) =>
            {
                _player.SetSpu((int)item.Tag);
                EpgText.Text = "الترجمة: " + track.Name;
                ShowHudBriefly();
            };
            menu.Items.Add(item);
        }

        if (tracks.Length == 0)
            menu.Items.Add(new MenuItem { Header = "لا توجد ترجمة مضمّنة", IsEnabled = false });
        menu.IsOpen = true;
        ShowHudBriefly();
    }

    private void Fullscreen_Click(object sender, RoutedEventArgs e)
    {
        _fullscreen = !_fullscreen;
        FullscreenButton.Content = _fullscreen ? "🗗 نافذة" : "⛶ الشاشة";
        _fullscreenHandler(_fullscreen);
        ShowHudBriefly();
    }

    private void Quality_Click(object sender, RoutedEventArgs e)
    {
        var menu = new ContextMenu { PlacementTarget = sender as Button, Placement = PlacementMode.Top };
        menu.Items.Add(new MenuItem { Header = "✓  تلقائي — أفضل جودة متاحة", IsEnabled = false });
        menu.Items.Add(new Separator());
        menu.Items.Add(new MenuItem
        {
            Header = "BLOFY يستخدم مسار السيرفر الأصلي / HLS التكيفي",
            IsEnabled = false
        });
        menu.IsOpen = true;
        ShowHudBriefly();
    }

    private void Aspect_Click(object sender, RoutedEventArgs e)
    {
        var menu = new ContextMenu { PlacementTarget = sender as Button, Placement = PlacementMode.Top };
        foreach (var option in new[]
        {
            ("ملاءمة تلقائية", "fit"),
            ("16:9", "16:9"),
            ("4:3", "4:3"),
            ("ملء الشاشة", "fill")
        })
        {
            var item = new MenuItem
            {
                Header = (_settings.Aspect == option.Item2 ? "✓  " : "") + option.Item1,
                Tag = option.Item2
            };
            item.Click += (_, _) =>
            {
                _settings.Aspect = option.Item2;
                ApplyAspect(option.Item2);
                EpgText.Text = "المقاس: " + option.Item1;
                ShowHudBriefly();
            };
            menu.Items.Add(item);
        }
        menu.IsOpen = true;
        ShowHudBriefly();
    }

    private void ApplyAspect(string? mode)
    {
        try
        {
            var property = _player.GetType().GetProperty("AspectRatio");
            string? value = mode switch
            {
                "16:9" => "16:9",
                "4:3" => "4:3",
                "fill" => Math.Max(1, (int)ActualWidth) + ":" + Math.Max(1, (int)ActualHeight),
                _ => null
            };
            property?.SetValue(_player, value);
        }
        catch { }
    }

    private bool HasVideoOutput()
    {
        try
        {
            var property = _player.GetType().GetProperty("Vout");
            if (property?.GetValue(_player) is uint u) return u > 0;
            if (property?.GetValue(_player) is int i) return i > 0;
            if (property?.GetValue(_player) is long l) return l > 0;
        }
        catch { }
        return _playlist.Count == 0 && _player.Time > 0;
    }

    private void ShowHudBriefly()
    {
        Hud.Visibility = Visibility.Visible;
        TopShade.Visibility = Visibility.Visible;
        _hudTimer.Stop();
        _hudTimer.Start();
    }

    private void HideHud()
    {
        _hudTimer.Stop();
        if (!_player.IsPlaying) return;
        Hud.Visibility = Visibility.Collapsed;
        TopShade.Visibility = Visibility.Collapsed;
    }

    private void Overlay_MouseMove(object sender, MouseEventArgs e) => ShowHudBriefly();

    private async void ChangeChannel(int delta)
    {
        if (_playlist.Count == 0 || _urlResolver is null) return;
        _index = (_index + delta + _playlist.Count) % _playlist.Count;
        var item = _playlist[_index];
        TitleText.Text = item.Name;
        TopTitleText.Text = item.Name;
        EpgText.Text = "القناة " + (_index + 1).ToString("N0") + " من " + _playlist.Count.ToString("N0");
        _resumeApplied = true;
        _automaticRecoveries = 0;
        _recoveryIndex = 0;
        _recoveryUrls = _recoveryResolver is not null
            ? NormalizeRecoveryUrls(_urlResolver(item), _recoveryResolver(item))
            : NormalizeRecoveryUrls(_urlResolver(item), null);
        PlayCurrentCandidate();
        ShowHudBriefly();
        if (_onPlaylistItemChanged is not null)
        {
            try { await _onPlaylistItemChanged(item); } catch { }
        }
    }

    private async void Overlay_KeyDown(object sender, KeyEventArgs e)
    {
        if (Hud.Visibility != Visibility.Visible && e.Key is not Key.Escape and not Key.F)
        {
            ShowHudBriefly();
            e.Handled = true;
            return;
        }

        switch (e.Key)
        {
            case Key.Space:
            case Key.Enter:
                PlayPause_Click(sender, e);
                e.Handled = true;
                break;
            case Key.Left:
                if (_playlist.Count > 0 && _urlResolver is not null) ChangeChannel(-1); else Seek(-10_000);
                ShowHudBriefly();
                e.Handled = true;
                break;
            case Key.Right:
                if (_playlist.Count > 0 && _urlResolver is not null) ChangeChannel(1); else Seek(10_000);
                ShowHudBriefly();
                e.Handled = true;
                break;
            case Key.Up:
                ChangeChannel(-1);
                e.Handled = true;
                break;
            case Key.Down:
                ChangeChannel(1);
                e.Handled = true;
                break;
            case Key.F:
                Fullscreen_Click(sender, e);
                e.Handled = true;
                break;
            case Key.M:
                _player.Mute = !_player.Mute;
                EpgText.Text = _player.Mute ? "الصوت مكتوم" : "الصوت مفعّل";
                ShowHudBriefly();
                e.Handled = true;
                break;
            case Key.Escape:
                if (_fullscreen)
                {
                    _fullscreen = false;
                    FullscreenButton.Content = "⛶ الشاشة";
                    _fullscreenHandler(false);
                }
                else
                {
                    await _closeHandler(this);
                }
                e.Handled = true;
                break;
        }
    }

    private async void Close_Click(object sender, RoutedEventArgs e) =>
        await _closeHandler(this);
}
