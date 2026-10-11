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
    // ConcurrentDictionary.GetOrAdd may run the value factory more than once;
    // Lazy<Task> ensures only one HTTP fetch/decode per poster and width.
    private static readonly ConcurrentDictionary<string, Lazy<Task<BitmapSource?>>> InFlight = new();
    private static readonly ConcurrentDictionary<string, BitmapSource> Hot = new();
    private static readonly ConcurrentQueue<string> HotOrder = new();
    private const int HotLimit = 192;
    private const int WeakLimit = 2048;
    private const int MaxImageBytes = 8_000_000;
    private static int _weakTrimStarted;
    private static int _newDiskFiles;
    private static long _nextPruneAtTicks;
    private const long MaxDiskBytes = 600L * 1024 * 1024;
    private const int MaxFiles = 3500;
    private static int _pruneStarted;

    private static readonly string Root = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "BLOFY PLAYER",
        "artwork-cache");

    static ArtworkCache()
    {
        Directory.CreateDirectory(Root);
        _ = Task.Run(PruneAsync);
    }

    public static Task<BitmapSource?> LoadAsync(string? url, int decodeWidth, CancellationToken ct = default)
    {
        if (ct.IsCancellationRequested)
            return Task.FromCanceled<BitmapSource?>(ct);
        if (string.IsNullOrWhiteSpace(url) ||
            !Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            uri.Scheme is not ("http" or "https"))
            return Task.FromResult<BitmapSource?>(null);

        var key = url + "|" + Math.Max(64, decodeWidth);
        if (Hot.TryGetValue(key, out var strong))
            return Task.FromResult<BitmapSource?>(strong);
        if (Memory.TryGetValue(key, out var weak) && weak.TryGetTarget(out var cached))
        {
            Retain(key, cached);
            return Task.FromResult<BitmapSource?>(cached);
        }

        // A single canceled card (e.g. switching categories) must not cancel
        // a fetch shared with other visible posters.
        var task = InFlight.GetOrAdd(key, _ => new Lazy<Task<BitmapSource?>>(
            () => LoadCoreAsync(url, decodeWidth, key, CancellationToken.None))).Value;
        return ct.CanBeCanceled ? task.WaitAsync(ct) : task;
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
            BitmapSource? bitmap = null;

            // Never trust stale/corrupt or oversized on-disk poster files.
            // A broken disk entry must not prevent a fresh network download.
            try
            {
                var info = new FileInfo(disk);
                if (info.Exists)
                {
                    if (info.Length is > 0 and <= MaxImageBytes)
                    {
                        var cachedBytes = await File.ReadAllBytesAsync(disk, ct).ConfigureAwait(false);
                        if (cachedBytes.Length <= MaxImageBytes)
                            bitmap = await DecodeAsync(cachedBytes, decodeWidth, ct).ConfigureAwait(false);
                    }

                    if (bitmap is null)
                        info.Delete();
                }
            }
            catch
            {
                bitmap = null;
            }

            if (bitmap is null)
            {
                byte[]? bytes;
                await Gate.WaitAsync(ct).ConfigureAwait(false);
                try
                {
                    using var response = await Http.GetAsync(
                        url, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
                    if (!response.IsSuccessStatusCode || response.Content.Headers.ContentLength is > MaxImageBytes)
                        return null;

                    // Content-Length can be missing or deliberately incorrect.
                    // Stream with a hard cap instead of allocating the entire response.
                    using var stream = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
                    bytes = await BoundedPayloadReader.ReadAsync(stream, MaxImageBytes, ct)
                        .ConfigureAwait(false);
                }
                finally
                {
                    Gate.Release();
                }

                if (bytes is null)
                    return null;

                // Only persist images that WPF can actually decode. This prevents
                // caching HTML error pages or a server's invalid image payload.
                bitmap = await DecodeAsync(bytes, decodeWidth, ct).ConfigureAwait(false);
                if (bitmap is null)
                    return null;

                // Width variants have different in-flight keys but share one disk
                // filename; give each download a private temp file to avoid races.
                var temp = disk + "." + Guid.NewGuid().ToString("N") + ".tmp";
                try
                {
                    await File.WriteAllBytesAsync(temp, bytes, ct).ConfigureAwait(false);
                    File.Move(temp, disk, true);
                    SchedulePrune();
                }
                catch { /* Filesystem failures must not block the poster. */ }
                finally
                {
                    try { if (File.Exists(temp)) File.Delete(temp); } catch { }
                }
            }

            Memory[memoryKey] = new WeakReference<BitmapSource>(bitmap);
            TrimWeakMemory();
            Retain(memoryKey, bitmap);
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

    private static async Task<BitmapSource?> DecodeAsync(
        byte[] bytes, int decodeWidth, CancellationToken ct)
    {
        try
        {
            return await Task.Run(() =>
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
        }
        catch
        {
            return null;
        }
    }

    private static void TrimWeakMemory()
    {
        // Weak references do not hold bitmaps, but their dictionary keys would
        // otherwise grow indefinitely while browsing very large catalogs.
        if (Memory.Count <= WeakLimit ||
            Interlocked.CompareExchange(ref _weakTrimStarted, 1, 0) != 0)
            return;

        try
        {
            foreach (var pair in Memory)
                if (!pair.Value.TryGetTarget(out _))
                    Memory.TryRemove(pair.Key, out _);

            var excess = Memory.Count - WeakLimit;
            if (excess > 0)
                foreach (var key in Memory.Keys)
                {
                    if (excess-- <= 0) break;
                    Memory.TryRemove(key, out _);
                }
        }
        finally
        {
            Volatile.Write(ref _weakTrimStarted, 0);
        }
    }

    private static void Retain(string key, BitmapSource bitmap)
    {
        // Keep a small number of decoded posters alive across back/forward.
        // Weak-only caching was forcing all hidden/reopened cards to decode.
        if (!Hot.TryAdd(key, bitmap)) return;
        HotOrder.Enqueue(key);
        while (Hot.Count > HotLimit && HotOrder.TryDequeue(out var evicted))
            Hot.TryRemove(evicted, out _);
    }

    private static void SchedulePrune()
    {
        // Avoid walking and sorting thousands of cache files for EVERY poster.
        // Prune at most once per 5 minutes and after a burst of new images.
        if (Interlocked.Increment(ref _newDiskFiles) < 64) return;
        var now = DateTime.UtcNow.Ticks;
        if (now < Volatile.Read(ref _nextPruneAtTicks)) return;
        Interlocked.Exchange(ref _newDiskFiles, 0);
        Interlocked.Exchange(ref _nextPruneAtTicks, now + TimeSpan.FromMinutes(5).Ticks);
        _ = Task.Run(PruneAsync);
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

    private static async Task PruneAsync()
    {
        if (Interlocked.Exchange(ref _pruneStarted, 1) == 1) return;
        try
        {
            await Task.Yield();
            var files = Directory.EnumerateFiles(Root, "*.img", SearchOption.TopDirectoryOnly)
                .Select(path =>
                {
                    try { return new FileInfo(path); }
                    catch { return null; }
                })
                .Where(info => info is not null)
                .Cast<FileInfo>()
                .OrderByDescending(info => info.LastWriteTimeUtc)
                .ToList();

            var total = files.Sum(info => info.Length);
            var keep = 0;
            foreach (var info in files)
            {
                keep++;
                if (keep <= MaxFiles && total <= MaxDiskBytes) continue;
                try
                {
                    total -= info.Length;
                    info.Delete();
                }
                catch { }
            }
        }
        catch { }
        finally
        {
            Interlocked.Exchange(ref _pruneStarted, 0);
        }
    }

    public static int Clear()
    {
        var removed = 0;
        Memory.Clear();
        Hot.Clear();
        while (HotOrder.TryDequeue(out _)) { }
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
        client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", AppBuildInfo.UserAgent);
        return client;
    }
}
