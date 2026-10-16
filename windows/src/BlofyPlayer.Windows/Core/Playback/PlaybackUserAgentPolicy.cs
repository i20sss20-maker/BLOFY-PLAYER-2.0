namespace BlofyPlayer.Windows.Core.Playback;

/// <summary>
/// Match Android's default media User-Agent, while preserving an explicit
/// per-stream/per-provider agent. Retry with a distinct native VLC agent if
/// Android-style headers fail; never inject user-controlled HTTP header lines.
/// </summary>
public static class PlaybackUserAgentPolicy
{
    // Android TransportFactory uses exactly this value for Media3/Cronet.
    public const string Android = "BLOFY PLAYER/2.0";
    public const string Native = "VLC/3.0.24 LibVLC/3.0.24";
    public const string Browser = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    private const string LegacyWindows = "BLOFY PLAYER/2.0 (Windows)";

    public static string Primary(string? streamAgent, string? configuredAgent)
    {
        if (IsSafe(streamAgent)) return streamAgent!.Trim();
        if (IsSafe(configuredAgent) &&
            !string.Equals(configuredAgent!.Trim(), LegacyWindows, StringComparison.OrdinalIgnoreCase))
            return configuredAgent.Trim();
        return Android;
    }

    public static string Alternative(string primary) =>
        string.Equals(primary, Android, StringComparison.OrdinalIgnoreCase)
            ? Native
            : Android;

    private static bool IsSafe(string? agent) =>
        !string.IsNullOrWhiteSpace(agent) &&
        agent.Length <= 256 &&
        agent.All(ch => ch is >= ' ' and <= '~');
}
