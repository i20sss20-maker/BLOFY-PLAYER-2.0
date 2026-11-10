namespace BlofyPlayer.Windows.Core;

/// <summary>Separate Windows application edition. No PLAYER activation or credentials are reused.</summary>
public static class StreamRuntime
{
    public const bool IsStreamEdition = true;
    public static StreamMediaProxy? MediaProxy { get; set; }

    public static string MediaUrl(string kind, string id, string extension)
    {
        var remote = StreamCodeAccess.MediaUrl(kind, id, extension);
        return MediaProxy?.LocalUrl(remote)
            ?? throw new InvalidOperationException("STREAM playback is not initialized");
    }

    public static async Task StopAsync()
    {
        var proxy = MediaProxy;
        MediaProxy = null;
        if (proxy is not null) await proxy.DisposeAsync();
    }
}
