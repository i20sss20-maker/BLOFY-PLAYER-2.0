using System.IO;
using BlofyPlayer.Windows.Core;
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
                SensitiveTextRedactor.Redact(args.Exception.Message),
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
                .AppendLine(SensitiveTextRedactor.Redact(exception.ToString()))
                .AppendLine()
                .ToString();

            lock (CrashLock)
            {
                // A bad stream could throw repeatedly; preserve the newest
                // diagnostic while bounding disk use for all accounts.
                if (File.Exists(path) && new FileInfo(path).Length > 1_000_000)
                {
                    var previous = Path.Combine(root, "crash.previous.log");
                    File.Move(path, previous, overwrite: true);
                }
                File.AppendAllText(path, report, Encoding.UTF8);
            }
        }
        catch
        {
            // Crash reporting must never become another crash source.
        }
    }
}
