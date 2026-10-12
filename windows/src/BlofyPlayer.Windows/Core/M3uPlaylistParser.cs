using System.IO;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;

namespace BlofyPlayer.Windows.Core;

public sealed record M3uPlaylistEntry(
    string Url, string Name, string Logo, string Group, string TvgId,
    string UserAgent, string Referer);

/// <summary>
/// Incremental parser for large licensed IPTV playlists. Metadata, HTTP
/// options and playlist URLs are consumed one entry at a time; no Split('\n')
/// or full-file string allocations are required.
/// </summary>
public static class M3uPlaylistParser
{
    private static readonly Regex Attr = new(
        "(?<key>[A-Za-z0-9_-]+)=\"(?<value>[^\"]*)\"",
        RegexOptions.Compiled | RegexOptions.CultureInvariant,
        TimeSpan.FromMilliseconds(250));

    public const int MaxEntries = 300_000;
    public const int MaxLineCharacters = 128 * 1024;
    public const long MaxPlaylistBytes = 128L * 1024 * 1024;

    public static async IAsyncEnumerable<M3uPlaylistEntry> ReadAsync(
        TextReader reader, [EnumeratorCancellation] CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(reader);

        var name = "";
        var logo = "";
        var group = "";
        var tvg = "";
        var agent = "";
        var referer = "";
        var entries = 0;
        var lines = 0;

        while (true)
        {
            ct.ThrowIfCancellationRequested();
            var line = await reader.ReadLineAsync(ct).ConfigureAwait(false);
            if (line is null) break;
            if (line.Length > MaxLineCharacters)
                throw new InvalidDataException("M3U metadata or URL line is too large.");

            lines++;
            line = line.Trim();
            if (line.StartsWith("#EXTINF", StringComparison.OrdinalIgnoreCase))
            {
                var comma = line.LastIndexOf(',');
                name = comma >= 0 ? line[(comma + 1)..].Trim() : "";
                logo = group = tvg = agent = referer = "";
                foreach (Match match in Attr.Matches(line))
                {
                    var key = match.Groups["key"].Value;
                    var value = match.Groups["value"].Value;
                    if (key.Equals("tvg-logo", StringComparison.OrdinalIgnoreCase)) logo = value;
                    else if (key.Equals("group-title", StringComparison.OrdinalIgnoreCase)) group = value;
                    else if (key.Equals("tvg-id", StringComparison.OrdinalIgnoreCase)) tvg = value;
                }
            }
            else if (line.StartsWith("#EXTVLCOPT:", StringComparison.OrdinalIgnoreCase))
            {
                var option = line[11..];
                var equals = option.IndexOf('=');
                if (equals > 0)
                {
                    var key = option[..equals].Trim();
                    var value = CleanHeader(option[(equals + 1)..]);
                    if (key.Equals("http-user-agent", StringComparison.OrdinalIgnoreCase))
                        agent = value;
                    else if (key.Equals("http-referrer", StringComparison.OrdinalIgnoreCase) ||
                             key.Equals("http-referer", StringComparison.OrdinalIgnoreCase))
                        referer = value;
                }
            }
            else if (line.Length > 0 && !line.StartsWith('#'))
            {
                var url = line;
                var suffixAt = line.LastIndexOf('|');
                if (suffixAt > 0 &&
                    (line[(suffixAt + 1)..].Contains("User-Agent=", StringComparison.OrdinalIgnoreCase) ||
                     line[(suffixAt + 1)..].Contains("Referer=", StringComparison.OrdinalIgnoreCase) ||
                     line[(suffixAt + 1)..].Contains("Referrer=", StringComparison.OrdinalIgnoreCase)))
                {
                    url = line[..suffixAt];
                    foreach (var pair in line[(suffixAt + 1)..].Split('&'))
                    {
                        var equal = pair.IndexOf('=');
                        if (equal <= 0) continue;
                        var key = pair[..equal].Trim();
                        string value;
                        try { value = CleanHeader(Uri.UnescapeDataString(pair[(equal + 1)..])); }
                        catch { continue; }
                        if (key.Equals("User-Agent", StringComparison.OrdinalIgnoreCase))
                            agent = value;
                        else if (key.Equals("Referer", StringComparison.OrdinalIgnoreCase) ||
                                 key.Equals("Referrer", StringComparison.OrdinalIgnoreCase))
                            referer = value;
                    }
                }

                if (Uri.TryCreate(url, UriKind.Absolute, out var uri) &&
                    uri.Scheme is "http" or "https" or "rtsp" or "rtmp" or "udp" or "mms")
                {
                    if (++entries > MaxEntries)
                        throw new InvalidDataException("M3U playlist contains too many entries.");
                    yield return new M3uPlaylistEntry(
                        url, string.IsNullOrWhiteSpace(name) ? "Channel" : name,
                        logo, group, tvg, agent, referer);
                }
                name = logo = group = tvg = agent = referer = "";
            }

            if (lines % 512 == 0)
                await Task.Yield();
        }
    }

    private static string CleanHeader(string? value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > 1024 ||
            value.Any(ch => char.IsControl(ch)))
            return "";
        return value.Trim();
    }
}
