using System.Text.RegularExpressions;

namespace BlofyPlayer.Windows.Core;

/// <summary>
/// Remove credentials, streaming URLs and account identifiers from diagnostics.
/// Errors from LibVLC/HttpClient may embed Xtream usernames/passwords in URIs.
/// The conservative fallback for a regex timeout is to drop the whole message.
/// </summary>
public static class SensitiveTextRedactor
{
    private static readonly TimeSpan RegexTimeout = TimeSpan.FromMilliseconds(250);
    private static readonly Regex Urls = new(
        @"\bhttps?://[^\s<>""'\\]+",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled,
        RegexTimeout);
    private static readonly Regex CredentialsInPath = new(
        @"(?<prefix>/(?:live|movie|series)/)[^/\s]+/[^/\s]+(?=/|$)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled,
        RegexTimeout);
    private static readonly Regex SensitiveHeader = new(
        @"^\s*(?:Authorization|Proxy-Authorization|Cookie|Set-Cookie|X-BLOFY-Device-ID|X-BLOFY-Activation-Code)\s*:\s*.*$",
        RegexOptions.IgnoreCase | RegexOptions.Multiline | RegexOptions.CultureInvariant | RegexOptions.Compiled,
        RegexTimeout);
    private static readonly Regex Bearer = new(
        @"\bBearer\s+[A-Za-z0-9._~+/=-]+",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled,
        RegexTimeout);
    private static readonly Regex SecretAssignment = new(
        @"(?<prefix>\b(?:password|passwd|pwd|user|username|token|access_token|refresh_token|sessiontoken|session_token|api_key|apikey|secret|auth|authorization|activationcode|activation_code|deviceid|device_id)\b[""']?\s*[:=]\s*[""']?)[^\s""',;&}]+",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled,
        RegexTimeout);

    public static string Redact(string? message)
    {
        if (string.IsNullOrEmpty(message)) return string.Empty;
        try
        {
            var safe = SensitiveHeader.Replace(message, "[REDACTED_HEADER]");
            safe = Urls.Replace(safe, "[REDACTED_URL]");
            safe = CredentialsInPath.Replace(safe, "${prefix}[REDACTED]/[REDACTED]");
            safe = Bearer.Replace(safe, "Bearer [REDACTED]");
            safe = SecretAssignment.Replace(safe, "${prefix}[REDACTED]");
            return safe;
        }
        catch (RegexMatchTimeoutException)
        {
            return "[diagnostic removed to protect account credentials]";
        }
    }
}
