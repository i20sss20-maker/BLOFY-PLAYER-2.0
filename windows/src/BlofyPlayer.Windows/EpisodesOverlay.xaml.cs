using BlofyPlayer.Windows.Core;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace BlofyPlayer.Windows;

public partial class EpisodesOverlay : UserControl, IDisposable
{
    private readonly StreamItem _series;
    private readonly LocalStore _store;
    private readonly Func<CancellationToken, Task<List<EpisodeItem>>> _loader;
    private readonly Func<EpisodeItem, IReadOnlyList<EpisodeItem>, Task> _play;
    private readonly Action _close;
    private readonly CancellationTokenSource _cts = new();
    private List<EpisodeItem> _episodes = [];
    private int _selectedSeason;
    private string? _lastEpisodeKey;

    public EpisodesOverlay(
        StreamItem series,
        LocalStore store,
        Func<CancellationToken, Task<List<EpisodeItem>>> loader,
        Func<EpisodeItem, IReadOnlyList<EpisodeItem>, Task> play,
        Action close)
    {
        InitializeComponent();
        _series = series;
        _store = store;
        _loader = loader;
        _play = play;
        _close = close;

        SeriesTitle.Text = series.Name;
        var art = !string.IsNullOrWhiteSpace(series.Backdrop) ? series.Backdrop : series.Icon;
        BindArtwork(SeriesArt, art, 360);

        Loaded += async (_, _) =>
        {
            if (_episodes.Count == 0)
                await LoadEpisodesAsync();
            else
                RestoreFocus();
        };
    }

    public void Dispose() => _cts.Cancel();

    private async Task LoadEpisodesAsync()
    {
        RetryButton.Visibility = Visibility.Collapsed;
        StatusText.Text = "جاري تحميل المواسم والحلقات…";
        SeasonList.ItemsSource = null;
        EpisodePanel.Children.Clear();

        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
            timeout.CancelAfter(TimeSpan.FromSeconds(18));
            _episodes = await _loader(timeout.Token);
            _episodes = _episodes
                .Where(x => !string.IsNullOrWhiteSpace(x.RemoteId))
                .OrderBy(x => x.Season)
                .ThenBy(x => x.Episode)
                .ToList();

            if (_episodes.Count == 0)
            {
                StatusText.Text = "السيرفر لم يُرجع حلقات لهذا المسلسل.";
                RetryButton.Visibility = Visibility.Visible;
                EpisodePanel.Children.Add(EmptyText("لا توجد حلقات الآن. اضغط «إعادة التحميل» للمحاولة مرة ثانية."));
                return;
            }

            var seasons = _episodes.Select(x => x.Season).Distinct().OrderBy(x => x).ToList();
            SeasonList.ItemsSource = seasons.Select(x => new SeasonRow(x)).ToList();
            SeasonList.DisplayMemberPath = "Label";
            SeasonList.SelectedIndex = 0;
            _selectedSeason = seasons[0];
            StatusText.Text = seasons.Count + " مواسم • " + _episodes.Count + " حلقات";
            _ = Dispatcher.BeginInvoke(() => SeasonList.Focus());
        }
        catch (OperationCanceledException)
        {
            if (_cts.IsCancellationRequested) return;
            StatusText.Text = "انتهت مهلة تحميل الحلقات.";
            RetryButton.Visibility = Visibility.Visible;
        }
        catch (Exception ex)
        {
            App.LogCrash("EpisodesOverlay.LoadEpisodes", ex);
            StatusText.Text = "تعذر تحميل الحلقات.";
            RetryButton.Visibility = Visibility.Visible;
            EpisodePanel.Children.Add(EmptyText(ex.Message));
        }
    }

    private void SeasonList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (SeasonList.SelectedItem is not SeasonRow row) return;
        _selectedSeason = row.Season;
        RenderSeason(row.Season, focusEpisode: false);
    }

    private void RenderSeason(int season, bool focusEpisode)
    {
        EpisodePanel.Children.Clear();
        foreach (var episode in _episodes.Where(x => x.Season == season).OrderBy(x => x.Episode))
            EpisodePanel.Children.Add(EpisodeCard(episode));

        if (!focusEpisode) return;
        _ = Dispatcher.BeginInvoke(RestoreEpisodeFocus);
    }

    private void RestoreEpisodeFocus()
    {
        Button? target = null;
        if (!string.IsNullOrWhiteSpace(_lastEpisodeKey))
        {
            target = EpisodePanel.Children
                .OfType<Button>()
                .FirstOrDefault(button => button.Tag is string key &&
                                          key.Equals(_lastEpisodeKey, StringComparison.Ordinal));
        }

        target ??= EpisodePanel.Children.OfType<Button>().FirstOrDefault();
        target?.Focus();
    }

    private void RestoreFocus()
    {
        if (_selectedSeason > 0)
        {
            var row = SeasonList.Items.Cast<SeasonRow>().FirstOrDefault(x => x.Season == _selectedSeason);
            if (row is not null) SeasonList.SelectedItem = row;
        }

        _ = Dispatcher.BeginInvoke(() =>
        {
            if (!string.IsNullOrWhiteSpace(_lastEpisodeKey))
                RestoreEpisodeFocus();
            else
                SeasonList.Focus();
        });
    }

    private UIElement EpisodeCard(EpisodeItem episode)
    {
        var button = new Button
        {
            Tag = episode.Key,
            Background = Brushes.Transparent,
            BorderBrush = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(0),
            Margin = new Thickness(0, 0, 0, 9),
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Cursor = Cursors.Hand
        };

        var shell = new Border
        {
            MinHeight = 88,
            Background = Brush("#241536"),
            BorderBrush = Brush("#52FFFFFF"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(11),
            Padding = new Thickness(10)
        };

        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(132) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(14) });
        grid.ColumnDefinitions.Add(new ColumnDefinition());

        var art = new Border
        {
            Width = 132,
            Height = 74,
            CornerRadius = new CornerRadius(8),
            Background = Brush("#180F23"),
            ClipToBounds = true
        };
        var img = new Image { Stretch = Stretch.UniformToFill };
        art.Child = img;
        var artUrl = !string.IsNullOrWhiteSpace(episode.Icon)
            ? episode.Icon
            : (!string.IsNullOrWhiteSpace(_series.Backdrop) ? _series.Backdrop : _series.Icon);
        BindArtwork(img, artUrl, 300);
        grid.Children.Add(art);

        var copy = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        var watch = _store.WatchState(episode.Key);
        var progress = watch is { DurationMs: > 0, PositionMs: > 15000 }
            ? Math.Clamp((int)(watch.PositionMs * 100 / watch.DurationMs), 1, 100)
            : 0;

        copy.Children.Add(new TextBlock
        {
            Text = "الحلقة " + episode.Episode + "  •  " + episode.Title,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = Brushes.White,
            TextTrimming = TextTrimming.CharacterEllipsis
        });

        var meta = progress > 0
            ? "متابعة المشاهدة • " + progress + "%"
            : episode.DurationSecs > 0
                ? TimeSpan.FromSeconds(episode.DurationSecs).ToString(@"hh\:mm\:ss")
                : "BLOFY SERIES";

        copy.Children.Add(new TextBlock
        {
            Text = meta,
            FontSize = 10.5,
            Foreground = progress > 0 ? Brush("#86E6B4") : Brush("#C9BCD9"),
            Margin = new Thickness(0, 5, 0, 0)
        });

        if (progress > 0)
        {
            copy.Children.Add(new ProgressBar
            {
                Minimum = 0,
                Maximum = 100,
                Value = progress,
                Height = 4,
                Margin = new Thickness(0, 8, 0, 0),
                Foreground = Brush("#D0B2FF"),
                Background = Brush("#3B2B4B")
            });
        }

        Grid.SetColumn(copy, 2);
        grid.Children.Add(copy);
        shell.Child = grid;
        button.Content = shell;

        void Focus(bool active)
        {
            shell.Background = active ? Brush("#3D2756") : Brush("#241536");
            shell.BorderBrush = active ? Brush("#EBD8FF") : Brush("#52FFFFFF");
            shell.BorderThickness = active ? new Thickness(2) : new Thickness(1);
        }

        button.GotKeyboardFocus += (_, _) => Focus(true);
        button.LostKeyboardFocus += (_, _) => Focus(false);
        button.MouseEnter += (_, _) => Focus(true);
        button.MouseLeave += (_, _) => Focus(false);
        button.Click += async (_, _) =>
        {
            _lastEpisodeKey = episode.Key;
            _selectedSeason = episode.Season;
            await _play(episode, _episodes);
        };
        return button;
    }

    private async void RetryButton_Click(object sender, RoutedEventArgs e) =>
        await LoadEpisodesAsync();

    private void BackButton_Click(object sender, RoutedEventArgs e) => _close();

    private void Overlay_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key is Key.Escape or Key.Back or Key.BrowserBack)
        {
            _close();
            e.Handled = true;
            return;
        }

        // Physical, not mirrored, arrows for the Arabic TV layout:
        // season rail is on the RIGHT, episodes are on the LEFT.
        // ListBox normally focuses a ListBoxItem (not the ListBox itself).
        if (SeasonList.IsKeyboardFocusWithin &&
            e.Key is Key.Enter or Key.Left)
        {
            RenderSeason(_selectedSeason, focusEpisode: true);
            e.Handled = true;
            return;
        }

        if (Keyboard.FocusedElement is Button focused &&
            focused.Tag is string episodeKey)
        {
            if (e.Key == Key.Right)
            {
                FocusSeason();
                e.Handled = true;
                return;
            }
            if (e.Key == Key.Left)
            {
                // No panel further left; keep focus on the episode.
                e.Handled = true;
                return;
            }

            if (e.Key is Key.Up or Key.Down)
            {
                var buttons = EpisodePanel.Children.OfType<Button>().ToList();
                var index = buttons.FindIndex(button =>
                    button.Tag is string key && key.Equals(episodeKey, StringComparison.Ordinal));
                if (index >= 0)
                {
                    var next = e.Key == Key.Up ? index - 1 : index + 1;
                    next = Math.Clamp(next, 0, buttons.Count - 1);
                    buttons[next].Focus();
                    buttons[next].BringIntoView();
                    e.Handled = true;
                }
            }
        }
    }

    private void FocusSeason()
    {
        var selected = SeasonList.SelectedItem;
        if (selected is null) { SeasonList.Focus(); return; }
        SeasonList.ScrollIntoView(selected);
        SeasonList.UpdateLayout();
        if (SeasonList.ItemContainerGenerator.ContainerFromItem(selected) is ListBoxItem row)
        {
            row.Focus();
            row.BringIntoView();
        }
        else SeasonList.Focus();
    }

    private static TextBlock EmptyText(string value) => new()
    {
        Text = value,
        Foreground = Brush("#C9BCD9"),
        FontSize = 13,
        TextWrapping = TextWrapping.Wrap,
        Margin = new Thickness(14)
    };

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

    private static SolidColorBrush Brush(string value) =>
        new((Color)ColorConverter.ConvertFromString(value));

    private sealed record SeasonRow(int Season)
    {
        public string Label => "الموسم " + Season;
    }
}
