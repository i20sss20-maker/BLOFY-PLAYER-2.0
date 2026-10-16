namespace BlofyPlayer.Windows.Core;

/// <summary>
/// One EPG reminder scoped to a profile, subscription and live channel.
/// No playlist URLs, authentication secrets or device identifiers are stored.
/// </summary>
public sealed class EpgReminder
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string ProfileId { get; set; } = "";
    public string ProviderId { get; set; } = "";
    public string ChannelKey { get; set; } = "";
    public string ChannelName { get; set; } = "";
    public string ProgramTitle { get; set; } = "";
    public long StartAtMs { get; set; }
    public bool Notified { get; set; }
}

public static class EpgReminderPolicy
{
    public static readonly TimeSpan LeadTime = TimeSpan.FromMinutes(5);

    public static bool IsSame(EpgReminder reminder, string profileId, string providerId,
        string channelKey, string title, long startAtMs) =>
        reminder.ProfileId == profileId &&
        reminder.ProviderId == providerId &&
        reminder.ChannelKey == channelKey &&
        reminder.ProgramTitle == title &&
        reminder.StartAtMs == startAtMs;

    public static bool CanSchedule(DateTimeOffset start, DateTimeOffset now) =>
        start > now && start <= now.AddDays(7);

    public static bool ShouldNotify(EpgReminder reminder, DateTimeOffset now)
    {
        if (reminder.Notified || reminder.StartAtMs <= 0) return false;
        try
        {
            var start = DateTimeOffset.FromUnixTimeMilliseconds(reminder.StartAtMs);
            return now >= start - LeadTime && now <= start.AddMinutes(5);
        }
        catch (ArgumentOutOfRangeException)
        {
            return false;
        }
    }

    public static bool IsExpired(EpgReminder reminder, DateTimeOffset now)
    {
        try { return DateTimeOffset.FromUnixTimeMilliseconds(reminder.StartAtMs) < now.AddHours(-2); }
        catch (ArgumentOutOfRangeException) { return true; }
    }
}
