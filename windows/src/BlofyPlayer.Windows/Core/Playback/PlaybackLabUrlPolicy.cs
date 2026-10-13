namespace BlofyPlayer.Windows.Core.Playback;

/// <summary>
/// Restricts the internal, debug-only playback probe to explicitly identified,
/// internet-safe media URLs. This does not grant access to content protected by DRM.
/// </summary>
public static class PlaybackLabUrlPolicy
{
    public static bool TryValidate(string? raw, out string url, out string format)
    {
        url = "";
        format = "";
        if (string.IsNullOrWhiteSpace(raw) || raw.Length > 4096) return false;
        var candidate = raw.Trim();
        if (!Uri.TryCreate(candidate, UriKind.Absolute, out var parsed)) return false;
        if (parsed.Scheme is not ("https" or "http")) return false;
        if (parsed.Scheme == "http" && !parsed.IsLoopback) return false;
        if (string.IsNullOrWhiteSpace(parsed.Host) || parsed.UserInfo.Length > 0 ||
            parsed.Fragment.Length > 0) return false;

        var path = parsed.AbsolutePath;
        format = path.EndsWith(".mpd", StringComparison.OrdinalIgnoreCase) ? "DASH" :
            path.EndsWith(".m3u8", StringComparison.OrdinalIgnoreCase) ? "HLS" :
            path.EndsWith(".ts", StringComparison.OrdinalIgnoreCase) ? "TS" :
            path.EndsWith(".mp4", StringComparison.OrdinalIgnoreCase) ? "MP4" : "";
        if (format.Length == 0) return false;
        // Preserve signed URL query strings exactly; do not persist or log.
        url = candidate;
        return true;
    }
}
