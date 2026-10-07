using LibVLCSharp.Shared;

namespace BlofyPlayer.Windows.Core.Playback;

public sealed class PlaybackService : IDisposable
{
    public LibVLC LibVlc { get; }
    public MediaPlayer MediaPlayer { get; }

    public PlaybackService()
    {
        LibVLCSharp.Shared.Core.Initialize();

        LibVlc = new LibVLC(
            "--no-video-title-show",
            "--network-caching=700",
            "--live-caching=500",
            "--file-caching=500",
            "--avcodec-hw=any"
        );

        MediaPlayer = new MediaPlayer(LibVlc);
    }

    public bool Play(string url, IReadOnlyDictionary<string, string>? headers = null)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
            return false;

        using var media = new Media(LibVlc, uri);

        if (headers is not null)
        {
            foreach (var (key, value) in headers)
            {
                if (key.Equals("User-Agent", StringComparison.OrdinalIgnoreCase))
                    media.AddOption($":http-user-agent={value}");
                else if (key.Equals("Referer", StringComparison.OrdinalIgnoreCase))
                    media.AddOption($":http-referrer={value}");
            }
        }

        return MediaPlayer.Play(media);
    }

    public void Stop() => MediaPlayer.Stop();

    public void Dispose()
    {
        MediaPlayer.Dispose();
        LibVlc.Dispose();
    }
}
