using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;

namespace Blofy.Windows;

public partial class App : Application
{
    private Mutex? _instanceMutex;
    private bool _ownsInstance;
    protected override void OnExit(ExitEventArgs e)
    {
        if (_ownsInstance) _instanceMutex?.ReleaseMutex();
        _instanceMutex?.Dispose(); base.OnExit(e);
    }
    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        bool runtimeVerify = e.Args.Contains("--verify-runtime", StringComparer.Ordinal);
        if (runtimeVerify)
        {
            string output = Path.GetFullPath(e.Args.FirstOrDefault(a => a.StartsWith("--evidence-dir=", StringComparison.Ordinal))?[15..] ?? "runtime-evidence");
            try { await Runtime.RuntimeVerification.Run(output); Shutdown(0); }
            catch (Exception ex) { Directory.CreateDirectory(output); if (!File.Exists(Path.Combine(output, "runtime-verification.json"))) File.WriteAllText(Path.Combine(output, "runtime-verification.json"), JsonSerializer.Serialize(new { passed = false, error = ex.ToString() })); Shutdown(1); }
            return;
        }
        bool verify = e.Args.Contains("--verify-ui", StringComparer.Ordinal);
        if (!verify)
        {
            try
            {
                _instanceMutex = new Mutex(true, @"Local\BLOFY.Player.Windows", out _ownsInstance);
                if (!_ownsInstance) { MessageBox.Show("التطبيق مفتوح بالفعل. افتحه من شريط المهام.", "BLOFY PLAYER"); Shutdown(0); return; }
                string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BLOFY PLAYER", "Windows");
                var services = new Runtime.RuntimeServices(data);
                var player = new Runtime.RuntimeWindow(services); MainWindow = player; player.Show();
                await player.InitializeAsync();
            }
            catch (Exception ex)
            {
                MessageBox.Show(Runtime.Urls.Error(ex), "BLOFY PLAYER", MessageBoxButton.OK, MessageBoxImage.Error); Shutdown(1);
            }
            return;
        }
        string evidence = Path.GetFullPath(e.Args.FirstOrDefault(a => a.StartsWith("--evidence-dir=", StringComparison.Ordinal))?[15..] ?? "ui-evidence");
        using var bindingLog = new BindingLog();
        PresentationTraceSources.DataBindingSource.Listeners.Add(bindingLog);
        PresentationTraceSources.DataBindingSource.Switch.Level = SourceLevels.Warning;
        try
        {
            var window = new MainWindow(verify);
            MainWindow = window;
            window.Show();
            if (!verify) return;
            ShutdownMode = ShutdownMode.OnExplicitShutdown;
            Directory.CreateDirectory(evidence);
            await window.Dispatcher.InvokeAsync(() => window.UpdateLayout());
            var checks = await UiVerification.Run(window, evidence);
            if (bindingLog.Messages.Count > 0) throw new InvalidOperationException("WPF binding diagnostics: " + string.Join(" | ", bindingLog.Messages));
            checks.Add("No WPF binding errors or warnings");
            File.WriteAllText(Path.Combine(evidence, "verification.json"), JsonSerializer.Serialize(new { passed = true, checks, androidReference = Brand.AndroidReference, networkCalls = 0, scope = "UI-only; synthetic fixtures; no Android screenshot comparison or media playback test" }, new JsonSerializerOptions { WriteIndented = true }));
            window.Close();
            Shutdown(0);
        }
        catch (Exception ex)
        {
            if (verify)
            {
                Directory.CreateDirectory(evidence);
                File.WriteAllText(Path.Combine(evidence, "verification.json"), JsonSerializer.Serialize(new { passed = false, error = ex.ToString(), bindingErrors = bindingLog.Messages }, new JsonSerializerOptions { WriteIndented = true }));
            }
            else MessageBox.Show("تعذر فتح نسخة مراجعة الواجهات. لم تتغير بيانات أندرويد أو بيانات السيرفر.", "BLOFY PLAYER", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
        finally { PresentationTraceSources.DataBindingSource.Listeners.Remove(bindingLog); }
    }
}

internal sealed class BindingLog : TraceListener
{
    public List<string> Messages { get; } = [];
    public override void Write(string? message) { if (!string.IsNullOrWhiteSpace(message)) Messages.Add(message); }
    public override void WriteLine(string? message) => Write(message);
}
