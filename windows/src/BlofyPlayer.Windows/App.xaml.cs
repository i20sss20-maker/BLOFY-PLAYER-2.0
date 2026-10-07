using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Threading;

namespace BlofyPlayer.Windows;

public partial class App : Application
{
    private static readonly object CrashLock = new();

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        DispatcherUnhandledException += (_, args) =>
        {
            LogCrash("DispatcherUnhandledException", args.Exception);
            MessageBox.Show(
                "حدث خطأ غير متوقع في BLOFY PLAYER.\nتم حفظ تقرير الخطأ في مجلد التطبيق المحلي.\n\n" +
                args.Exception.Message,
                "BLOFY PLAYER",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            args.Handled = true;
        };

        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
        {
            if (args.ExceptionObject is Exception ex)
                LogCrash("AppDomain.UnhandledException", ex);
        };

        TaskScheduler.UnobservedTaskException += (_, args) =>
        {
            LogCrash("TaskScheduler.UnobservedTaskException", args.Exception);
            args.SetObserved();
        };
    }

    public static void LogCrash(string source, Exception exception)
    {
        try
        {
            var root = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "BLOFY PLAYER");
            Directory.CreateDirectory(root);
            var path = Path.Combine(root, "crash.log");

            var report = new StringBuilder()
                .AppendLine("============================================================")
                .AppendLine(DateTimeOffset.Now.ToString("O"))
                .AppendLine("Source: " + source)
                .AppendLine("OS: " + Environment.OSVersion)
                .AppendLine("64-bit process: " + Environment.Is64BitProcess)
                .AppendLine(exception.ToString())
                .AppendLine()
                .ToString();

            lock (CrashLock)
                File.AppendAllText(path, report, Encoding.UTF8);
        }
        catch
        {
            // Crash reporting must never become another crash source.
        }
    }
}
