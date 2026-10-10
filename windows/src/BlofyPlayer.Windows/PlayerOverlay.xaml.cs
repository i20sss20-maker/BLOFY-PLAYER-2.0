using BlofyPlayer.Windows.Core;
using LibVLCSharp.Shared;
using VlcMediaPlayer = LibVLCSharp.Shared.MediaPlayer;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace BlofyPlayer.Windows;

public partial class PlayerOverlay : UserControl, IAsyncDisposable
{
    private const string CompatibilityUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    private readonly LibVLC _libVlc;
    private readonly VlcMediaPlayer _player;
    private readonly DispatcherTimer _timer;
    private readonly DispatcherTimer _hudTimer;
    private readonly DispatcherTimer _channelNumberTimer;
    private readonly DispatcherTimer _zapTimer;
    private readonly SemaphoreSlim _nativePlaybackGate = new(1, 1);
    private int _playbackGeneration;
    private CancellationTokenSource? _epgCts;
    private int _pendingZapDelta;
    private readonly IReadOnlyList<StreamItem> _playlist;
    private readonly Func<StreamItem, string>? _urlResolver;
    private readonly Func<StreamItem, IReadOnlyList<string>>? _recoveryResolver;
    private readonly Func<long, long, Task>? _savePosition;
    private readonly Func<StreamItem, Task>? _onPlaylistItemChanged;
    private readonly Func<StreamItem, bool>? _favoriteResolver;
    private readonly Func<StreamItem, CancellationToken, Task<string>>? _epgResolver;
    private readonly Func<Task>? _previousAction;
    private readonly Func<Task>? _nextAction;
    private readonly Func<Task<bool>>? _toggleFavorite;
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
    private bool _playbackFailed;
    private int _hudPolling;
    private bool _initializedOnce;
    private bool _userPaused;
    private bool _startedPlaying;
    private readonly List<string> _playbackDiagnostic = new();
    private Point? _lastPointerPosition;
    private bool _compatibilityUserAgent;
    private bool _favorite;
    private string _channelDigits = "";
    private int _previousLiveIndex = -1;

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
        Func<StreamItem, bool>? favoriteResolver = null,
        Func<StreamItem, CancellationToken, Task<string>>? epgResolver = null,
        Func<Task>? previousAction = null,
        Func<Task>? nextAction = null,
        bool? favorite = null,
        Func<Task<bool>>? toggleFavorite = null,
        AppSettings? settings = null,
        Func<Task>? onEnded = null)
    {
        InitializeComponent();
        _closeHandler = closeHandler;
        _fullscreenHandler = fullscreenHandler;
        _settings = settings ?? new AppSettings();
        _onEnded = onEnded;

        LibVLCSharp.Shared.Core.Initialize();
        var options = new List<string>
        {
            "--no-video-title-show",
            "--network-caching=420",
            "--live-caching=350",
            "--file-caching=350",
            "--avcodec-hw=any"
        };
        if (_settings.SubtitleLanguage is "ar" or "auto")
            options.Add("--sub-language=ara,ar,eng,en");
        var subtitleScale = _settings.SubtitleSize switch { "large" => 125, "medium" => 105, _ => 85 };
        options.Add("--sub-text-scale=" + subtitleScale);
        if (_settings.AudioOutput == "stereo") options.Add("--audio-channels=2");

        _libVlc = new LibVLC(options.ToArray());
        _player = new VlcMediaPlayer(_libVlc);
        VideoView.MediaPlayer = _player;
        _playlist = playlist ?? [];
        _index = playlistIndex;
        _urlResolver = urlResolver;
        _recoveryResolver = recoveryResolver;
        _recoveryUrls = NormalizeRecoveryUrls(url, recoveryUrls);
        _savePosition = savePosition;
        _onPlaylistItemChanged = onPlaylistItemChanged;
        _favoriteResolver = favoriteResolver;
        _epgResolver = epgResolver;
        _previousAction = previousAction;
        _nextAction = nextAction;
        _toggleFavorite = toggleFavorite;
        _favorite = favorite == true;
        _resumePosition = resumePositionMs;

        TitleText.Text = title;
        TopTitleText.Text = title;
        EpgText.Text = _playlist.Count > 0 ? "بث مباشر" : "BLOFY PLAYER";

        // VLC raises callbacks on native playback threads. Never synchronously
        // wait on the WPF dispatcher, especially while starting/stopping media.
        _player.Playing += (_, _) => DispatchPlayerEvent(() =>
        {
            TrackPlayback("محرك VLC بدأ التشغيل");
            _startedPlaying = true;
            _userPaused = false;
            _lastProgressAt = DateTimeOffset.UtcNow;
            ApplyResumeOnce();
            ApplyAspect(_settings.Aspect);
            // "Playing" may precede the first video frame. Use the real
            // LibVLCSharp VoutCount property, not reflection on "Vout"
            // (which never existed and made every live channel retry at 10s).
            if (HasVideoOutput()) MarkPlaybackReady();
        });
        _player.EncounteredError += (_, _) => DispatchPlayerEvent(() =>
        {
            TrackPlayback("حدث خطأ من محرك VLC");
            TryRecoverPlayback("تعذر التشغيل — تجربة مسار بديل…");
        });
        _player.EndReached += (_, _) => DispatchPlayerEvent(HandleEnded);

        _timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(750) };
        _timer.Tick += async (_, _) => await RefreshHudAsync();

        _hudTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(4) };
        _hudTimer.Tick += (_, _) => HideHud();

        _channelNumberTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1200) };
        _channelNumberTimer.Tick += (_, _) => CommitChannelNumber();

        _zapTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(180) };
        _zapTimer.Tick += (_, _) => ApplyPendingZap();

        Loaded += (_, _) =>
        {
            if (_disposed || _initializedOnce) return;
            _initializedOnce = true;
            _timer.Start();
            ConfigureControlVisibility();
            UpdateFavoriteButton();
            PopulateChannelList();
            SetFullscreenState(true);
            PlayCurrentCandidate();
            if (_playlist.Count > 0 && _index >= 0)
            {
                ShowChannelPosition(_index + 1, 950);
                _ = RefreshEpgAsync(_playlist[_index]);
            }
            ShowHudBriefly();
            PlayPauseButton.Focus();
        };
    }

    private void DispatchPlayerEvent(Action action)
    {
        if (_disposed || Dispatcher.HasShutdownStarted || Dispatcher.HasShutdownFinished) return;
        _ = Dispatcher.BeginInvoke(new Action(() => { if (!_disposed) action(); }));
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        _timer.Stop();
        _hudTimer.Stop();
        _channelNumberTimer.Stop();
        _zapTimer.Stop();
        _epgCts?.Cancel();
        _epgCts?.Dispose();
        try
        {
            if (_savePosition is not null)
                await _savePosition(Math.Max(0, _player.Time), Math.Max(0, _player.Length));
        }
        catch { }
        try { VideoView.MediaPlayer = null; } catch { }
        // LibVLC stop/dispose can synchronously wait on the decoder;
        // executing them on WPF's thread locks every navigation control.
        Interlocked.Increment(ref _playbackGeneration);
        var release = Task.Run(async () =>
        {
            await _nativePlaybackGate.WaitAsync();
            try
            {
                try { _player.Stop(); } catch { }
                try { _player.Dispose(); } catch { }
                try { _libVlc.Dispose(); } catch { }
            }
            finally { _nativePlaybackGate.Release(); }
        });
        await Task.WhenAny(release, Task.Delay(2500));
    }

    private void TrackPlayback(string eventText)
    {
        // No URLs, hostnames, stream IDs, credentials, device IDs or tokens.
        // Reports can be safely copied to support without revealing accounts.
        _playbackDiagnostic.Add(DateTime.Now.ToString("HH:mm:ss") + " | " + eventText);
        if (_playbackDiagnostic.Count > 25) _playbackDiagnostic.RemoveAt(0);
    }

    private void CopyPlaybackReport_Click(object sender, RoutedEventArgs e)
    {
        var report = "BLOFY PLAYER Windows • playback diagnosis" + Environment.NewLine +
            "Kind: " + (_playlist.Count > 0 ? "Live" : "VOD") + Environment.NewLine +
            "Output detected: " + _videoOutputSeen + Environment.NewLine +
            "Playing reported: " + _startedPlaying + Environment.NewLine +
            "User paused: " + _userPaused + Environment.NewLine +
            "Alternatives attempted: " + (_automaticRecoveries + 1) + Environment.NewLine +
            "Events:" + Environment.NewLine +
            string.Join(Environment.NewLine, _playbackDiagnostic);
        try
        {
            Clipboard.SetText(report);
            EpgText.Text = "تم نسخ تقرير التشخيص بدون روابط أو كلمات مرور.";
        }
        catch { EpgText.Text = "تعذر نسخ التقرير. جرّب مرة أخرى."; }
        ShowHudBriefly();
    }

    private void PlayCurrentCandidate(long preservePosition = 0)
    {
        if (_recoveryUrls.Count == 0)
        {
            LoadingBadge.Visibility = Visibility.Collapsed;
            RetryPlaybackButton.Visibility = Visibility.Collapsed;
            CopyPlaybackReportButton.Visibility = Visibility.Visible;
            PlaybackFailureShade.Visibility = Visibility.Visible;
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

        LoadingText.Text = _automaticRecoveries > 0 ? "إعادة الاتصال…" : "جاري التشغيل…";
        TrackPlayback("محاولة " + (_automaticRecoveries + 1) + " • " +
            uri.Scheme + " • صيغة " +
            (System.IO.Path.GetExtension(uri.AbsolutePath).TrimStart('.') is { Length: > 0 } ext ? ext : "غير معروفة"));
        _playbackFailed = false;
        RetryPlaybackButton.Visibility = Visibility.Collapsed;
        PlaybackFailureShade.Visibility = Visibility.Collapsed;
        LoadingBadge.Visibility = Visibility.Visible;
        _playStartedAt = DateTimeOffset.UtcNow;
        _lastProgressAt = _playStartedAt;
        _lastObservedTime = -1;
        _videoOutputSeen = false;
        _startedPlaying = false;
        _userPaused = false;

        if (preservePosition > 0)
        {
            _resumeApplied = false;
            _pendingRecoveryResume = preservePosition;
        }

        // Native MediaPlayer.Play can block while the server negotiates a
        // TS/HLS/4K stream. Never call it on the UI dispatcher, otherwise the
        // remote, ESC, mouse and focus all freeze while connecting.
        var generation = Interlocked.Increment(ref _playbackGeneration);
        var userAgent = _compatibilityUserAgent ||
            string.IsNullOrWhiteSpace(_settings.UserAgent) ||
            _settings.UserAgent.Equals("BLOFY PLAYER/2.0 (Windows)", StringComparison.Ordinal)
            ? CompatibilityUserAgent : _settings.UserAgent;
        var isLive = _playlist.Count > 0;
        var disableSubtitles = _settings.SubtitleLanguage == "off";

        _ = Task.Run(async () =>
        {
            await _nativePlaybackGate.WaitAsync();
            try
            {
                if (_disposed || generation != Volatile.Read(ref _playbackGeneration)) return;
                using var media = new Media(_libVlc, uri);
                media.AddOption(":http-user-agent=" + userAgent);
                // Do not fabricate a Referer for Xtream/CDN requests.
                media.AddOption(":network-caching=" + (isLive ? "450" : "800"));
                if (disableSubtitles) media.AddOption(":no-spu");
                var started = _player.Play(media);
                if (!started)
                    DispatchPlayerEvent(() =>
                    {
                        if (generation == Volatile.Read(ref _playbackGeneration))
                            TryRecoverPlayback("المحرك رفض الرابط — تجربة مسار بديل…");
                    });
            }
            catch (Exception)
            {
                DispatchPlayerEvent(() =>
                {
                    if (generation == Volatile.Read(ref _playbackGeneration))
                        TryRecoverPlayback("تعذر اتصال محرك الفيديو بالسيرفر…");
                });
            }
            finally { _nativePlaybackGate.Release(); }
        });
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
        if (_disposed || _playbackFailed || _userPaused) return;
        // Native callbacks from a previous URL may arrive after a quick
        // channel switch. Never replace a currently rendering new stream.
        if (_player.IsPlaying && HasVideoOutput()) return;

        // Try a DIFFERENT server URL before retrying the same stalled URL
        // with another User-Agent. A broken episode must not spin for minutes.
        var haveNextUrl = _recoveryIndex + 1 < _recoveryUrls.Count;
        var haveAlternateAgent = !_compatibilityUserAgent &&
            !string.Equals(_settings.UserAgent, CompatibilityUserAgent, StringComparison.OrdinalIgnoreCase);
        var maxRetries = Math.Min(2, Math.Max(1, _recoveryUrls.Count * 2) - 1);
        if (_automaticRecoveries >= maxRetries || (!haveNextUrl && !haveAlternateAgent))
        {
            TrackPlayback("فشل التشغيل بعد انتهاء البدائل • " + message);
            _playbackFailed = true;
            LoadingBadge.Visibility = Visibility.Collapsed;
            PlaybackFailureShade.Visibility = Visibility.Visible;
            EpgText.Text = "تعذر فتح المحتوى. جرّب إعادة المحاولة أو اختر محتوى آخر.";
            RetryPlaybackButton.Visibility = Visibility.Visible;
            CopyPlaybackReportButton.Visibility = Visibility.Visible;
            ShowHudBriefly();
            RetryPlaybackButton.Focus();
            return;
        }

        TrackPlayback("تجربة رابط بديل • " + message);
        var preserve = Math.Max(_player.Time, _pendingRecoveryResume);
        _automaticRecoveries++;
        if (haveNextUrl) _recoveryIndex++;
        else { _recoveryIndex = 0; _compatibilityUserAgent = true; }
        EpgText.Text = haveNextUrl ? message : "تجربة توافق السيرفر…";
        LoadingText.Text = "فحص المصدر " + (_automaticRecoveries + 1) +
                           " / " + (maxRetries + 1) + "…";
        LoadingBadge.Visibility = Visibility.Visible;
        ShowHudBriefly();
        PlayCurrentCandidate(preserve);
    }

    private void RetryPlayback_Click(object sender, RoutedEventArgs e)
    {
        if (_disposed || _recoveryUrls.Count == 0) return;
        CopyPlaybackReportButton.Visibility = Visibility.Collapsed;
        TrackPlayback("إعادة المحاولة يدويًا");
        _pendingRecoveryResume = Math.Max(_pendingRecoveryResume, _player.Time);
        _resumeApplied = false;
        _recoveryIndex = 0;
        _automaticRecoveries = 0;
        _compatibilityUserAgent = false;
        _playbackFailed = false;
        PlayCurrentCandidate(_pendingRecoveryResume);
        PlayPauseButton.Focus();
    }

    private async void HandleEnded()
    {
        if (_playlist.Count > 0)
        {
            // A short/segmented live input may emit EndReached. It is never
            // a command to switch to the next channel, nor should it restart
            // a perfectly healthy live video every ten seconds.
            if (!_disposed && !_userPaused && !_player.IsPlaying)
                TryRecoverPlayback("انتهى اتصال البث — تجربة المصدر الاحتياطي…");
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

    private void MarkPlaybackReady()
    {
        if (!_videoOutputSeen)
            TrackPlayback("ظهرت الصورة • " +
                (DateTimeOffset.UtcNow - _playStartedAt).TotalSeconds.ToString("F1") + " ثانية");
        _videoOutputSeen = true;
        _lastProgressAt = DateTimeOffset.UtcNow;
        CopyPlaybackReportButton.Visibility = Visibility.Collapsed;
        LoadingBadge.Visibility = Visibility.Collapsed;
        RetryPlaybackButton.Visibility = Visibility.Collapsed;
        PlaybackFailureShade.Visibility = Visibility.Collapsed;
    }

    private async Task RefreshHudAsync()
    {
        if (_disposed || Interlocked.Exchange(ref _hudPolling, 1) == 1) return;
        try
        {
            // Direct native VLC getter calls on the WPF dispatcher were
            // occasionally blocking arrow/ESC input while 4K streams stalled.
            // At most ONE metrics poll runs on a background worker.
            var snapshot = await Task.Run(() =>
            {
                try
                {
                    return (Length: Math.Max(0L, _player.Length),
                            Time: Math.Max(0L, _player.Time),
                            Playing: _player.IsPlaying,
                            Video: HasVideoOutput());
                }
                catch { return (Length: 0L, Time: 0L, Playing: false, Video: false); }
            });
            if (_disposed) return;
            RefreshHudFromSnapshot(snapshot.Length, snapshot.Time,
                                   snapshot.Playing, snapshot.Video);
        }
        finally { Interlocked.Exchange(ref _hudPolling, 0); }
    }

    private void RefreshHudFromSnapshot(long length, long time, bool playing, bool videoOutput)
    {
        SeekSlider.Maximum = Math.Max(1, length);
        if (!SeekSlider.IsMouseCaptureWithin) SeekSlider.Value = Math.Min(time, SeekSlider.Maximum);
        TimeText.Text = Format(time) + " / " + Format(length);
        PlayPauseButton.Content = playing ? "⏸" : "▶";
        PersistentPlayPauseButton.Content = playing ? "⏸ إيقاف مؤقت" : "▶ تشغيل";
        SeekSlider.Visibility = length > 0 ? Visibility.Visible : Visibility.Collapsed;
        PreviousButton.ToolTip = _playlist.Count > 0 ? "القناة السابقة" : "الحلقة السابقة";
        NextButton.ToolTip = _playlist.Count > 0 ? "القناة التالية" : "الحلقة التالية";

        if (_disposed || _playbackFailed) return;
        if (!_videoOutputSeen && videoOutput) MarkPlaybackReady();
        // For some encrypted or software-decoded streams VoutCount is delayed,
        // although the media clock is already moving. Never restart a movie
        // whose playback is clearly progressing.
        if (!_videoOutputSeen && _startedPlaying && _playlist.Count == 0 && time > 800)
            MarkPlaybackReady();

        if (!_videoOutputSeen && !_userPaused &&
            DateTimeOffset.UtcNow - _playStartedAt >
                TimeSpan.FromSeconds(_playlist.Count > 0 ? 16 : 20))
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
        else if (!_userPaused && !playing && !_videoOutputSeen &&
                 DateTimeOffset.UtcNow - _playStartedAt >
                     TimeSpan.FromSeconds(_playlist.Count > 0 ? 16 : 20))
        {
            TryRecoverPlayback("تأخر بدء التشغيل — تجربة مسار بديل…");
        }
        // Live MPEG-TS often has no seekable clock (Time may remain 0 or
        // jump). Do not restart a healthy picture based on Time inactivity.
        // VOD buffering is also not a reason to discard an opened stream:
        // wait for VLC's explicit EncounteredError instead.
    }

    private static string Format(long ms)
    {
        var t = TimeSpan.FromMilliseconds(ms);
        return t.TotalHours >= 1 ? t.ToString(@"hh\:mm\:ss") : t.ToString(@"mm\:ss");
    }

    private void ConfigureControlVisibility()
    {
        var live = _playlist.Count > 0 && _urlResolver is not null;
        PreviousButton.Visibility = live || _previousAction is not null ? Visibility.Visible : Visibility.Collapsed;
        NextButton.Visibility = live || _nextAction is not null ? Visibility.Visible : Visibility.Collapsed;
        RewindButton.Visibility = live ? Visibility.Collapsed : Visibility.Visible;
        Forward10Button.Visibility = live ? Visibility.Collapsed : Visibility.Visible;
        SeekSlider.Visibility = live ? Visibility.Collapsed : Visibility.Visible;
        FavoriteButton.Visibility = _toggleFavorite is null ? Visibility.Collapsed : Visibility.Visible;
        ChannelListButton.Visibility = live ? Visibility.Visible : Visibility.Collapsed;
        LastChannelButton.Visibility = live ? Visibility.Visible : Visibility.Collapsed;
    }

    private void PopulateChannelList()
    {
        if (_playlist.Count == 0 || _urlResolver is null)
        {
            ChannelPanel.Visibility = Visibility.Collapsed;
            return;
        }

        ChannelList.ItemsSource = _playlist
            .Select((item, index) => new PlayerChannelRow(index + 1, item))
            .ToList();
        if (_index >= 0 && _index < _playlist.Count)
            ChannelList.SelectedIndex = _index;
    }

    private void ChannelList_Click(object sender, RoutedEventArgs e)
    {
        if (_playlist.Count == 0) return;
        if (ChannelPanel.Visibility == Visibility.Visible)
            CloseChannelPanel();
        else
            OpenChannelPanel();
    }

    private void OpenChannelPanel()
    {
        if (_playlist.Count == 0) return;
        ChannelPanel.Visibility = Visibility.Visible;
        Hud.Visibility = Visibility.Collapsed;
        TopShade.Visibility = Visibility.Collapsed;
        PersistentTopControls.Visibility = Visibility.Visible;
        if (_index >= 0 && _index < _playlist.Count)
            ChannelList.SelectedIndex = _index;
        ChannelList.UpdateLayout();
        ChannelList.Focus();
        if (ChannelList.ItemContainerGenerator.ContainerFromIndex(ChannelList.SelectedIndex) is ListBoxItem row)
        {
            row.Focus();
            row.BringIntoView();
        }
    }

    private void CloseChannelPanel()
    {
        ChannelPanel.Visibility = Visibility.Collapsed;
        ShowHudBriefly();
        PlayPauseButton.Focus();
    }

    private void ChannelList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (ChannelList.SelectedItem is not PlayerChannelRow row) return;
        ChannelListHint.Text = row.Number.ToString("N0") + " • " + row.Item.Name + "   —   OK تشغيل";
    }

    private void ChannelList_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key is Key.Escape or Key.Back or Key.BrowserBack)
        {
            CloseChannelPanel();
            e.Handled = true;
            return;
        }

        if (e.Key is not Key.Enter and not Key.Space) return;
        if (ChannelList.SelectedItem is not PlayerChannelRow row) return;

        SwitchChannelToIndex(row.Number - 1);
        ChannelPanel.Visibility = Visibility.Collapsed;
        ShowHudBriefly();
        e.Handled = true;
    }

    private void LastChannel_Click(object sender, RoutedEventArgs e)
    {
        if (_previousLiveIndex < 0 || _previousLiveIndex >= _playlist.Count)
        {
            EpgText.Text = "لا توجد قناة سابقة بعد";
            ShowHudBriefly();
            return;
        }

        var target = _previousLiveIndex;
        SwitchChannelToIndex(target);
        ShowHudBriefly();
    }

    private async Task RefreshEpgAsync(StreamItem item)
    {
        if (_epgResolver is null || _playlist.Count == 0) return;

        _epgCts?.Cancel();
        _epgCts?.Dispose();
        _epgCts = new CancellationTokenSource();
        var token = _epgCts.Token;
        var expectedKey = item.Key;

        EpgText.Text = "جاري تحميل معلومات البرنامج…";
        try
        {
            var text = await _epgResolver(item, token);
            if (token.IsCancellationRequested) return;
            if (_index < 0 || _index >= _playlist.Count || _playlist[_index].Key != expectedKey) return;
            EpgText.Text = string.IsNullOrWhiteSpace(text) ? "لا تتوفر معلومات البرنامج" : text;
        }
        catch (OperationCanceledException) { }
        catch
        {
            if (!token.IsCancellationRequested)
                EpgText.Text = "لا تتوفر معلومات البرنامج";
        }
    }

    private void UpdateFavoriteButton()
    {
        FavoriteButton.Content = _favorite ? "★ المفضلة" : "☆ المفضلة";
    }

    private void PlayPause_Click(object sender, RoutedEventArgs e)
    {
        if (_disposed) return;
        if (_player.IsPlaying)
        {
            _userPaused = true;
            _player.Pause();
        }
        else if (_playbackFailed)
        {
            _userPaused = false;
            RetryPlayback_Click(sender, e);
        }
        else
        {
            _userPaused = false;
            // Pausing for minutes must never activate the start watchdog.
            _playStartedAt = DateTimeOffset.UtcNow;
            _lastProgressAt = _playStartedAt;
            _player.Play();
        }
        _ = RefreshHudAsync();
        ShowHudBriefly();
    }

    private async void Previous_Click(object sender, RoutedEventArgs e)
    {
        if (_playlist.Count > 0 && _urlResolver is not null)
        {
            ChangeChannel(-1);
        }
        else if (_previousAction is not null)
        {
            await SwitchAdjacentAsync(_previousAction);
        }
        ShowHudBriefly();
    }

    private async void Next_Click(object sender, RoutedEventArgs e)
    {
        if (_playlist.Count > 0 && _urlResolver is not null)
        {
            ChangeChannel(1);
        }
        else if (_nextAction is not null)
        {
            await SwitchAdjacentAsync(_nextAction);
        }
        ShowHudBriefly();
    }

    private void Rewind_Click(object sender, RoutedEventArgs e)
    {
        Seek(-10_000);
        ShowHudBriefly();
    }

    private void Forward10_Click(object sender, RoutedEventArgs e)
    {
        Seek(10_000);
        ShowHudBriefly();
    }

    private async Task SwitchAdjacentAsync(Func<Task> action)
    {
        try
        {
            await _closeHandler(this);
            await action();
        }
        catch { }
    }

    private async void Favorite_Click(object sender, RoutedEventArgs e)
    {
        if (_toggleFavorite is null) return;
        try
        {
            _favorite = await _toggleFavorite();
            UpdateFavoriteButton();
            if (_playlist.Count > 0) ChannelList.Items.Refresh();
            EpgText.Text = _favorite ? "تمت الإضافة إلى المفضلة" : "تمت الإزالة من المفضلة";
            ShowHudBriefly();
        }
        catch { }
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
        SetFullscreenState(!_fullscreen);
        ShowHudBriefly();
    }

    private void SetFullscreenState(bool enabled)
    {
        if (_fullscreen == enabled) return;
        _fullscreen = enabled;
        FullscreenButton.Content = enabled ? "🗗 نافذة" : "⛶ الشاشة";
        PersistentFullscreenButton.Content = enabled ? "🗗 نافذة" : "⛶ الشاشة";
        _fullscreenHandler(enabled);
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
            ("ملاءمة", "fit"),
            ("تكبير", "zoom"),
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
            var type = _player.GetType();
            var aspect = type.GetProperty("AspectRatio");
            var scale = type.GetProperty("Scale");
            var crop = type.GetProperty("CropGeometry");

            aspect?.SetValue(_player, null);
            crop?.SetValue(_player, null);
            if (scale?.CanWrite == true) scale.SetValue(_player, 0f);

            switch (mode)
            {
                case "zoom":
                    if (scale?.CanWrite == true) scale.SetValue(_player, 1.15f);
                    break;
                case "fill":
                    aspect?.SetValue(_player,
                        Math.Max(1, (int)ActualWidth) + ":" + Math.Max(1, (int)ActualHeight));
                    break;
                default:
                    break;
            }
        }
        catch { }
    }

    private bool HasVideoOutput()
    {
        // LibVLCSharp 3.x API: MediaPlayer.VoutCount. The old reflection
        // lookup of "Vout" always returned null, so live playback started
        // correctly but was mistakenly restarted exactly ten seconds later.
        try { return _player.VoutCount > 0; }
        catch { return false; }
    }

    private void ShowHudBriefly()
    {
        Cursor = Cursors.Arrow;
        PersistentTopControls.Visibility = Visibility.Visible;
        TopShade.Visibility = Visibility.Visible;
        Hud.Visibility = ChannelPanel.Visibility == Visibility.Visible
            ? Visibility.Collapsed : Visibility.Visible;
        _hudTimer.Stop();
        _hudTimer.Start();
    }

    private void HideHud()
    {
        _hudTimer.Stop();
        if (!_player.IsPlaying || ChannelPanel.Visibility == Visibility.Visible) return;
        // All controls must vanish together (including the persistent top bar).
        // The earlier version hid Hud while leaving PersistentTopControls
        // visible across the full film, as reported from the real screenshot.
        Hud.Visibility = Visibility.Collapsed;
        TopShade.Visibility = Visibility.Collapsed;
        PersistentTopControls.Visibility = Visibility.Collapsed;
        Cursor = Cursors.None;
        VideoOverlaySurface.Focus();
    }

    private void Overlay_MouseMove(object sender, MouseEventArgs e)
    {
        if (_disposed) return;
        var position = e.GetPosition(VideoOverlaySurface);
        if (_lastPointerPosition is Point last &&
            Math.Abs(position.X - last.X) < 6 &&
            Math.Abs(position.Y - last.Y) < 6) return;
        _lastPointerPosition = position;
        ShowHudBriefly();
    }

    private void Overlay_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        Fullscreen_Click(sender, e);
        e.Handled = true;
    }

    private void Overlay_SurfaceMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ClickCount >= 2)
        {
            Fullscreen_Click(sender, new RoutedEventArgs());
            e.Handled = true;
            return;
        }
        // Clicking the bare video brings playback controls back immediately.
        if (ReferenceEquals(e.OriginalSource, VideoOverlaySurface))
            ShowHudBriefly();
    }

    private void ChangeChannel(int delta)
    {
        if (_playlist.Count == 0 || _urlResolver is null || delta == 0) return;
        _pendingZapDelta += delta;
        _zapTimer.Stop();
        _zapTimer.Start();

        var previewIndex = (_index + _pendingZapDelta) % _playlist.Count;
        if (previewIndex < 0) previewIndex += _playlist.Count;
        ShowChannelPosition(previewIndex + 1, 650);
    }

    private void ApplyPendingZap()
    {
        _zapTimer.Stop();
        var delta = _pendingZapDelta;
        _pendingZapDelta = 0;
        if (delta == 0 || _playlist.Count == 0) return;

        var target = (_index + delta) % _playlist.Count;
        if (target < 0) target += _playlist.Count;
        SwitchChannelToIndex(target);
    }

    private async void SwitchChannelToIndex(int targetIndex)
    {
        if (_playlist.Count == 0 || _urlResolver is null) return;
        _zapTimer.Stop();
        _pendingZapDelta = 0;
        targetIndex = Math.Clamp(targetIndex, 0, _playlist.Count - 1);
        if (targetIndex == _index)
        {
            ShowChannelPosition(_index + 1, 900);
            return;
        }

        var oldIndex = _index;
        _index = targetIndex;
        if (oldIndex >= 0 && oldIndex < _playlist.Count)
            _previousLiveIndex = oldIndex;

        var item = _playlist[_index];
        TitleText.Text = item.Name;
        TopTitleText.Text = item.Name;
        EpgText.Text = "القناة " + (_index + 1).ToString("N0") + " من " + _playlist.Count.ToString("N0");
        ShowChannelPosition(_index + 1, 950);
        LoadingText.Text = "جاري فتح القناة…";
        LoadingBadge.Visibility = Visibility.Visible;
        _resumeApplied = true;
        _automaticRecoveries = 0;
        _recoveryIndex = 0;
        _compatibilityUserAgent = false;
        _recoveryUrls = _recoveryResolver is not null
            ? NormalizeRecoveryUrls(_urlResolver(item), _recoveryResolver(item))
            : NormalizeRecoveryUrls(_urlResolver(item), null);

        if (ChannelList.Items.Count > _index)
            ChannelList.SelectedIndex = _index;

        PlayCurrentCandidate();
        ShowHudBriefly();
        _ = RefreshEpgAsync(item);

        if (_onPlaylistItemChanged is not null)
        {
            try { await _onPlaylistItemChanged(item); } catch { }
        }
        if (_favoriteResolver is not null)
        {
            try
            {
                _favorite = _favoriteResolver(item);
                UpdateFavoriteButton();
            }
            catch { }
        }
    }

    private static int? DigitFromKey(Key key) => key switch
    {
        Key.D0 or Key.NumPad0 => 0,
        Key.D1 or Key.NumPad1 => 1,
        Key.D2 or Key.NumPad2 => 2,
        Key.D3 or Key.NumPad3 => 3,
        Key.D4 or Key.NumPad4 => 4,
        Key.D5 or Key.NumPad5 => 5,
        Key.D6 or Key.NumPad6 => 6,
        Key.D7 or Key.NumPad7 => 7,
        Key.D8 or Key.NumPad8 => 8,
        Key.D9 or Key.NumPad9 => 9,
        _ => null
    };

    private void ShowChannelPosition(int number, int durationMs)
    {
        ChannelNumberText.Text = number.ToString();
        ChannelNumberBadge.Visibility = Visibility.Visible;
        _ = Dispatcher.BeginInvoke(async () =>
        {
            await Task.Delay(durationMs);
            if (string.IsNullOrEmpty(_channelDigits))
                ChannelNumberBadge.Visibility = Visibility.Collapsed;
        });
    }

    private void HandleChannelDigit(int digit)
    {
        if (_playlist.Count == 0 || _urlResolver is null) return;
        if (_channelDigits.Length >= 4) _channelDigits = "";
        _channelDigits += digit.ToString();
        ChannelNumberText.Text = _channelDigits;
        ChannelNumberBadge.Visibility = Visibility.Visible;
        _channelNumberTimer.Stop();
        _channelNumberTimer.Start();
        ShowHudBriefly();
    }

    private void CommitChannelNumber()
    {
        _channelNumberTimer.Stop();
        ChannelNumberBadge.Visibility = Visibility.Collapsed;
        if (!int.TryParse(_channelDigits, out var number))
        {
            _channelDigits = "";
            return;
        }
        _channelDigits = "";
        if (number < 1 || number > _playlist.Count) return;
        var targetIndex = number - 1;
        var delta = targetIndex - _index;
        if (delta != 0) ChangeChannel(delta);
        else
        {
            ChannelNumberText.Text = number.ToString();
            ChannelNumberBadge.Visibility = Visibility.Visible;
            _ = Dispatcher.BeginInvoke(async () =>
            {
                await Task.Delay(700);
                ChannelNumberBadge.Visibility = Visibility.Collapsed;
            });
        }
    }

    private IReadOnlyList<Button> VisiblePlayerButtons() =>
        new Button[]
        {
            PersistentBackButton,
            CopyPlaybackReportButton,
            PersistentPlayPauseButton,
            PersistentFullscreenButton,
            ChannelListButton,
            LastChannelButton,
            PreviousButton,
            RewindButton,
            PlayPauseButton,
            Forward10Button,
            NextButton,
            AudioButton,
            SubtitleButton,
            QualityButton,
            AspectButton,
            FavoriteButton,
            FullscreenButton,
            CloseButton
        }
        .Where(button => button.Visibility == Visibility.Visible && button.IsEnabled)
        .ToList();

    private bool MovePlayerFocus(Key key)
    {
        var buttons = VisiblePlayerButtons();
        if (buttons.Count == 0) return false;

        if (Keyboard.FocusedElement is not Button current || !buttons.Contains(current))
        {
            PlayPauseButton.Focus();
            return true;
        }

        if (!TryButtonCenter(current, out var from)) return false;
        Button? best = null;
        var bestScore = double.MaxValue;

        foreach (var candidate in buttons)
        {
            if (ReferenceEquals(candidate, current) || !TryButtonCenter(candidate, out var to)) continue;

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
            var score = primary + cross * 2.15;
            if (cross > 260) score += cross;
            if (score >= bestScore) continue;

            bestScore = score;
            best = candidate;
        }

        if (best is null) return false;
        best.Focus();
        best.BringIntoView();
        return true;
    }

    private bool TryButtonCenter(FrameworkElement element, out Point point)
    {
        point = default;
        if (!element.IsVisible || element.ActualWidth <= 0 || element.ActualHeight <= 0) return false;
        try
        {
            var transform = element.TransformToAncestor(PlayerRoot);
            point = transform.Transform(new Point(element.ActualWidth / 2, element.ActualHeight / 2));
            return true;
        }
        catch
        {
            return false;
        }
    }

    private async void Overlay_KeyDown(object sender, KeyEventArgs e)
    {
        // The channel panel owns arrows/Enter; don't swallow its PreviewKeyDown.
        if (ChannelPanel.Visibility == Visibility.Visible &&
            e.Key is Key.Up or Key.Down or Key.Left or Key.Right
                     or Key.PageDown or Key.PageUp or Key.Home or Key.End
                     or Key.Enter or Key.Return or Key.Space)
            return;

        var digit = DigitFromKey(e.Key);
        if (digit is not null && _playlist.Count > 0 && _urlResolver is not null)
        {
            HandleChannelDigit(digit.Value);
            e.Handled = true;
            return;
        }

        if (e.Key is Key.Escape or Key.Back or Key.BrowserBack)
        {
            if (ChannelPanel.Visibility == Visibility.Visible)
                CloseChannelPanel();
            else
                await _closeHandler(this);
            e.Handled = true;
            return;
        }

        if (e.Key is Key.F or Key.F11)
        {
            SetFullscreenState(!_fullscreen);
            ShowHudBriefly();
            e.Handled = true;
            return;
        }

        if (e.Key == Key.MediaPlayPause)
        {
            PlayPause_Click(this, new RoutedEventArgs());
            e.Handled = true;
            return;
        }

        if (e.Key == Key.MediaPreviousTrack)
        {
            Previous_Click(this, new RoutedEventArgs());
            e.Handled = true;
            return;
        }

        if (e.Key == Key.MediaNextTrack)
        {
            Next_Click(this, new RoutedEventArgs());
            e.Handled = true;
            return;
        }

        if (e.Key == Key.PageUp && _playlist.Count > 0 && _urlResolver is not null)
        {
            ChangeChannel(-1);
            e.Handled = true;
            return;
        }

        if (e.Key == Key.PageDown && _playlist.Count > 0 && _urlResolver is not null)
        {
            ChangeChannel(1);
            e.Handled = true;
            return;
        }

        var hudVisible = Hud.Visibility == Visibility.Visible;
        var focusedButton = Keyboard.FocusedElement as Button;
        var focusOnVisiblePlayerButton = focusedButton is not null &&
                                         focusedButton.Visibility == Visibility.Visible &&
                                         (IsDescendantOf(focusedButton, Hud) ||
                                          IsDescendantOf(focusedButton, PersistentTopControls));

        if (e.Key is Key.Enter or Key.Return or Key.Space)
        {
            if (focusOnVisiblePlayerButton && focusedButton is not null)
            {
                focusedButton.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
            }
            else
            {
                // Space / OK while focused on video must really pause or resume.
                PlayPause_Click(this, new RoutedEventArgs());
                VideoOverlaySurface.Focus();
            }
            e.Handled = true;
            return;
        }

        if (e.Key is Key.Left or Key.Right or Key.Up or Key.Down)
        {
            if (!hudVisible)
            {
                if (_playlist.Count > 0 && e.Key == Key.Up)
                    OpenChannelPanel();
                else if (_playlist.Count == 0 && (e.Key is Key.Left or Key.Right) && _player.Length > 0)
                {
                    Seek(e.Key == Key.Left ? -10_000 : 10_000);
                    ShowHudBriefly();
                    VideoOverlaySurface.Focus();
                }
                else
                {
                    ShowHudBriefly();
                    PlayPauseButton.Focus();
                }
                e.Handled = true;
                return;
            }

            if (MovePlayerFocus(e.Key))
            {
                ShowHudBriefly();
                e.Handled = true;
                return;
            }
        }

        if (e.Key == Key.M)
        {
            _player.Mute = !_player.Mute;
            EpgText.Text = _player.Mute ? "الصوت مكتوم" : "الصوت مفعّل";
            ShowHudBriefly();
            e.Handled = true;
        }
    }

    private static bool IsDescendantOf(DependencyObject child, DependencyObject ancestor)
    {
        var current = child;
        while (current is not null)
        {
            if (ReferenceEquals(current, ancestor)) return true;
            current = current is Visual || current is System.Windows.Media.Media3D.Visual3D
                ? VisualTreeHelper.GetParent(current)
                : LogicalTreeHelper.GetParent(current);
        }
        return false;
    }

    private sealed record PlayerChannelRow(int Number, StreamItem Item)
    {
        public string Display => Number.ToString("D3") + "   " + (Item.Favorite ? "★ " : "") + Item.Name;
    }

    private async void Close_Click(object sender, RoutedEventArgs e) =>
        await _closeHandler(this);
}
