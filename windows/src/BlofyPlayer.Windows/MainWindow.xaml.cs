using BlofyPlayer.Windows.Core.Identity;
using BlofyPlayer.Windows.Core.Playback;
using System.Windows;
using System.Windows.Controls;

namespace BlofyPlayer.Windows;

public partial class MainWindow : Window
{
    private readonly BlofyIdentity _identity;
    private readonly ActivationClient _activationClient = new();
    private readonly PlaybackService _playback = new();

    public MainWindow()
    {
        InitializeComponent();

        _identity = WindowsDeviceIdentity.Get();
        DeviceIdText.Text = _identity.DeviceId;
        ActivationCodeText.Text = _identity.ActivationCode;
        VideoView.MediaPlayer = _playback.MediaPlayer;

        Loaded += async (_, _) => await RefreshActivationAsync();
        Closed += (_, _) =>
        {
            _activationClient.Dispose();
            _playback.Dispose();
        };
    }

    private async Task RefreshActivationAsync()
    {
        RefreshActivationButton.IsEnabled = false;
        TopStatusText.Text = "جاري التحقق…";
        ActivationStatusText.Text = "جاري التحقق من التفعيل…";

        try
        {
            var result = await _activationClient.CheckAsync(_identity);

            if (result is null)
            {
                TopStatusText.Text = "تعذر الاتصال";
                ActivationStatusText.Text = "تعذر التحقق من التفعيل الآن.";
                return;
            }

            var status = result.Status.ToLowerInvariant();
            ActivationStatusText.Text = status switch
            {
                "active" => "مفعّل",
                "trial" => "فترة تجريبية",
                "expired" => "انتهى الاشتراك — جدد من الموقع أو الباركود",
                "blocked" => "الجهاز موقوف",
                _ => result.Message ?? "حالة غير معروفة"
            };

            TopStatusText.Text = result.CanUse() ? "جاهز للتشغيل" : "يحتاج تفعيل";
        }
        catch
        {
            TopStatusText.Text = "غير متصل";
            ActivationStatusText.Text = "تعذر الوصول إلى خدمة التفعيل.";
        }
        finally
        {
            RefreshActivationButton.IsEnabled = true;
        }
    }

    private async void RefreshActivation_Click(object sender, RoutedEventArgs e) =>
        await RefreshActivationAsync();

    private void Nav_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button button && button.Tag is string page)
        {
            PageTitle.Text = page;
            TopStatusText.Text = page == "البث المباشر" ? "المشغل جاهز" : "جاهز";
        }
    }
}
