namespace BlofyPlayer.Windows.Core;

// Minimal test-only catalog model: the standalone Linux/macOS regression
// runner intentionally does not pull in WPF or the full Windows runtime.
public sealed class StreamItem
{
    public string Key { get; set; } = "";
    public string Kind { get; set; } = "";
    public string CategoryId { get; set; } = "";
    public string Genre { get; set; } = "";
    public string Rating { get; set; } = "";
    public long AddedAt { get; set; }
}
