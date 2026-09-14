using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;

namespace Blofy.Windows;

public partial class App : Application
{
    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        bool verify = e.Args.Contains("--verify-ui", StringComparer.Ordinal);
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
