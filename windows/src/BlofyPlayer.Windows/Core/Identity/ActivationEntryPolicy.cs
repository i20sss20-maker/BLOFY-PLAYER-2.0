namespace BlofyPlayer.Windows.Core.Identity;

/// <summary>
/// Reuse only a very recent, server-approved activation during the same startup.
/// This avoids an immediate duplicate network request after the device was
/// authorized, without allowing an expired or unverified activation offline.
/// </summary>
public static class ActivationEntryPolicy
{
    private static readonly TimeSpan MaximumAge = TimeSpan.FromSeconds(20);

    public static bool CanReuseRecentApproval(
        bool serverApproved,
        long? expiresAt,
        DateTimeOffset? approvedAt,
        DateTimeOffset now)
    {
        if (!serverApproved || approvedAt is null ||
            approvedAt.Value > now || now - approvedAt.Value > MaximumAge)
            return false;

        if (expiresAt is not long expiry) return true;

        try
        {
            var deadline = expiry > 10_000_000_000
                ? DateTimeOffset.FromUnixTimeMilliseconds(expiry)
                : DateTimeOffset.FromUnixTimeSeconds(expiry);
            return deadline > now;
        }
        catch (ArgumentOutOfRangeException)
        {
            return false;
        }
    }
}
