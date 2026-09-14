using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Threading;

namespace Blofy.Windows;

/// <summary>A clearly-labelled UI review host, not a completed media player.</summary>
public sealed class MainWindow : Window
{
    public const double ReferenceWidth = 1280;
    public const double ReferenceHeight = 800;
    public Grid ReferenceSurface { get; }
    public ContentControl Screen { get; } = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch, VerticalContentAlignment = VerticalAlignment.Stretch };
    public bool VerificationMode { get; }
    public LoginViewModel Login { get; }
    public HomeViewModel Home { get; }
    public CatalogViewModel Movies { get; } = new("movie");
    public CatalogViewModel Series { get; } = new("series");
    public string CurrentRoute { get; private set; } = "";
    public string LastNotice { get; private set; } = "";
    private readonly Stack<string> _history = new();
    private readonly Dictionary<string, string> _focus = new();

    public MainWindow(bool verificationMode = false)
    {
        VerificationMode = verificationMode;
        Title = "BLOFY PLAYER — Windows UI Review (F1–F4)";
        Width = 1280; Height = 840; MinWidth = 960; MinHeight = 600;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Icon = Brand.Logo;
        Login = new LoginViewModel(Notify);
        Home = new HomeViewModel(route => ShowRoute(route));
        Movies.OpenRequested = item => Notify("صفحة التفاصيل والتشغيل لم تُربط بعد في نسخة مراجعة الواجهات: " + item.Title);
        Series.OpenRequested = item => Notify("اختيار المواسم والحلقات لم يُربط بعد في نسخة مراجعة الواجهات: " + item.Title);
        ReferenceSurface = new Grid { Width = ReferenceWidth, Height = ReferenceHeight, FlowDirection = FlowDirection.LeftToRight, ClipToBounds = true };
        ReferenceSurface.Children.Add(new Rectangle { Fill = Gradient("#17102A", "#030308") });
        ReferenceSurface.Children.Add(new Rectangle { Fill = Radial("#7A6E1CCA", "#00190A3B", new Point(ReferenceWidth * .90, ReferenceHeight * .08), 620) });
        ReferenceSurface.Children.Add(new Rectangle { Fill = Radial("#303B24A3", "#00000000", new Point(ReferenceWidth * .06, ReferenceHeight * .92), 420) });
        ReferenceSurface.Children.Add(Screen);
        Content = new Viewbox { Stretch = Stretch.Uniform, Child = ReferenceSurface };
        PreviewKeyDown += HandleKeys;
        ShowRoute("login", false);
    }
    private static Color ColorOf(string value) => (Color)ColorConverter.ConvertFromString(value);
    private static Brush Gradient(string start, string end) => new LinearGradientBrush(ColorOf(start), ColorOf(end), new Point(0, 0), new Point(1, 1));
    private static Brush Radial(string start, string end, Point center, double radius) => new RadialGradientBrush(ColorOf(start), ColorOf(end)) { MappingMode = BrushMappingMode.Absolute, Center = center, GradientOrigin = center, RadiusX = radius, RadiusY = radius };

    public void ShowRoute(string route, bool remember = true)
    {
        object model;
        string resource;
        switch (route)
        {
            case "login": model = Login; resource = "AndroidLoginView"; break;
            case "home": model = Home; resource = "AndroidHomeView"; break;
            case "movie": model = Movies; resource = "AndroidCatalogView"; break;
            case "series": model = Series; resource = "AndroidCatalogView"; break;
            default: Notify("هذا القسم لم يُنقل بعد إلى ويندوز. نسخة مراجعة الواجهات ليست تطبيقًا كاملاً."); return;
        }
        SaveFocus();
        if (remember && CurrentRoute.Length > 0 && CurrentRoute != route) _history.Push(CurrentRoute);
        CurrentRoute = route;
        Screen.ContentTemplate = (DataTemplate)FindResource(resource);
        Screen.Content = model;
        Dispatcher.BeginInvoke(DispatcherPriority.Loaded, new Action(RestoreFocus));
    }
    private void Notify(string message)
    {
        LastNotice = message;
        if (!VerificationMode) MessageBox.Show(this, message, "BLOFY — مراجعة الواجهات", MessageBoxButton.OK, MessageBoxImage.Information, MessageBoxResult.OK, MessageBoxOptions.RtlReading | MessageBoxOptions.RightAlign);
    }
    private void SaveFocus()
    {
        if (Keyboard.FocusedElement is not FrameworkElement element || CurrentRoute.Length == 0) return;
        var token = element.DataContext switch { PosterItem p => "poster:" + p.Key, CategoryEntry c => "category:" + c.Id, NavEntry n => "nav:" + n.Key, _ => element is Button b && b.CommandParameter is string key ? "action:" + key : "" };
        if (token.Length > 0) _focus[CurrentRoute] = token;
    }
    private void RestoreFocus()
    {
        Screen.ApplyTemplate(); Screen.UpdateLayout();
        if (_focus.TryGetValue(CurrentRoute, out var token))
        {
            var existing = Visuals<FrameworkElement>(Screen).FirstOrDefault(e => e.Focusable && (e.DataContext switch { PosterItem p => "poster:" + p.Key, CategoryEntry c => "category:" + c.Id, NavEntry n => "nav:" + n.Key, _ => e is Button b && b.CommandParameter is string k ? "action:" + k : "" }) == token);
            if (existing?.Focus() == true) return;
        }
        if (CurrentRoute is "movie" or "series") { FocusCategory(); return; }
        if (CurrentRoute == "home")
        { Visuals<Button>(Screen).FirstOrDefault(b => b.DataContext is NavEntry n && n.Key == "live" && n.Icon.Length > 0)?.Focus(); return; }
        Visuals<Button>(Screen).FirstOrDefault(b => ReferenceEquals(b.Command, Login.ManagePlaylistsCommand))?.Focus();
    }
    private bool FocusCategory()
    {
        var list = Visuals<ListBox>(Screen).FirstOrDefault(l => l.Name == "CategoryList");
        if (list == null || list.Items.Count == 0) return false;
        var selected = list.SelectedItem ?? list.Items[0];
        list.ScrollIntoView(selected); list.UpdateLayout();
        return (list.ItemContainerGenerator.ContainerFromItem(selected) as ListBoxItem)?.Focus() ?? list.Focus();
    }
    private void HandleKeys(object sender, KeyEventArgs e)
    {
        if (e.Key is Key.F1 or Key.F2 or Key.F3 or Key.F4)
        { ShowRoute(e.Key switch { Key.F1 => "login", Key.F2 => "home", Key.F3 => "movie", _ => "series" }); e.Handled = true; return; }
        if (e.Key == Key.Escape || (e.Key == Key.Back && Keyboard.FocusedElement is not TextBox))
        {
            if (_history.Count > 0) ShowRoute(_history.Pop(), false);
            else if (CurrentRoute != "login") ShowRoute("login", false);
            else Close();
            e.Handled = true; return;
        }
        if (CurrentRoute is not ("movie" or "series")) return;
        var vm = CurrentRoute == "series" ? Series : Movies;
        var focused = Keyboard.FocusedElement as FrameworkElement;
        if (e.Key == Key.Left && focused?.DataContext is CategoryEntry)
        { var target = Visuals<Button>(Screen).FirstOrDefault(b => b.DataContext is PosterItem); if (target != null) e.Handled = target.Focus(); }
        else if (e.Key == Key.Right && focused?.DataContext is PosterItem item)
        {
            var visible = vm.Rows.SelectMany(r => r.Items).ToList();
            var index = visible.FindIndex(p => p.Key == item.Key);
            if (index >= 0 && (index % CatalogViewModel.Columns == CatalogViewModel.Columns - 1 || index == visible.Count - 1)) e.Handled = FocusCategory();
        }
    }
    public static IEnumerable<T> Visuals<T>(DependencyObject root) where T : DependencyObject
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++)
        { var child = VisualTreeHelper.GetChild(root, i); if (child is T matched) yield return matched; foreach (var descendant in Visuals<T>(child)) yield return descendant; }
    }
}
