using System.Net;
using System.Net.Sockets;

namespace BlofyPlayer.Windows.Core.Playback;

/// <summary>
/// Android parity for authorized Xtream direct_source URLs. Only swap the
/// origin to the configured, publicly reachable provider when the source host
/// differs. Always preserve the original media path and signed query string.
/// No DNS lookup and no credential or provider setting is changed.
/// </summary>
public static class PlaybackSourceHostPolicy
{
    public static string? ProviderOriginFallback(string providerBase, string? directSource)
    {
        if (!TryHttpUri(providerBase, out var provider) ||
            !TryHttpUri(directSource, out var source) ||
            IsClearlyInternal(provider.Host) ||
            SameOrigin(provider, source))
            return null;
        return provider.GetLeftPart(UriPartial.Authority) + source.PathAndQuery;
    }

    public static bool PreferProviderOrigin(string providerBase, string? directSource)
    {
        if (!TryHttpUri(providerBase, out var provider) ||
            !TryHttpUri(directSource, out var source)) return false;
        return !IsClearlyInternal(provider.Host) && IsClearlyInternal(source.Host);
    }

    private static bool SameOrigin(Uri left, Uri right) =>
        left.Scheme.Equals(right.Scheme, StringComparison.OrdinalIgnoreCase) &&
        left.IdnHost.Equals(right.IdnHost, StringComparison.OrdinalIgnoreCase) &&
        left.Port == right.Port;

    private static bool TryHttpUri(string? text, out Uri uri)
    {
        uri = null!;
        if (string.IsNullOrWhiteSpace(text) ||
            !Uri.TryCreate(text.Trim(), UriKind.Absolute, out var value) ||
            value.Scheme is not ("http" or "https") ||
            !string.IsNullOrEmpty(value.UserInfo))
            return false;
        uri = value;
        return true;
    }

    private static bool IsClearlyInternal(string host)
    {
        var text = host.TrimEnd('.').ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(text) || text == "localhost" ||
            text.EndsWith(".localhost") || text.EndsWith(".local") ||
            text.EndsWith(".lan") || text.EndsWith(".internal") ||
            text.EndsWith(".home") || text.EndsWith(".home.arpa"))
            return true;

        if (IPAddress.TryParse(text, out var ip))
        {
            if (ip.AddressFamily == AddressFamily.InterNetworkV6)
            {
                var bytes = ip.GetAddressBytes();
                return IPAddress.IsLoopback(ip) || ip.IsIPv6LinkLocal ||
                    ip.IsIPv6SiteLocal || ip.IsIPv6Multicast ||
                    (bytes[0] & 0xFE) == 0xFC || ip.Equals(IPAddress.IPv6Any);
            }
            var octets = ip.GetAddressBytes();
            return octets[0] is 0 or 10 or 127 or >= 224 ||
                octets[0] == 100 && octets[1] is >= 64 and <= 127 ||
                octets[0] == 169 && octets[1] == 254 ||
                octets[0] == 172 && octets[1] is >= 16 and <= 31 ||
                octets[0] == 192 && octets[1] == 168;
        }

        return !text.Contains('.');
    }
}
