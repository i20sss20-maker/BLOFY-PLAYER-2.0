using BlofyPlayer.Windows.Core;
using BlofyPlayer.Windows.Core.Identity;
using System.Diagnostics;
using System.Windows;
using System.Windows.Threading;

namespace BlofyPlayer.Windows;

public partial class StartupWindow : Window
{
    private readonly BlofyIdentity _identity = WindowsDeviceIdentity.Get();
    private readonly ActivationClient _activation = new();
    private readonly PortalService _portal = new();
    private readonly LocalStore _store = new();
    private readonly DispatcherTimer _pollTimer = new() { Interval = TimeSpan.FromSeconds(4) };
    private ActivationCheckResponse? _activationState;
    private bool _loading;
    private bool _checking;
    private bool _autoEntryStarted;

    public StartupWindow()
    {
        InitializeComponent();
        DeviceIdText.Text = _identity.DeviceId;
        ActivationCodeText.Text = _identity.ActivationCode;
        QrImage.Source = QrCodeHelper.Create(BlofyEndpoints.ActivationPortal(_identity));

        _pollTimer.Tick += async (_, _) => await RefreshActivationAsync();

        Loaded += async (_, _) =>
        {
            try
            {
                await _store.LoadAsync();
                await RefreshActivationAsync();
                if (!_loading) _pollTimer.Start();
            }
            catch (Exception ex)
            {
                App.LogCrash("StartupWindow.Loaded", ex);
                ActivationStateText.Text = "تعذر تجهيز صفحة التفعيل";
                TrialText.Text = ex.Message;
                _pollTimer.Start();
            }
        };

        Closed += (_, _) =>
        {
            _pollTimer.Stop();
            _activation.Dispose();
            _portal.Dispose();
        };
    }

    private async Task RefreshActivationAsync()
    {
        if (_loading || _checking) return;
        _checking = true;
        ActivationStateText.Text = "جاري التحقق من حالة الجهاز…";
        TrialText.Text = "الاتصال بخدمة BLOFY…";
        EnterButton.IsEnabled = false;

        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            _activationState = await _activation.CheckAsync(_identity, cancellationToken: timeout.Token);
            if (_activationState is null)
            {
                ActivationStateText.Text = "تعذر التحقق من الجهاز";
                TrialText.Text = "تأكد من الإنترنت ثم اضغط «تحديث من الموقع».";
                return;
            }

            switch (_activationState.Status.ToLowerInvariant())
            {
                case "active":
                    ActivationStateText.Text = "الجهاز مفعّل ✓";
                    TrialText.Text = ExpiryText(false);
                    EnterButton.IsEnabled = true;
                    await AutoEnterIfReadyAsync();
                    break;
                case "trial":
                    ActivationStateText.Text = "التجربة مفعّلة ✓";
                    TrialText.Text = ExpiryText(true);
                    EnterButton.IsEnabled = true;
                    await AutoEnterIfReadyAsync();
                    break;
                case "expired":
                    ActivationStateText.Text = "انتهى التفعيل";
                    TrialText.Text = "جدد من الباركود أو بوابة BLOFY، ثم اضغط «تحديث من الموقع».";
                    break;
                case "blocked":
                    ActivationStateText.Text = "هذا الجهاز موقوف";
                    TrialText.Text = "راجع إدارة BLOFY قبل محاولة الدخول.";
                    break;
                default:
                    ActivationStateText.Text = _activationState.Message ?? "الجهاز غير مفعّل";
                    TrialText.Text = "امسح الباركود أو افتح الموقع لإكمال التفعيل.";
                    break;
            }
        }
        catch (OperationCanceledException)
        {
            ActivationStateText.Text = "انتهت مهلة التحقق";
            TrialText.Text = "اضغط «تحديث من الموقع» للمحاولة مرة ثانية.";
        }
        catch (Exception ex)
        {
            App.LogCrash("Activation refresh", ex);
            ActivationStateText.Text = "تعذر الاتصال بخدمة التفعيل";
            TrialText.Text = "تحقق من اتصال الإنترنت ثم حاول مرة أخرى.";
        }
        finally
        {
            _checking = false;
        }
    }

    private async Task AutoEnterIfReadyAsync()
    {
        if (_autoEntryStarted || _loading || _activationState?.CanUse() != true) return;
        _autoEntryStarted = true;
        _pollTimer.Stop();
        ActivationStateText.Text = _activationState.Status.Equals("trial", StringComparison.OrdinalIgnoreCase)
            ? "التجربة جاهزة ✓"
            : "الجهاز مفعّل ✓";
        TrialText.Text = "جاري الانتقال إلى تحميل BLOFY…";
        await Task.Delay(550);
        await EnterBlofyAsync();
    }

    private string ExpiryText(bool trial)
    {
        if (_activationState?.ExpiresAt is not long raw)
            return trial ? "يمكنك الدخول خلال فترة التجربة." : "التفعيل ساري.";

        var expiry = raw > 10_000_000_000
            ? DateTimeOffset.FromUnixTimeMilliseconds(raw)
            : DateTimeOffset.FromUnixTimeSeconds(raw);
        var remaining = expiry - DateTimeOffset.Now;
        if (remaining <= TimeSpan.Zero)
            return "انتهت الصلاحية. جدد من الباركود.";

        var prefix = trial ? "متبقي من التجربة" : "التفعيل ساري";
        if (remaining.TotalDays >= 1)
            return prefix + ": " + Math.Ceiling(remaining.TotalDays) + " يوم";
        if (remaining.TotalHours >= 1)
            return prefix + ": " + Math.Ceiling(remaining.TotalHours) + " ساعة";
        return prefix + ": " + Math.Max(1, Math.Ceiling(remaining.TotalMinutes)) + " دقيقة";
    }

    private async void EnterButton_Click(object sender, RoutedEventArgs e)
    {
        if (_activationState?.CanUse() != true || _loading) return;
        await EnterBlofyAsync();
    }

    private async Task EnterBlofyAsync()
    {
        _loading = true;
        _pollTimer.Stop();
        EnterButton.IsEnabled = false;
        ActivationPanel.Visibility = Visibility.Collapsed;
        LoadingPanel.Visibility = Visibility.Visible;
        BackButton.Visibility = Visibility.Collapsed;

        try
        {
            SetLoading(8, "التحقق من التفعيل…");
            using var activationTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            var fresh = await _activation.CheckAsync(_identity, cancellationToken: activationTimeout.Token);
            if (fresh?.CanUse() != true)
                throw new InvalidOperationException("التفعيل غير متاح الآن. ارجع لصفحة الباركود وحدّث الحالة.");

            SetLoading(20, "مزامنة القوائم من موقع BLOFY…");
            await SyncPortalIntoStoreAsync();

            var provider = _store.ActiveProvider();
            if (provider is not null)
            {
                using var catalog = new CatalogCoordinator(_store);
                SetLoading(34, "تجهيز القائمة: " + provider.Name);

                var cached = await Task.Run(() => catalog.LoadCachedAsync(provider));
                CatalogSnapshot ready;
                if (cached is not null && cached.Streams.Count > 0)
                {
                    ready = cached;
                    SetLoading(82, "تم تجهيز بياناتك المحفوظة • " + cached.Streams.Count.ToString("N0") + " عنصر");
                }
                else
                {
                    var progress = new Progress<(int Percent, string Text)>(value =>
                    {
                        var mapped = 34 + (int)Math.Round(value.Percent * 0.58);
                        SetLoading(Math.Min(92, mapped), value.Text);
                    });
                    ready = await Task.Run(() => catalog.SyncAsync(provider, progress));
                }
                StartupCatalogTransfer.Store(ready);
            }
            else
            {
                SetLoading(76, "لا توجد قائمة مرتبطة — يمكنك إضافتها من الموقع أو التطبيق");
            }

            SetLoading(94, "تجهيز المفضلة وسجل المشاهدة…");
            await Task.Delay(180);
            SetLoading(100, "جاهز — فتح BLOFY PLAYER");
            await Task.Delay(260);

            var main = new MainWindow();
            Application.Current.MainWindow = main;
            main.Show();
            Close();
        }
        catch (Exception ex)
        {
            App.LogCrash("Startup loading", ex);
            LoadingTitle.Text = "تعذر إكمال التحميل";
            LoadingStatus.Text = ex.Message;
            LoadingProgress.Value = 0;
            LoadingPercent.Text = "";
            BackButton.Visibility = Visibility.Visible;
            _loading = false;
        }
    }

    private async Task SyncPortalIntoStoreAsync()
    {
        var remote = await _portal.FetchAsync(_identity);
        if (remote.Count == 0) return;

        foreach (var item in remote)
        {
            var existing = _store.State.Providers.FirstOrDefault(p => p.Id == item.Id);
            if (existing is null)
            {
                _store.State.Providers.Add(item);
                continue;
            }

            existing.Name = item.Name;
            existing.ProviderType = item.ProviderType;
            existing.BaseUrl = item.BaseUrl;
            existing.Username = item.Username;
            existing.Password = item.Password;
            existing.M3uUrl = item.M3uUrl;
            existing.SubscriberToken = item.SubscriberToken;
            existing.Active = item.Active;
            existing.UpdatedAt = item.UpdatedAt;
        }

        var selected = remote.FirstOrDefault(p => p.Active) ?? remote.FirstOrDefault();
        if (selected is not null)
        {
            _store.State.ActiveProviderId = selected.Id;
            foreach (var provider in _store.State.Providers)
                provider.Active = provider.Id == selected.Id;
        }
        await _store.SaveAsync();
    }

    private void SetLoading(int percent, string status)
    {
        LoadingProgress.Value = percent;
        LoadingPercent.Text = percent + "%";
        LoadingStatus.Text = status;
    }

    private async void RefreshButton_Click(object sender, RoutedEventArgs e) =>
        await RefreshActivationAsync();

    private void OpenPortalButton_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            Process.Start(new ProcessStartInfo(BlofyEndpoints.ActivationPortal(_identity))
            {
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "BLOFY PLAYER");
        }
    }

    private void BackButton_Click(object sender, RoutedEventArgs e)
    {
        LoadingPanel.Visibility = Visibility.Collapsed;
        ActivationPanel.Visibility = Visibility.Visible;
        _loading = false;
        _autoEntryStarted = false;
        _ = RefreshActivationAsync();
        _pollTimer.Start();
    }
}
