using BlofyPlayer.Windows.Core.Identity;

namespace BlofyPlayer.Windows.Core;

public static class BlofyEndpoints
{
    public const string ServiceBase = "https://api.blofyplayer.com/";
    public const string ServiceOrigin = "https://api.blofyplayer.com";
    public const string UpdateBase = "https://updates.blofyplayer.com/";

    public const string ActivationCheck = "api/v1/activation/check";
    public const string PortalPlaylists = "api/v1/portal/playlists";
    public const string PortalList = "api/v1/portal/playlists/list";
    public const string CloudProfile = "api/v1/cloud/profile";
    public const string SubscriberRoot = "api/v1/subscribers";

    public static string ActivationPortal(BlofyIdentity identity) =>
        ServiceOrigin + "/connect#deviceId=" + Uri.EscapeDataString(identity.DeviceId) +
        "&code=" + Uri.EscapeDataString(identity.ActivationCode);

    public static string SubscriberProxy =>
        ServiceOrigin + BlofySubscriberService.ProxyPath;
}
