using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace Blofy.Windows;

internal static class UiVerification
{
    public static async Task<List<string>> Run(MainWindow window, string output)
    {
        var checks = new List<string>();
        void Check(bool condition, string description) { if (!condition) throw new InvalidOperationException(description); checks.Add(description); }
        Check(Brand.Logo is BitmapSource bitmap && bitmap.PixelWidth > 0 && bitmap.PixelHeight > 0, "Original Android logo decodes as a WPF image");
        Check(window.Login.QrImage == null && window.Login.DeviceId == "—" && window.Login.ActivationCode == "—", "UI preview does not fabricate activation identity or a QR credential");
        Check(!window.Login.ConnectActiveCommand.CanExecute(null), "Connect remains disabled until a real backend is integrated");
        Check(window.Home.Navigation.Select(n => n.Key).SequenceEqual(new[] { "live", "movie", "series", "favorites", "search", "settings" }), "Sidebar order matches pinned Android HomeActivity");
        Check(window.Home.Stories.Select(n => n.Key).SequenceEqual(new[] { "live", "movie", "series", "favorites", "continue" }), "Story order matches pinned Android HomeActivity");
        string? requested = null;
        new HomeViewModel(route => requested = route).NavigateCommand.Execute("series");
        Check(requested == "series", "Home command emits the requested route");
        var catalog = new CatalogViewModel("movie");
        Check(catalog.CountText == "0 فيلم" && catalog.Rows.Count == 0, "Empty catalog is honest and stable");
        var categories = new[] { new CategoryEntry("9", "الفئة الأولى"), new CategoryEntry("2", "الفئة الثانية"), new CategoryEntry("30", "الفئة الثالثة") };
        var data = Enumerable.Range(0, 51).Select(i => new PosterItem { Key = "test:" + i, Title = "عنصر اختبار " + (i + 1).ToString("D2"), CategoryId = i % 2 == 0 ? "9" : "2", Rating = i % 3 == 0 ? "8.5" : "", Metadata = "بيانات اختبار محلية فقط" }).ToArray();
        catalog.SetCatalog(categories, data);
        Check(catalog.Categories.Select(c => c.Id).SequenceEqual(new[] { "__all__", "9", "2", "30" }), "Category order is retained; numeric IDs are not sorted");
        Check(catalog.Rows.Count == 11 && catalog.Rows[^1].Items.Count == 1, "51 posters form eleven five-column rows without dropped items");
        Check(catalog.Rows.SelectMany(r => r.Items).Select(i => i.Key).SequenceEqual(data.Select(i => i.Key)), "Provider item order survives row grouping");
        Check(data[0].HasRating && data[0].RatingText == "★ 8.5" && !data[1].HasRating, "Rating badge is shown only for supplied ratings");
        int openCount = 0;
        catalog.OpenRequested = _ => openCount++;
        Check(openCount == 0, "Loading catalog items does not invoke their open action");
        data[0].OpenCommand.Execute(data[0]);
        Check(openCount == 1, "An explicit item command invokes the open action exactly once");
        catalog.SelectedCategory = catalog.Categories[1];
        Check(catalog.CountText == "26 فيلم", "Category filtering returns the expected count");
        Check(catalog.Rows.SelectMany(r => r.Items).All(i => i.CategoryId == "9"), "Category filtering does not mix groups");
        catalog.SetCatalog(categories, data);
        Check(catalog.SelectedCategory?.Id == "9", "Refreshing rows preserves the selected category");
        catalog.SetCatalog([], data);
        Check(catalog.SelectedCategory?.Id == "__all__" && catalog.CountText == "51 فيلم", "A removed category safely returns to the all-items view");
        Check(new CatalogViewModel("series").CountText == "0 مسلسل", "Series catalog uses the original series labels");
        bool invalidRejected = false; try { _ = new CatalogViewModel("other"); } catch (ArgumentException) { invalidRejected = true; }
        Check(invalidRejected, "Unknown catalog kinds are rejected rather than silently mapped");

        window.Movies.SetCatalog(categories, data);
        window.Series.SetCatalog(categories, data.Select(p => new PosterItem { Key = p.Key, Title = "مسلسل اختبار " + p.Key[5..], CategoryId = p.CategoryId, Rating = p.Rating, Metadata = "اختبار الواجهة، ليس محتوى سيرفر" }));
        foreach (var route in new[] { "login", "home", "movie", "series" })
        {
            window.ShowRoute(route, false);
            await window.Dispatcher.InvokeAsync(() => window.UpdateLayout(), DispatcherPriority.ApplicationIdle);
            window.ReferenceSurface.UpdateLayout();
            Check(window.CurrentRoute == route, route + ": requested template is active");
            Check(window.Screen.ActualWidth > 0 && window.Screen.ActualHeight > 0, route + ": template has a nonzero layout");
            if (route == "login")
            {
                Check(MainWindow.Visuals<Grid>(window.Screen).Any(g => g.ColumnDefinitions.Count == 3 && Math.Abs(g.ColumnDefinitions[0].Width.Value - .82) < .001 && Math.Abs(g.ColumnDefinitions[2].Width.Value - 1.18) < .001), "Login preserves the 0.82:1.18 activation/playlist panel ratio");
            }
            if (route == "home")
            {
                Check(MainWindow.Visuals<Grid>(window.Screen).Any(g => g.ColumnDefinitions.Count == 2 && g.ColumnDefinitions[1].Width.IsAbsolute && g.ColumnDefinitions[1].Width.Value == 190), "Home keeps the 190-unit sidebar on the right");
                Check(MainWindow.Visuals<TextBlock>(window.Screen).Any(t => t.Text == "اكتشف الآن"), "Home includes the original discover heading");
            }
            if (route is "movie" or "series")
            {
                Check(MainWindow.Visuals<Grid>(window.Screen).Any(g => g.ColumnDefinitions.Count == 3 && g.ColumnDefinitions[2].Width.Value == 250), route + ": category rail remains 250 units on the right");
                Check(MainWindow.Visuals<UniformGrid>(window.Screen).Any(g => g.Columns == 5), route + ": poster rows realize five columns");
                Check(MainWindow.Visuals<Button>(window.Screen).Any(b => b.DataContext is PosterItem), route + ": poster commands render in WPF");
                var list = MainWindow.Visuals<ListBox>(window.Screen).Single(l => l.Name == "PosterRows");
                Check(VirtualizingPanel.GetIsVirtualizing(list) && VirtualizingPanel.GetVirtualizationMode(list) == VirtualizationMode.Recycling, route + ": row virtualization and recycling remain enabled");
            }
            SaveScreenshot(window.ReferenceSurface, Path.Combine(output, route + ".png"));
            Check(new FileInfo(Path.Combine(output, route + ".png")).Length > 1000, route + ": screenshot evidence was produced");
        }
        window.Movies.SetCatalog(categories, Enumerable.Range(0, 20_000).Select(i => new PosterItem { Key = "stress:" + i, Title = "عنصر اختبار " + i, CategoryId = "9" }));
        window.ShowRoute("movie", false);
        await window.Dispatcher.InvokeAsync(() => window.UpdateLayout(), DispatcherPriority.ApplicationIdle);
        var realized = MainWindow.Visuals<Button>(window.Screen).Count(b => b.DataContext is PosterItem);
        Check(window.Movies.Rows.Count == 4000, "20,000 synthetic catalog items retain all four thousand rows");
        Check(realized > 0 && realized < 500, "Large-catalog UI realizes only a small visible subset of poster controls");
        Check(window.Movies.CountText == "20000 فيلم", "Large-catalog count is not the count of only visible controls");
        File.WriteAllText(Path.Combine(output, "SCOPE.txt"), "UI-only verification with synthetic local records. No network calls, activation registration, media playback, provider import or Android runtime screenshot comparison was performed. Do not treat these screenshots as proof of completed Android parity.");
        return checks;
    }
    private static void SaveScreenshot(FrameworkElement element, string path)
    {
        var bitmap = new RenderTargetBitmap((int)MainWindow.ReferenceWidth, (int)MainWindow.ReferenceHeight, 96, 96, PixelFormats.Pbgra32);
        bitmap.Render(element);
        var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var stream = File.Create(path); encoder.Save(stream);
    }
}
