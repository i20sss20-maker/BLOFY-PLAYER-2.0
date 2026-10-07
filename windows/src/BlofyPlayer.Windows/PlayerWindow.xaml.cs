using BlofyPlayer.Windows.Core;
using LibVLCSharp.Shared;
using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;

namespace BlofyPlayer.Windows;

public partial class PlayerWindow : Window
{
    private readonly LibVLC _libVlc;
    private readonly MediaPlayer _player;
    private readonly DispatcherTimer _timer;
    private readonly DispatcherTimer _hudTimer;
    private readonly IReadOnlyList<StreamItem> _playlist;
    private readonly Func<StreamItem, string>? _urlResolver;
    private readonly Func<long, long, Task>? _savePosition;
    private readonly Func<Task>? _onEnded;
    private readonly AppSettings _settings;
    private int _index;
    private bool _fullscreen;
    private bool _resumeApplied;
    private readonly long _resumePosition;
    private int _aspectIndex;
    private readonly string?[] _aspectModes = [null, "16:9", "4:3"];

    public PlayerWindow(
        string title,
        string url,
        long resumePositionMs = 0,
        IReadOnlyList<StreamItem>? playlist = null,
        int playlistIndex = -1,
        Func<StreamItem, string>? urlResolver = null,
        Func<long, long, Task>? savePosition = null,
        AppSettings? settings = null,
        Func<Task>? onEnded = null)
    {
        InitializeComponent();
        _settings = settings ?? new AppSettings();
        _onEnded = onEnded;
        LibVLCSharp.Shared.Core.Initialize();

        var options = new List<string>
        {
            "--no-video-title-show",
            "--network-caching=650",
            "--live-caching=450",
            "--file-caching=500",
            "--avcodec-hw=any"
        };
        if (_settings.SubtitleLanguage == "ar") options.Add("--sub-language=ara,ar,eng,en");
        else if (_settings.SubtitleLanguage == "auto") options.Add("--sub-language=ara,ar,eng,en");
        var subtitleScale = _settings.SubtitleSize switch { "large" => 125, "medium" => 105, _ => 85 };
        options.Add("--sub-text-scale=" + subtitleScale);
        if (_settings.AudioOutput == "stereo") options.Add("--audio-channels=2");

        _libVlc = new LibVLC(options.ToArray());
        _player = new MediaPlayer(_libVlc);
        VideoView.MediaPlayer = _player;
        _playlist = playlist ?? [];
        _index = playlistIndex;
        _urlResolver = urlResolver;
        _savePosition = savePosition;
        _resumePosition = resumePositionMs;
        TitleText.Text = title;
        TopTitleText.Text = title;
        EpgText.Text = _playlist.Count > 0 ? "بث مباشر" : "BLOFY PLAYER";

        _player.Playing += (_, _) => Dispatcher.Invoke(ApplyResumeOnce);
        _player.EncounteredError += (_, _) => Dispatcher.Invoke(() =>
            MessageBox.Show(this, "تعذر تشغيل هذا البث. جرّب قناة/جودة أخرى.", "BLOFY PLAYER"));
        _player.EndReached += (_, _) => Dispatcher.Invoke(HandleEnded);

        _timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
        _timer.Tick += (_, _) => RefreshHud();
        _timer.Start();

        _hudTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(4) };
        _hudTimer.Tick += (_, _) => HideHud();

        Loaded += (_, _) =>
        {
            PlayUrl(url);
            ShowHudBriefly();
        };
        Closed += async (_, _) =>
        {
            _timer.Stop();
            _hudTimer.Stop();
            if (_savePosition is not null)
                await _savePosition(Math.Max(0, _player.Time), Math.Max(0, _player.Length));
            _player.Stop();
            _player.Dispose();
            _libVlc.Dispose();
        };
    }

    private void PlayUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
        {
            MessageBox.Show(this, "رابط التشغيل غير صالح.", "BLOFY PLAYER");
            return;
        }
        using var media = new Media(_libVlc, uri);
        media.AddOption(":http-user-agent=" + _settings.UserAgent);
        if (_settings.SubtitleLanguage == "off") media.AddOption(":no-spu");
        _player.Play(media);
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
            Close();
            await _onEnded();
        }
        catch { }
    }

    private void ApplyResumeOnce()
    {
        if (_resumeApplied || _resumePosition <= 0) return;
        _resumeApplied = true;
        _player.Time = _resumePosition;
    }

    private void RefreshHud()
    {
        var length = Math.Max(0, _player.Length);
        var time = Math.Max(0, _player.Time);
        SeekSlider.Maximum = Math.Max(1, length);
        if (!SeekSlider.IsMouseCaptureWithin) SeekSlider.Value = Math.Min(time, SeekSlider.Maximum);
        TimeText.Text = Format(time) + " / " + Format(length);
        PlayPauseButton.Content = _player.IsPlaying ? "⏸" : "▶";
        TimelinePanel.Visibility = length > 0 ? Visibility.Visible : Visibility.Collapsed;
        PreviousButton.ToolTip = _playlist.Count > 0 ? "القناة السابقة" : "رجوع 10 ثوان";
        NextButton.ToolTip = _playlist.Count > 0 ? "القناة التالية" : "تقديم 10 ثوان";
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
        var tracks = _player.AudioTrackDescription;
        if (tracks.Length == 0) return;
        var current = Array.FindIndex(tracks, t => t.Id == _player.AudioTrack);
        var next = tracks[(current + 1 + tracks.Length) % tracks.Length];
        _player.SetAudioTrack(next.Id);
        EpgText.Text = "الصوت: " + next.Name;
        ShowHudBriefly();
    }

    private void Subtitle_Click(object sender, RoutedEventArgs e)
    {
        var tracks = _player.SpuDescription;
        if (tracks.Length == 0)
        {
            MessageBox.Show(this, "لا توجد ترجمة مضمّنة في هذا المحتوى.", "BLOFY PLAYER");
            return;
        }
        var current = Array.FindIndex(tracks, t => t.Id == _player.Spu);
        var next = tracks[(current + 1 + tracks.Length) % tracks.Length];
        _player.SetSpu(next.Id);
        EpgText.Text = "الترجمة: " + next.Name;
        ShowHudBriefly();
    }

    private void Fullscreen_Click(object sender, RoutedEventArgs e)
    {
        ToggleFullscreen();
        ShowHudBriefly();
    }

    private void ToggleFullscreen()
    {
        _fullscreen = !_fullscreen;
        if (_fullscreen)
        {
            WindowStyle = WindowStyle.None;
            WindowState = WindowState.Maximized;
        }
        else
        {
            WindowStyle = WindowStyle.SingleBorderWindow;
            WindowState = WindowState.Normal;
        }
        ShowHudBriefly();
    }

    private void Quality_Click(object sender, RoutedEventArgs e)
    {
        EpgText.Text = "الجودة: تلقائي • LibVLC يختار أفضل مسار متاح";
        ShowHudBriefly();
    }

    private void Aspect_Click(object sender, RoutedEventArgs e)
    {
        _aspectIndex = (_aspectIndex + 1) % _aspectModes.Length;
        var value = _aspectModes[_aspectIndex];
        try
        {
            var property = _player.GetType().GetProperty("AspectRatio");
            property?.SetValue(_player, value);
        }
        catch { }

        EpgText.Text = value is null ? "المقاس: ملاءمة تلقائية" : "المقاس: " + value;
        ShowHudBriefly();
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

    private void Window_MouseMove(object sender, MouseEventArgs e) => ShowHudBriefly();

    private void ChangeChannel(int delta)
    {
        if (_playlist.Count == 0 || _urlResolver is null) return;
        _index = (_index + delta + _playlist.Count) % _playlist.Count;
        var item = _playlist[_index];
        TitleText.Text = item.Name;
        TopTitleText.Text = item.Name;
        EpgText.Text = "القناة " + (_index + 1).ToString("N0") + " من " + _playlist.Count.ToString("N0");
        _resumeApplied = true;
        PlayUrl(_urlResolver(item));
        ShowHudBriefly();
    }

    private void Window_KeyDown(object sender, KeyEventArgs e)
    {
        if (Hud.Visibility != Visibility.Visible &&
            e.Key is not Key.Escape and not Key.F)
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
                if (_playlist.Count > 0 && _urlResolver is not null) ChangeChannel(-1);
                else Seek(-10_000);
                ShowHudBriefly();
                e.Handled = true;
                break;
            case Key.Right:
                if (_playlist.Count > 0 && _urlResolver is not null) ChangeChannel(1);
                else Seek(10_000);
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
                ToggleFullscreen();
                e.Handled = true;
                break;
            case Key.M:
                _player.Mute = !_player.Mute;
                EpgText.Text = _player.Mute ? "الصوت مكتوم" : "الصوت مفعّل";
                ShowHudBriefly();
                e.Handled = true;
                break;
            case Key.Escape:
                if (_fullscreen) ToggleFullscreen(); else Close();
                e.Handled = true;
                break;
        }
    }

    private void Close_Click(object sender, RoutedEventArgs e) => Close();
}
