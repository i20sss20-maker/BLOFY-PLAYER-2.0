using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace Blofy.Windows.Runtime;

public sealed partial class RuntimeWindow
{
    private Func<Task>? _loadMore;
    private ListBox? _liveList;
    private CancellationTokenSource? _liveSelection;
    public Task LoadMoreAsync() => _loadMore?.Invoke() ?? Task.CompletedTask;
    private async Task ShowCatalog(string kind, CancellationToken ct)
    {
        var p = _active!; var vm = new RuntimeCatalog(kind, kind == "series" ? "المسلسلات" : "الأفلام"); CurrentCatalog = vm;
        vm.ResetCategories(await _services.Catalog.Categories(p, kind, ct));
        var view = new ContentControl { Content = vm, ContentTemplate = (DataTemplate)FindResource("AndroidCatalogView") };
        int revision = 0; bool fetching = false; CancellationTokenSource? query = null;
        async Task Load(bool reset)
        {
            if (!reset && (fetching || vm.Entries.Count >= vm.Total)) return;
            int version = ++revision; query?.Cancel(); query?.Dispose(); query = CancellationTokenSource.CreateLinkedTokenSource(_pageCts.Token); var token = query.Token; fetching = true;
            try
            {
                var page = await _services.Catalog.Read(p, kind, vm.SelectedCategory?.Id == "__all__" ? null : vm.SelectedCategory?.Id, offset: reset ? 0 : vm.Entries.Count, limit: 100, ct: token);
                if (token.IsCancellationRequested || version != revision) return;
                if (reset) vm.Replace(page, e => Forget(OpenAsync(e)), _artwork, token); else vm.Add(page, e => Forget(OpenAsync(e)), _artwork, token);
            }
            catch (OperationCanceledException) { }
            catch (Exception ex) { if (version == revision) Notice(Urls.Error(ex)); }
            finally { if (version == revision) fetching = false; }
        }
        vm.CategoryChanged = _ => Forget(Load(true));
        view.AddHandler(ScrollViewer.ScrollChangedEvent, new ScrollChangedEventHandler((_, e) =>
        {
            if (e.OriginalSource is ScrollViewer s && s.ScrollableHeight > 0 && s.VerticalOffset >= s.ScrollableHeight - 450) Forget(Load(false));
        }));
        Set(view, kind); _loadMore = () => Load(false); await Load(true);
        view.PreviewKeyDown += (_, e) =>
        {
            if (Keyboard.FocusedElement is not FrameworkElement focused) return;
            if (e.Key == Key.Left && focused.DataContext is Category)
            { var b = MainWindow.Visuals<Button>(view).FirstOrDefault(b => b.DataContext is RuntimePoster); if (b != null) e.Handled = b.Focus(); }
            if (e.Key == Key.Right && focused.DataContext is RuntimePoster poster)
            {
                int index = vm.Entries.FindIndex(i => i.Key == poster.Entry.Key);
                if (index >= 0 && (index % 5 == 4 || index == vm.Entries.Count - 1))
                {
                    var list = MainWindow.Visuals<ListBox>(view).FirstOrDefault(l => l.Name == "CategoryList");
                    if (list?.SelectedItem is { } selected) { list.ScrollIntoView(selected); list.UpdateLayout(); e.Handled = (list.ItemContainerGenerator.ContainerFromItem(selected) as ListBoxItem)?.Focus() == true; }
                }
            }
        };
    }
    private async Task ShowLibrary(string mode, CancellationToken ct)
    {
        var p = _active!; var items = await _services.Catalog.Library(p, mode); ct.ThrowIfCancellationRequested();
        var vm = new RuntimeCatalog("", mode == "favorites" ? "المفضلة" : mode == "recent" ? "آخر القنوات" : "تابع المشاهدة"); vm.ResetCategories([]); CurrentCatalog = vm;
        var view = new ContentControl { Content = vm, ContentTemplate = (DataTemplate)FindResource("AndroidCatalogView") };
        Set(view, mode); vm.Replace(new(items.Select(x => x.Entry).ToArray(), items.Count), e => Forget(OpenAsync(e)), _artwork, _pageCts.Token); _loadMore = null;
    }
    private async Task ShowSearch(CancellationToken ct)
    {
        var p = _active!; var vm = new RuntimeCatalog("", "البحث"); vm.ResetCategories([]); CurrentCatalog = vm;
        var search = Input("اكتب اسم القناة أو الفيلم أو المسلسل"); var grid = new Grid(); grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        grid.Children.Add(search); var list = new ContentControl { Content = vm, ContentTemplate = (DataTemplate)FindResource("AndroidCatalogView") }; grid.Children.Add(list); Grid.SetRow(list, 1);
        Set(PageWithHeader("البحث", grid), "search"); _loadMore = null; int revision = 0; CancellationTokenSource? query = null;
        async Task Load(bool append)
        {
            int version = ++revision; query?.Cancel(); query?.Dispose(); query = CancellationTokenSource.CreateLinkedTokenSource(_pageCts.Token); var token = query.Token;
            try
            {
                if (!append) await Task.Delay(180, token);
                var page = await _services.Catalog.Read(p, "", search: search.Text, offset: append ? vm.Entries.Count : 0, limit: 100, ct: token);
                if (version != revision || token.IsCancellationRequested) return;
                if (append) vm.Add(page, e => Forget(OpenAsync(e)), _artwork, token); else vm.Replace(page, e => Forget(OpenAsync(e)), _artwork, token);
            }
            catch (OperationCanceledException) { } catch (Exception ex) { Notice(Urls.Error(ex)); }
        }
        search.TextChanged += (_, _) => Forget(Load(false));
        _loadMore = () => vm.Entries.Count < vm.Total ? Load(true) : Task.CompletedTask;
        list.AddHandler(ScrollViewer.ScrollChangedEvent, new ScrollChangedEventHandler((_, e) => { if (e.VerticalChange > 0 && e.OriginalSource is ScrollViewer s && s.VerticalOffset >= s.ScrollableHeight - 300) Forget(LoadMoreAsync()); }));
        await Load(false); search.Focus();
    }
    private static ListBox List() => new() { Background = Brush("#130E1C"), Foreground = Brushes.White, BorderThickness = new Thickness(0), FontSize = 16, HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private async Task ShowLive(CancellationToken ct)
    {
        var p = _active!; var categories = await _services.Catalog.Categories(p, "live", ct);
        var body = new Grid(); body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(350) }); body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(270) });
        var categoryList = List(); categoryList.DisplayMemberPath = "Name"; categoryList.ItemsSource = new[] { new Category("__all__", "كل القنوات", "live") }.Concat(categories).ToList();
        _liveList = List(); var channels = _liveList; channels.DisplayMemberPath = "Name";
        var categoryPanel = Panel(categoryList); categoryPanel.Margin = new Thickness(8, 0, 0, 0); body.Children.Add(categoryPanel); Grid.SetColumn(categoryPanel, 2);
        var channelPanel = Panel(channels); channelPanel.Margin = new Thickness(12, 0, 8, 0); body.Children.Add(channelPanel); Grid.SetColumn(channelPanel, 1);
        var preview = new Grid(); preview.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); preview.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); preview.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); preview.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        var title = Text("المعاينة", 21); preview.Children.Add(title); var host = new Grid { Background = Brushes.Black }; _previewHost = host; preview.Children.Add(host); Grid.SetRow(host, 1);
        var epg = Text("", 14, "#DCC2FF"); preview.Children.Add(epg); Grid.SetRow(epg, 2);
        var actions = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        actions.Children.Add(ActionButton("ملء الشاشة", EnterFullscreen)); actions.Children.Add(ActionButton("☆ المفضلة", () => { if (channels.SelectedItem is Entry e) Forget(ToggleFavorite(e)); })); preview.Children.Add(actions); Grid.SetRow(actions, 3);
        body.Children.Add(Panel(preview, "#F025183D")); Set(PageWithHeader("BLOFY • البث المباشر", body), "live"); Playback.Attach(host); Playback.SetPreview(true);
        var rows = new List<Entry>(); int total = 0, revision = 0; bool loading = false; CancellationTokenSource? categoryQuery = null;
        async Task Load(bool reset)
        {
            if (!reset && (loading || rows.Count >= total)) return;
            int version = ++revision; categoryQuery?.Cancel(); categoryQuery?.Dispose(); categoryQuery = CancellationTokenSource.CreateLinkedTokenSource(_pageCts.Token); var token = categoryQuery.Token; loading = true;
            try
            {
                string? id = (categoryList.SelectedItem as Category)?.Id;
                var page = await _services.Catalog.Read(p, "live", id is null or "__all__" ? null : id, offset: reset ? 0 : rows.Count, limit: 300, ct: token);
                if (version != revision || token.IsCancellationRequested) return; var selected = channels.SelectedItem as Entry;
                if (reset) rows.Clear(); rows.AddRange(page.Items); total = page.Total; channels.ItemsSource = rows.ToArray();
                if (reset && rows.Count > 0) channels.SelectedIndex = 0; else channels.SelectedItem = selected;
                Notice(rows.Count.ToString("N0") + " / " + total.ToString("N0") + " قناة");
            }
            catch (OperationCanceledException) { } catch (Exception ex) { Notice(Urls.Error(ex)); }
            finally { if (version == revision) loading = false; }
        }
        async Task Preview(Entry entry)
        {
            _liveSelection?.Cancel(); _liveSelection?.Dispose(); _liveSelection = CancellationTokenSource.CreateLinkedTokenSource(_pageCts.Token); var token = _liveSelection.Token;
            try
            {
                await Task.Delay(160, token); await RequireActivation(token); token.ThrowIfCancellationRequested();
                title.Text = entry.Name; epg.Text = ""; await Playback.Start(p, entry, ct: token);
                var programme = await _services.Providers.Epg(p, entry, token); if (!token.IsCancellationRequested) epg.Text = programme;
            }
            catch (OperationCanceledException) { } catch (Exception ex) { if (!token.IsCancellationRequested) Notice(Urls.Error(ex)); }
        }
        channels.SelectionChanged += (_, _) => { if (channels.SelectedItem is Entry entry) Forget(Preview(entry)); };
        channels.PreviewKeyDown += (_, e) => { if (e.Key == Key.Enter && channels.SelectedItem is Entry selected && Playback.Current?.Key == selected.Key) { e.Handled = true; EnterFullscreen(); } };
        channels.MouseDoubleClick += (_, _) => { if (channels.SelectedItem is Entry selected && Playback.Current?.Key == selected.Key) EnterFullscreen(); };
        channels.AddHandler(ScrollViewer.ScrollChangedEvent, new ScrollChangedEventHandler((_, e) => { if (e.VerticalChange > 0 && e.OriginalSource is ScrollViewer s && s.VerticalOffset >= s.ScrollableHeight - 150) Forget(Load(false)); }));
        categoryList.SelectionChanged += (_, _) => Forget(Load(true));
        categoryList.SelectedIndex = categories.Count > 0 ? 1 : 0; _loadMore = () => Load(false);
        await Task.CompletedTask;
    }
    private async Task ToggleFavorite(Entry e)
    {
        if (_active == null) return; var previous = await _services.Catalog.WatchState(_active, e);
        await _services.Catalog.SaveWatch(_active, e, previous?.Position ?? 0, previous?.Duration ?? 0, previous?.Favorite != true);
        Notice(previous?.Favorite == true ? "حُذف من المفضلة" : "أُضيف إلى المفضلة");
    }
    public Task OpenAsync(Entry e) => Work(async ct =>
    {
        var p = _active ?? throw new InvalidDataException("اختر قائمة أولًا");
        if (e.Kind is "live" or "episode")
        {
            await RequireActivation(ct); var watch = await _services.Catalog.WatchState(p, e);
            _episodeQueue.Clear(); _episodeIndex = -1; await Playback.Start(p, e, e.Kind == "live" ? 0 : watch?.Position ?? 0, ct); EnterFullscreen(); return;
        }
        Detail detail;
        try { detail = await _services.Providers.Details(p, e, ct); }
        catch (OperationCanceledException) { throw; }
        catch when (e.Kind == "movie") { detail = new(e, "تعذر جلب التفاصيل الإضافية الآن؛ يمكنك تشغيل الفيلم مباشرةً.", "", "", e.Genre, e.Year, e.Rating, e.Image, []); }
        ct.ThrowIfCancellationRequested(); await ShowDetails(detail, ct);
    });
    private async Task ShowDetails(Detail detail, CancellationToken ct)
    {
        var e = detail.Entry; var p = _active!; var watch = await _services.Catalog.WatchState(p, e); ct.ThrowIfCancellationRequested();
        var body = new Grid { Margin = new Thickness(58, 44, 58, 44) }; body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(34) }); body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(310) });
        var image = new Image { Width = 285, Height = 425, Stretch = Stretch.UniformToFill }; var poster = Panel(image); poster.VerticalAlignment = VerticalAlignment.Center; body.Children.Add(poster); Grid.SetColumn(poster, 2);
        var content = new StackPanel { VerticalAlignment = VerticalAlignment.Center }; content.Children.Add(Text(e.Name, 36)); content.Children.Add(Text(string.Join("  •  ", new[] { detail.Released, detail.Genre, detail.Rating.Length > 0 ? "★ " + detail.Rating : "" }.Where(s => s.Length > 0)), 16, "#C6A8E7"));
        content.Children.Add(Text(detail.Plot.Length > 0 ? detail.Plot : "استمتع بالمشاهدة على BLOFY PLAYER", 17, "#E0DCE5"));
        if (detail.Cast.Length > 0) content.Children.Add(Text("الطاقم: " + detail.Cast, 14, "#B9A9C8"));
        if (detail.Director.Length > 0) content.Children.Add(Text("الإخراج: " + detail.Director, 14, "#B9A9C8"));
        var actions = new WrapPanel { HorizontalAlignment = HorizontalAlignment.Right };
        var favorite = ActionButton(watch?.Favorite == true ? "★ المفضلة" : "☆ المفضلة", () => Forget(ToggleFavorite(e))); actions.Children.Add(favorite);
        actions.Children.Add(ActionButton("رجوع", () => Forget(Back())));
        if (e.Kind == "movie")
        {
            actions.Children.Add(ActionButton(watch?.Position > 30000 ? "▶ استئناف" : "▶ شاهد الآن", () => Forget(Work(async token => { await RequireActivation(token); _episodeIndex = -1; _episodeQueue.Clear(); await Playback.Start(p, detail.Entry, watch?.Position ?? 0, token); EnterFullscreen(); }))));
            if (watch?.Position > 30000) actions.Children.Add(ActionButton("من البداية", () => Forget(Work(async token => { await RequireActivation(token); _episodeIndex = -1; _episodeQueue.Clear(); await Playback.Start(p, detail.Entry, 0, token); EnterFullscreen(); }))));
        }
        content.Children.Add(actions);
        if (e.Kind == "series")
        {
            var seasons = new ComboBox { Margin = new Thickness(4, 15, 4, 8), MinHeight = 40, Foreground = Brushes.Black, Background = Brushes.White, FlowDirection = FlowDirection.RightToLeft };
            var episodes = List(); episodes.MaxHeight = 255; episodes.DisplayMemberPath = "Name";
            _episodeQueue = detail.Episodes.ToList(); seasons.ItemsSource = detail.Episodes.Select(x => x.Season).Distinct().Select(s => new SeasonOption(s, "الموسم " + s)).ToList();
            seasons.SelectionChanged += (_, _) => { if (seasons.SelectedItem is SeasonOption s) episodes.ItemsSource = detail.Episodes.Where(x => x.Season == s.Number).Select(x => x.Entry).ToList(); };
            void PlaySelected() { if (episodes.SelectedItem is Entry selected) { _episodeQueue = detail.Episodes.ToList(); _episodeIndex = _episodeQueue.FindIndex(x => x.Entry.Id == selected.Id); Forget(Work(token => PlayEpisode(_episodeIndex, token))); } }
            episodes.MouseDoubleClick += (_, _) => PlaySelected(); episodes.PreviewKeyDown += (_, args) => { if (args.Key == Key.Enter) { args.Handled = true; PlaySelected(); } };
            content.Children.Add(seasons); content.Children.Add(episodes); content.Children.Add(ActionButton("▶ تشغيل الحلقة المحددة", PlaySelected));
            if (detail.Episodes.Count == 0) content.Children.Add(Text("لم يرجع السيرفر حلقات لهذا المسلسل", 15, "#DCC2FF")); else { seasons.SelectedIndex = 0; episodes.SelectedIndex = 0; }
        }
        body.Children.Add(new ScrollViewer { Content = content, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled });
        Set(body, "details"); _loadMore = null;
        var tokenForImage = _pageCts.Token; _ = LoadImage();
        async Task LoadImage() { var art = await _artwork.Load(detail.Image, tokenForImage); if (!tokenForImage.IsCancellationRequested) image.Source = art; }
    }
    private async Task PlayEpisode(int index, CancellationToken ct)
    {
        if (_active == null || index < 0 || index >= _episodeQueue.Count) return;
        await RequireActivation(ct); _episodeIndex = index; var entry = _episodeQueue[index].Entry; var watch = await _services.Catalog.WatchState(_active, entry);
        await Playback.Start(_active, entry, watch?.Position ?? 0, ct); if (!_fullscreen) EnterFullscreen();
    }
    private sealed record SeasonOption(int Number, string Name) { public override string ToString() => Name; }

    private static TextBox Input(string hint, string value = "") => new() { Text = value, ToolTip = hint, Tag = hint, MinHeight = 48, FontSize = 16, Padding = new Thickness(12), Margin = new Thickness(0, 5, 0, 5), Foreground = Brushes.White, Background = Brush("#0B0811"), BorderBrush = Brush("#5F3B7B"), CaretBrush = Brushes.White, VerticalContentAlignment = VerticalAlignment.Center };
    private void ShowManager()
    {
        var stack = new StackPanel(); stack.Children.Add(ActionButton("＋ إضافة قائمة تشغيل", () => ShowForm()));
        foreach (var p in _services.Users.Data.Providers)
        {
            var row = new DockPanel { LastChildFill = true, Margin = new Thickness(0, 5, 0, 5) };
            var buttons = new StackPanel { Orientation = Orientation.Horizontal }; buttons.Children.Add(ActionButton("اتصال", () => Forget(ConnectAsync(p)))); buttons.Children.Add(ActionButton("تعديل", () => ShowForm(p)));
            buttons.Children.Add(ActionButton("حذف", () => { if (Confirm("حذف القائمة؟", "ستُحذف القائمة من هذا الكمبيوتر فقط، ولن نحذفها من الموقع.")) { _services.Users.Remove(p.Id); Login.RefreshList(_services.Users.Data.Providers); ShowManager(); } }));
            DockPanel.SetDock(buttons, Dock.Left); row.Children.Add(buttons); row.Children.Add(Text(p.Name + (p.FromPortal ? " • من الموقع" : " • محلية"), 20)); stack.Children.Add(Panel(row));
        }
        stack.Children.Add(ActionButton("فتح موقع الجهاز", () => OpenPortal()));
        stack.Children.Add(Text("القوائم تُحفظ على هذا الكمبيوتر. رفعها إلى الموقع يتم فقط عند اختيارك ذلك.", 14, "#B9A9C8"));
        Set(PageWithHeader("إدارة قوائم التشغيل", new ScrollViewer { Content = stack, VerticalScrollBarVisibility = ScrollBarVisibility.Auto }), "playlists");
    }
    private void OpenPortal()
    {
        try { Process.Start(new ProcessStartInfo(_services.Portal.PublicUrl(_services.Users.Data.Identity)) { UseShellExecute = true }); }
        catch { Notice("تعذر فتح المتصفح. امسح رمز QR من صفحة الدخول."); }
    }
    private void ShowForm(Provider? previous = null)
    {
        var fields = new StackPanel { Width = 760, HorizontalAlignment = HorizontalAlignment.Center };
        var name = Input("اسم القائمة", previous?.Name ?? ""); var url = Input("رابط السيرفر أو M3U", previous?.Url ?? ""); var user = Input("اسم المستخدم", previous?.Username ?? "");
        var pass = new PasswordBox { Password = previous?.Password ?? "", MinHeight = 48, FontSize = 16, Padding = new Thickness(12), Margin = new Thickness(0, 5, 0, 5), Foreground = Brushes.White, Background = Brush("#0B0811"), BorderBrush = Brush("#5F3B7B") };
        var m3u = new CheckBox { Content = "رابط M3U / M3U8", IsChecked = previous?.Type == "m3u", Foreground = Brushes.White, Margin = new Thickness(0, 10, 0, 10) };
        var upload = new CheckBox { Content = "حفظ القائمة في موقع الجهاز أيضًا", Foreground = Brushes.White, Margin = new Thickness(0, 10, 0, 10) };
        foreach (var pair in new (string, UIElement)[] { ("اسم القائمة", name), ("رابط السيرفر أو رابط M3U", url), ("نوع القائمة", m3u), ("اسم المستخدم", user), ("كلمة المرور", pass) }) { fields.Children.Add(Text(pair.Item1, 14, "#B9A9C8")); fields.Children.Add(pair.Item2); }
        fields.Children.Add(Text("يفضل HTTPS • HTTP متاح عند الحاجة، لكنه غير مشفر", 13, "#B78CFF")); fields.Children.Add(upload);
        async Task Save(bool connect, CancellationToken ct)
        {
            bool isM3u = m3u.IsChecked == true || string.IsNullOrWhiteSpace(user.Text) && string.IsNullOrEmpty(pass.Password) && !Urls.Query(Urls.Http(url.Text).Query).ContainsKey("username");
            var next = Urls.Input(name.Text, url.Text, user.Text, pass.Password, isM3u, previous) with { FromPortal = false };
            if (next.Url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !Confirm("اتصال HTTP غير مشفر", "بيانات الدخول والبث لن تكون مشفرة بينك وبين هذا السيرفر. هل تتابع؟")) return;
            _services.Users.Put(next); Login.RefreshList(_services.Users.Data.Providers);
            if (upload.IsChecked == true)
            {
                await _services.Portal.Check(_services.Users.Data.Identity, ct);
                await _services.Portal.Push(_services.Users.Data.Identity, next, ct); next = next with { FromPortal = true }; _services.Users.Put(next);
            }
            if (connect) await ConnectCore(next, ct); else { ShowManager(); Notice("تم حفظ القائمة"); }
        }
        var actions = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right }; actions.Children.Add(ActionButton("حفظ", () => Forget(Work(ct => Save(false, ct))))); actions.Children.Add(ActionButton("حفظ واتصال", () => Forget(Work(ct => Save(true, ct))))); fields.Children.Add(actions);
        Set(PageWithHeader(previous == null ? "إضافة قائمة تشغيل" : "تعديل قائمة التشغيل", new ScrollViewer { Content = Panel(fields), VerticalScrollBarVisibility = ScrollBarVisibility.Auto }), "form");
    }
    private void ShowSettings()
    {
        var p = _services.Users.Data.Preferences; var fields = new StackPanel { MaxWidth = 800 };
        fields.Children.Add(Text("التشغيل", 23)); var hardware = new CheckBox { Content = "فك الترميز باستخدام كرت الشاشة", IsChecked = p.Hardware, Foreground = Brushes.White, Margin = new Thickness(0, 10, 0, 10) }; fields.Children.Add(hardware);
        var autoplay = new CheckBox { Content = "تشغيل الحلقة التالية تلقائيًا", IsChecked = p.AutoplayNext, Foreground = Brushes.White, Margin = new Thickness(0, 10, 0, 10) }; fields.Children.Add(autoplay);
        var fill = new CheckBox { Content = "ملء إطار الفيديو 16:9", IsChecked = p.FillVideo, Foreground = Brushes.White, Margin = new Thickness(0, 10, 0, 10) }; fields.Children.Add(fill);
        fields.Children.Add(Text("التخزين المؤقت للشبكة (200–5000 مللي ثانية)", 15)); var cache = Input("التخزين المؤقت", p.CacheMs.ToString()); fields.Children.Add(cache);
        fields.Children.Add(Text("الصوت والترجمة", 23)); var audio = Input("لغة الصوت", p.AudioLanguage); var subtitle = Input("لغة الترجمة", p.SubtitleLanguage); fields.Children.Add(Text("لغة الصوت المفضلة: ar / en", 14)); fields.Children.Add(audio); fields.Children.Add(Text("لغة الترجمة المفضلة: ar / en", 14)); fields.Children.Add(subtitle);
        var ua = Input("User-Agent", _active?.UserAgent ?? ""); var referer = Input("Referer", _active?.Referer ?? ""); var format = new ComboBox { ItemsSource = new[] { "ts", "m3u8" }, SelectedItem = _active?.LiveFormat ?? "ts", MinHeight = 44, Foreground = Brushes.Black, Background = Brushes.White };
        fields.Children.Add(Text("السيرفر الحالي", 23)); fields.Children.Add(Text("User-Agent", 14)); fields.Children.Add(ua); fields.Children.Add(Text("Referer — اختياري", 14)); fields.Children.Add(referer); fields.Children.Add(Text("صيغة البث المباشر", 14)); fields.Children.Add(format);
        fields.Children.Add(ActionButton("حفظ الإعدادات", () =>
        {
            try
            {
                if (!int.TryParse(cache.Text, out int ms) || ms is < 200 or > 5000) throw new ArgumentException("القيمة بين 200 و5000");
                _services.Users.Data.Preferences = p with { CacheMs = ms, Hardware = hardware.IsChecked == true, AutoplayNext = autoplay.IsChecked == true, FillVideo = fill.IsChecked == true, AudioLanguage = Urls.Header(audio.Text), SubtitleLanguage = Urls.Header(subtitle.Text) };
                if (_active is { } provider) { if (referer.Text.Length > 0) _ = Urls.Http(referer.Text); _active = provider with { UserAgent = Urls.Header(ua.Text), Referer = referer.Text.Trim(), LiveFormat = format.SelectedItem as string ?? "ts" }; _services.Users.Put(_active); }
                _services.Users.Save(); Playback.Fit(); Notice("حُفظت الإعدادات؛ إعدادات فك الترميز تُطبّق عند تشغيل المحتوى التالي");
            }
            catch (Exception ex) { Notice(Urls.Error(ex)); }
        }));
        fields.Children.Add(ActionButton("تحديث مكتبة السيرفر", () => { if (_active is { } provider) Forget(Work(ct => ConnectCore(provider, ct, true))); }));
        fields.Children.Add(ActionButton("إدارة / تبديل القوائم", ShowManager)); fields.Children.Add(ActionButton("صفحة تفعيل الجهاز", () => Forget(ReturnToLogin())));
        fields.Children.Add(Text("BLOFY PLAYER Windows 0.2.0 • نسخة اختبار تشغيل\nالمشغل لا يوفر محتوى. أضف قوائم تملك حق استخدامها.\nمحرك Windows: LibVLC • إعدادات أندرويد ومحركاته لم تتغير.", 13, "#A69DB3"));
        Set(PageWithHeader("الإعدادات", new ScrollViewer { Content = Panel(fields), VerticalScrollBarVisibility = ScrollBarVisibility.Auto }), "settings");
    }
}
