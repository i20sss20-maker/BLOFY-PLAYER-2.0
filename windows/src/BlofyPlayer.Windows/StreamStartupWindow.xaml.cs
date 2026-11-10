using BlofyPlayer.Windows.Core;
using BlofyPlayer.Windows.Core.Identity;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace BlofyPlayer.Windows;

public partial class StreamStartupWindow : Window
{
    private bool _working;
    private bool _arabic = true;
    private bool _entering;
    private StreamMediaProxy? _mediaProxy;

    public StreamStartupWindow()
    {
        InitializeComponent();
        _arabic = System.Globalization.CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "ar";
        ApplyLanguage();
        Loaded += async (_, _) =>
        {
            CodeInput.Focus();
            if (StreamCodeAccess.HasSavedSession)
                await VerifySavedAsync();
        };
        Closed += (_, _) =>
        {
            // Successful navigation passes ownership to MainWindow.
            if (_entering) return;
            if (_mediaProxy is not null) _ = _mediaProxy.DisposeAsync();
        };
    }

    private void ApplyLanguage()
    {
        LanguageButton.Content = _arabic ? "English" : "العربية";
        WelcomeTitle.Text = _arabic ? "عالم الترفيه بكود واحد" : "Your world of entertainment, one code";
        WelcomeHint.Text = _arabic
            ? "BLOFY STREAM لويندوز: نفس أكواد التفعيل والمكتبة، بدون إدخال هوست أو حساب مصدر."
            : "BLOFY STREAM for Windows: the same code-based activation, no server host or source credentials.";
        Feature1.Text = _arabic ? "✓  القنوات والأفلام والمسلسلات" : "✓  Live TV, movies and series";
        Feature2.Text = _arabic ? "✓  مشغل فيديو LibVLC على ويندوز" : "✓  Native LibVLC playback on Windows";
        Feature3.Text = _arabic ? "✓  البحث والمفضلة واستكمال المشاهدة" : "✓  Search, favorites and watch progress";
        CodeTitle.Text = _arabic ? "أدخل كود اشتراكك" : "Enter your subscription code";
        CodeHint.Text = _arabic ? "أدخل الكود المقدم من BLOFY STREAM" : "Enter the code provided by BLOFY STREAM";
        ActivateButton.Content = _arabic ? "تفعيل الاشتراك" : "Activate";
        RetryButton.Content = _arabic ? "إعادة التحقق" : "Retry verification";
        SecureText.Text = _arabic ? "اتصال آمن • لا يلزم إدخال هوست" : "Secure connection • no host or password required";
        FlowDirection = _arabic ? FlowDirection.RightToLeft : FlowDirection.LeftToRight;
    }

    private void Language_Click(object sender, RoutedEventArgs e)
    {
        _arabic = !_arabic;
        ApplyLanguage();
        CodeInput.Focus();
    }

    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape && !_working) { Close(); e.Handled = true; }
    }

    private void Code_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Return && !_working)
        {
            e.Handled = true;
            _ = ActivateAsync();
        }
    }

    private void Activate_Click(object sender, RoutedEventArgs e) => _ = ActivateAsync();
    private void Retry_Click(object sender, RoutedEventArgs e) => _ = VerifySavedAsync();

    private void Busy(bool value)
    {
        _working = value;
        ActivateButton.IsEnabled = !value;
        CodeInput.IsEnabled = !value;
        RetryButton.IsEnabled = !value;
    }

    private async Task ActivateAsync()
    {
        if (_working) return;
        if (StreamCodeAccess.NormalizeCode(CodeInput.Text).Length == 0)
        {
            StatusText.Text = _arabic ? "الكود 8 إلى 12 رقمًا" : "Enter a valid 8–12 digit code";
            CodeInput.Focus();
            return;
        }
        Busy(true);
        StatusText.Text = _arabic ? "جاري تفعيل الاشتراك..." : "Activating your subscription...";
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            await StreamCodeAccess.RedeemAsync(CodeInput.Text, timeout.Token);
            CodeInput.Clear();
            StatusText.Text = _arabic ? "تم التفعيل • تجهيز مكتبة BLOFY..." : "Activated • preparing library...";
            await EnterAsync();
        }
        catch (Exception ex)
        {
            App.LogCrash("Stream code activation", ex);
            // Do not display the full exception, response payload, URL or bearer.
            StatusText.Text = ex is InvalidOperationException
                ? ex.Message
                : _arabic ? "تعذر التفعيل. تأكد من الشبكة وأعد المحاولة."
                          : "Activation failed. Check your connection and try again.";
            CodeInput.Focus();
        }
        finally { if (!_entering) Busy(false); }
    }

    private async Task VerifySavedAsync()
    {
        if (_working) return;
        Busy(true);
        RetryButton.Visibility = Visibility.Collapsed;
        StatusText.Text = _arabic ? "جاري التحقق من الاشتراك المحفوظ..." : "Checking saved subscription...";
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(25));
            var active = await StreamCodeAccess.VerifyAsync(timeout.Token);
            if (active == true)
            {
                StatusText.Text = _arabic ? "الاشتراك فعال • جاري فتح BLOFY STREAM" : "Active subscription • opening BLOFY STREAM";
                await EnterAsync();
                return;
            }
            if (active == false)
            {
                StreamCodeAccess.Logout();
                StatusText.Text = _arabic ? "انتهى الاشتراك أو أُلغي. أدخل كودًا جديدًا."
                                         : "Subscription expired or revoked. Enter a new code.";
            }
            else
            {
                StatusText.Text = _arabic ? "الشبكة غير متاحة، اشتراكك محفوظ. حاول مرة أخرى."
                                         : "Network unavailable. Your saved subscription is retained.";
                RetryButton.Visibility = Visibility.Visible;
            }
        }
        catch
        {
            StatusText.Text = _arabic ? "تعذر الاتصال. الاشتراك المحفوظ لم يُحذف."
                                     : "Connection failed. Your saved subscription is retained.";
            RetryButton.Visibility = Visibility.Visible;
        }
        finally { if (!_entering) Busy(false); }
    }

    private async Task EnterAsync()
    {
        // Create isolated state for STREAM; never import PLAYER credentials.
        var store = new LocalStore();
        await store.LoadAsync();
        store.State.Providers.Clear();
        store.State.Providers.Add(StreamCodeAccess.CreateProvider());
        store.State.ActiveProviderId = StreamCodeAccess.ProviderId;
        await store.SaveAsync();

        var media = new StreamMediaProxy();
        await media.StartAsync();
        StreamRuntime.MediaProxy = media;
        _mediaProxy = media;
        StartupSessionTransfer.Store(new ActivationCheckResponse("active"),
            portalSynced: true);

        _entering = true;
        var main = new MainWindow();
        Application.Current.MainWindow = main;
        main.Show();
        Close();
    }
}
