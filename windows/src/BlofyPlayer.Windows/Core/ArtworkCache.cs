using System.Collections.Concurrent;
using System.Net;
using System.Net.Http;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Media.Imaging;

namespace BlofyPlayer.Windows.Core;

public static class ArtworkCache
{
    private static readonly HttpClient Http = CreateClient();
    private static readonly SemaphoreSlim Gate = new(4, 4);
    private static readonly ConcurrentDictionary<string, WeakReference<BitmapSource>> Memory = new();
    private static readonly ConcurrentDictionary<string, Task<BitmapSource?>> InFlight = new();

    private static readonly string Root = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "BLOFY PLAYER",
        "artwork-cache");

    static ArtworkCache() => Directory.CreateDirectory(Root);

    public static Task<BitmapSource?> LoadAsync(string? url, int decodeWidth, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(url) ||
            !Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            uri.Scheme is not ("http" or "https"))
            return Task.FromResult<BitmapSource?>(null);

        var key = url + "|" + Math.Max(64, decodeWidth);
        if (Memory.TryGetValue(key, out var weak) && weak.TryGetTarget(out var cached))
            return Task.FromResult<BitmapSource?>(cached);

        return InFlight.GetOrAdd(key, _ => LoadCoreAsync(url, decodeWidth, key, ct));
    }

    private static async Task<BitmapSource?> LoadCoreAsync(
        string url,
        int decodeWidth,
        string memoryKey,
        CancellationToken ct)
    {
        try
        {
            var disk = DiskPath(url);
            byte[] bytes;

            if (File.Exists(disk))
            {
                bytes = await File.ReadAllBytesAsync(disk, ct).ConfigureAwait(false);
            }
            else
            {
                await Gate.WaitAsync(ct).ConfigureAwait(false);
                try
                {
                    using var response = await Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct)
                        .ConfigureAwait(false);
                    if (!response.IsSuccessStatusCode) return null;

                    var length = response.Content.Headers.ContentLength;
                    if (length is > 8_000_000) return null;

                    bytes = await response.Content.ReadAsByteArrayAsync(ct).ConfigureAwait(false);
                    if (bytes.Length == 0 || bytes.Length > 8_000_000) return null;

                    try
                    {
                        var temp = disk + ".tmp";
                        await File.WriteAllBytesAsync(temp, bytes, ct).ConfigureAwait(false);
                        File.Move(temp, disk, true);
                    }
                    catch { }
                }
                finally
                {
                    Gate.Release();
                }
            }

            var bitmap = await Task.Run(() =>
            {
                using var stream = new MemoryStream(bytes, writable: false);
                var image = new BitmapImage();
                image.BeginInit();
                image.CacheOption = BitmapCacheOption.OnLoad;
                image.CreateOptions = BitmapCreateOptions.IgnoreColorProfile;
                image.DecodePixelWidth = Math.Max(64, decodeWidth);
                image.StreamSource = stream;
                image.EndInit();
                image.Freeze();
                return (BitmapSource)image;
            }, ct).ConfigureAwait(false);

            Memory[memoryKey] = new WeakReference<BitmapSource>(bitmap);
            return bitmap;
        }
        catch
        {
            return null;
        }
        finally
        {
            InFlight.TryRemove(memoryKey, out _);
        }
    }

    public static long DiskBytes()
    {
        try
        {
            return Directory.EnumerateFiles(Root, "*", SearchOption.TopDirectoryOnly)
                .Sum(path => new FileInfo(path).Length);
        }
        catch { return 0; }
    }

    public static int Clear()
    {
        var removed = 0;
        Memory.Clear();
        try
        {
            foreach (var path in Directory.EnumerateFiles(Root, "*", SearchOption.TopDirectoryOnly))
            {
                try { File.Delete(path); removed++; } catch { }
            }
        }
        catch { }
        return removed;
    }

    private static string DiskPath(string url)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(url));
        return Path.Combine(Root, Convert.ToHexString(hash).ToLowerInvariant() + ".img");
    }

    private static HttpClient CreateClient()
    {
        var handler = new HttpClientHandler
        {
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
            AllowAutoRedirect = true
        };
        var client = new HttpClient(handler)
        {
            Timeout = TimeSpan.FromSeconds(10)
        };
        client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "BLOFY-PLAYER-Windows/0.4.0");
        return client;
    }
}
