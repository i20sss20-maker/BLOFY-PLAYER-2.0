package tv.blofy.player.ui.catalog

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import android.widget.ImageView
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.PriorityBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Fast artwork loader for TV catalogs.
 *
 * Visible artwork is scheduled ahead of speculative prefetch work, while network requests remain
 * deduplicated by URL. Broken URLs get a short negative cache and disk persistence never blocks UI.
 */
object ArtworkLoader {
    private const val MAX_IMAGE_BYTES = 8 * 1024 * 1024
    private const val MAX_DISK_BYTES = 260L * 1024L * 1024L
    private const val NEGATIVE_CACHE_MS = 5 * 60_000L

    private enum class Priority(val weight: Int) { VISIBLE(0), PREFETCH(1) }

    private class PriorityTask(
        val priority: Priority,
        val sequence: Long,
        private val block: () -> Unit
    ) : Runnable {
        override fun run() = block()
    }

    private val main = Handler(Looper.getMainLooper())
    private val workerCount = adaptiveWorkerCount()
    private val coordinatorPool = Executors.newFixedThreadPool(if (workerCount <= 4) 2 else 4)
    private val backgroundPool = Executors.newFixedThreadPool(2)
    private val taskSequence = AtomicLong(0)
    private val taskQueue = PriorityBlockingQueue<Runnable>(64) { a, b ->
        val left = a as PriorityTask
        val right = b as PriorityTask
        val byPriority = left.priority.weight.compareTo(right.priority.weight)
        if (byPriority != 0) byPriority else left.sequence.compareTo(right.sequence)
    }
    private val networkPool = ThreadPoolExecutor(
        workerCount,
        workerCount,
        30L,
        TimeUnit.SECONDS,
        taskQueue
    ).apply { allowCoreThreadTimeOut(false) }

    private val trimCounter = AtomicInteger(0)
    private val inFlight = ConcurrentHashMap<String, CompletableFuture<Bitmap?>>()
    private val failedUntil = ConcurrentHashMap<String, Long>()

    private val client = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(7, TimeUnit.SECONDS)
        .callTimeout(10, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    private val cache = object : LruCache<String, Bitmap>(memoryCacheKb()) {
        override fun sizeOf(key: String, value: Bitmap) = (value.byteCount / 1024).coerceAtLeast(1)
    }

    fun load(view: ImageView, rawUrl: String?) = load(view, listOf(rawUrl))

    fun load(view: ImageView, candidates: List<String?>) {
        cancel(view)
        val urls = candidates.mapNotNull(::normalizeUrl).distinct()
        val requestKey = urls.joinToString("|")
        view.tag = requestKey
        view.setImageDrawable(skeleton())
        if (urls.isEmpty()) return

        urls.firstNotNullOfOrNull { cache.get(it)?.takeIf { bmp -> !bmp.isRecycled } }?.let {
            view.setImageBitmap(it)
            return
        }

        val app = view.context.applicationContext
        coordinatorPool.execute {
            var bitmap: Bitmap? = null
            var resolvedUrl: String? = null
            for (url in urls) {
                if (view.tag != requestKey) return@execute
                if (isNegative(url)) continue
                bitmap = cache.get(url)?.takeIf { !it.isRecycled }
                    ?: readDisk(app.cacheDir, url)?.also { cache.put(url, it) }
                    ?: sharedDownload(url, Priority.VISIBLE).getOrNull()?.also {
                        cache.put(url, it)
                        resolvedUrl = url
                    }
                if (bitmap != null) break
            }

            val result = bitmap
            main.post {
                if (view.tag == requestKey) {
                    if (result != null && !result.isRecycled) view.setImageBitmap(result)
                    else view.setImageDrawable(skeleton())
                }
            }

            if (result != null && resolvedUrl != null) {
                val url = resolvedUrl!!
                backgroundPool.execute { writeDisk(app.cacheDir, url, result) }
            }
        }
    }

    /** Stops delivery to a recycled view; shared network work can still satisfy another consumer. */
    fun cancel(view: ImageView) {
        view.tag = null
    }

    fun prefetch(context: android.content.Context, urls: List<String?>) {
        val app = context.applicationContext
        urls.mapNotNull(::normalizeUrl).distinct().take(prefetchLimit()).forEach { url ->
            if (cache.get(url) != null || diskFile(app.cacheDir, url).isFile || isNegative(url)) return@forEach
            sharedDownload(url, Priority.PREFETCH).whenComplete { bmp, _ ->
                if (bmp != null && !bmp.isRecycled) {
                    cache.put(url, bmp)
                    backgroundPool.execute { writeDisk(app.cacheDir, url, bmp) }
                }
            }
        }
    }

    fun warmPrefetch(context: android.content.Context, urls: List<String?>) = prefetch(context, urls)

    private fun sharedDownload(url: String, priority: Priority): CompletableFuture<Bitmap?> {
        if (isNegative(url)) return CompletableFuture.completedFuture(null)
        inFlight[url]?.let { return it }

        val future = CompletableFuture<Bitmap?>()
        val existing = inFlight.putIfAbsent(url, future)
        if (existing != null) return existing

        val task = PriorityTask(priority, taskSequence.incrementAndGet()) {
            try {
                val result = downloadWithRetry(url)
                if (result == null) failedUntil[url] = System.currentTimeMillis() + NEGATIVE_CACHE_MS
                else failedUntil.remove(url)
                future.complete(result)
            } catch (error: Throwable) {
                future.completeExceptionally(error)
            } finally {
                inFlight.remove(url, future)
            }
        }
        networkPool.execute(task)
        return future
    }

    private fun downloadWithRetry(url: String): Bitmap? {
        repeat(2) {
            runCatching { execute(url) }.getOrNull()?.let { return it }
        }
        return null
    }

    private fun execute(url: String): Bitmap? {
        val request = Request.Builder().url(url)
            .header("User-Agent", "Mozilla/5.0 (Linux; Android TV) BLOFY-PLAYER/2.0")
            .header("Accept", "image/avif,image/webp,image/*,*/*;q=0.8")
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return null
            val body = response.body ?: return null
            val declared = body.contentLength()
            if (declared > MAX_IMAGE_BYTES) return null
            val bytes = body.byteStream().use { input ->
                val out = java.io.ByteArrayOutputStream(if (declared in 1..MAX_IMAGE_BYTES.toLong()) declared.toInt() else 64 * 1024)
                val buffer = ByteArray(32 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    out.write(buffer, 0, read)
                    if (out.size() > MAX_IMAGE_BYTES) return null
                }
                out.toByteArray()
            }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply {
                inPreferredConfig = Bitmap.Config.RGB_565
                inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, 420, 630)
            })
        }
    }

    private fun readDisk(cacheDir: File, url: String): Bitmap? {
        val file = diskFile(cacheDir, url)
        if (!file.isFile || file.length() <= 0L) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) { file.delete(); return null }
        val bmp = BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply {
            inPreferredConfig = Bitmap.Config.RGB_565
            inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, 420, 630)
        })
        if (bmp == null) file.delete() else file.setLastModified(System.currentTimeMillis())
        return bmp
    }

    private fun writeDisk(cacheDir: File, url: String, bitmap: Bitmap) {
        if (bitmap.isRecycled) return
        val dir = File(cacheDir, "blofy_posters").apply { mkdirs() }
        val file = File(dir, hash(url) + ".jpg")
        if (!file.isFile || file.length() <= 0L) {
            runCatching { file.outputStream().buffered().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 84, it) } }
        }
        if (trimCounter.incrementAndGet() % 32 == 0) trimDisk(dir)
    }

    private fun trimDisk(dir: File) {
        val files = dir.listFiles()?.filter { it.isFile } ?: return
        var total = files.sumOf { it.length() }
        if (total <= MAX_DISK_BYTES) return
        files.sortedBy { it.lastModified() }.forEach { file ->
            if (total <= MAX_DISK_BYTES) return
            total -= file.length(); file.delete()
        }
    }

    private fun isNegative(url: String): Boolean {
        val until = failedUntil[url] ?: return false
        if (until <= System.currentTimeMillis()) {
            failedUntil.remove(url, until)
            return false
        }
        return true
    }

    private fun skeleton() = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(0xFF21182D.toInt(), 0xFF30203F.toInt(), 0xFF17111F.toInt())
    ).apply { cornerRadius = 18f }

    private fun diskFile(cacheDir: File, url: String) = File(File(cacheDir, "blofy_posters"), hash(url) + ".jpg")
    private fun hash(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
    private fun sampleSize(w: Int, h: Int, tw: Int, th: Int): Int { var s = 1; while (w / (s * 2) >= tw && h / (s * 2) >= th) s *= 2; return s }

    private fun normalizeUrl(raw: String?): String? {
        val value = raw?.trim()?.takeIf { it.isNotBlank() && !it.equals("null", true) } ?: return null
        return runCatching { java.net.URI(value) }.getOrNull()?.takeIf {
            (it.scheme.equals("https", true) || it.scheme.equals("http", true)) && !it.host.isNullOrBlank()
        }?.let { value }
    }

    private fun adaptiveWorkerCount(): Int {
        val cores = Runtime.getRuntime().availableProcessors().coerceAtLeast(1)
        val maxMb = Runtime.getRuntime().maxMemory() / (1024L * 1024L)
        return when {
            maxMb <= 192 || cores <= 4 -> 4
            maxMb <= 384 || cores <= 6 -> 6
            else -> 8
        }
    }

    private fun memoryCacheKb(): Int {
        val maxMb = Runtime.getRuntime().maxMemory() / (1024L * 1024L)
        return when {
            maxMb <= 192 -> 32 * 1024
            maxMb <= 384 -> 48 * 1024
            else -> 64 * 1024
        }
    }

    private fun prefetchLimit(): Int = when {
        workerCount <= 4 -> 12
        workerCount <= 6 -> 18
        else -> 24
    }

    private fun <T> CompletableFuture<T>.getOrNull(): T? = runCatching { get() }.getOrNull()
}
