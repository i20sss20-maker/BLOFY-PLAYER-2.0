namespace BlofyPlayer.Windows.Core;

/// <summary>
/// Only surface Windows update links on BLOFY-controlled hosts or from the
/// official GitHub release-assets path. We open links in the browser; we never
/// execute unverified updates from server-provided locations.
/// </summary>
public static class UpdateDownloadPolicy
{
    private static readonly HashSet<string> OfficialHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "blofyplayer.com",
        "www.blofyplayer.com",
        "updates.blofyplayer.com",
        "api.blofyplayer.com"
    };
    private const string RepositoryReleasePrefix =
        "/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/";

    public static bool IsApproved(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw) ||
            !Uri.TryCreate(raw, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps ||
            !uri.IsDefaultPort ||
            !string.IsNullOrEmpty(uri.UserInfo) ||
            !string.IsNullOrEmpty(uri.Fragment))
            return false;

        if (OfficialHosts.Contains(uri.IdnHost))
            return true;

        if (!uri.IdnHost.Equals("github.com", StringComparison.OrdinalIgnoreCase) ||
            !uri.AbsolutePath.StartsWith(RepositoryReleasePrefix, StringComparison.OrdinalIgnoreCase))
            return false;

        // Reject release root pages and unrelated links inside a GitHub release.
        var rest = uri.AbsolutePath[RepositoryReleasePrefix.Length..];
        var slash = rest.IndexOf('/');
        if (slash <= 0 || slash == rest.Length - 1)
            return false;

        var asset = rest[(slash + 1)..];
        if (asset.Contains('/') || asset.Contains('%') || asset.Contains('\\'))
            return false;

        return asset.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ||
               asset.EndsWith(".msix", StringComparison.OrdinalIgnoreCase) ||
               asset.EndsWith(".zip", StringComparison.OrdinalIgnoreCase);
    }
}
