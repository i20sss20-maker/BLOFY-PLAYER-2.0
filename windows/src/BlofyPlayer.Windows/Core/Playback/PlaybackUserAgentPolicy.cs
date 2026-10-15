namespace BlofyPlayer.Windows.Core.Playback;

/// <summary>
/// Keep Xtream streams compatible with native VLC while still offering a
/// genuinely different browser-style fallback. Do not override an explicit
/// M3U per-channel agent. All values are safe to pass to VLC media options.
/// </summary>
public static class PlaybackUserAgentPolicy
{
    public const string Native = "VLC/3.0.24 LibVLC/3.0.24";
    public const string Browser = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    private const string DefaultApp = "BLOFY PLAYER/2.0 (Windows)";

    public static string Primary(string? streamAgent, string? configuredAgent)
    {
        if (IsSafe(streamAgent)) return streamAgent!.Trim();
        if (IsSafe(configuredAgent) &&
            !string.Equals(configuredAgent!.Trim(), DefaultApp, StringComparison.OrdinalIgnoreCase))
            return configuredAgent.Trim();
        return Native;
    }

    public static string Alternative(string primary) =>
        string.Equals(primary, Browser, StringComparison.OrdinalIgnoreCase)
            ? Native
            : Browser;

    private static bool IsSafe(string? agent) =>
        !string.IsNullOrWhiteSpace(agent) &&
        agent.Length <= 256 &&
        agent.All(ch => ch is >= ' ' and <= '~');
}
