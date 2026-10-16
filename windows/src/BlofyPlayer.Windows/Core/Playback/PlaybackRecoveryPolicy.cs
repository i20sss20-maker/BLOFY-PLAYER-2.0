namespace BlofyPlayer.Windows.Core.Playback;

/// <summary>
/// Bounded recovery plan: try each distinct media URL with the primary agent,
/// then retry the best Xtream-style generated URL with the alternative agent.
/// No infinite decoder/HTTP connection loops.
/// </summary>
public static class PlaybackRecoveryPolicy
{
    public static int MaximumRecoveries(int urlCount)
    {
        if (urlCount <= 0) return 0;
        return Math.Min(6, urlCount + (urlCount > 1 ? 1 : 0));
    }

    public static int CompatibilityStartIndex(int urlCount)
    {
        // Four options normally mean direct_source, /live/.ts, /live/.m3u8,
        // and a legacy Xtream path. Prefer retrying a generated /live/ URL,
        // not the expiring direct_source or ancient legacy path.
        return urlCount >= 5 ? 2 : urlCount >= 3 ? 1 : 0;
    }
}
