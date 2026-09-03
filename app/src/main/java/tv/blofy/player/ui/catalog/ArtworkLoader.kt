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
import tv.blofy.player.core.commercial.CommercialRuntime
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.FutureTask
import java.util.concurrent.PriorityBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

object ArtworkLoader {
    private const val MAX_IMAGE_BYTES = 8 * 1024 * 1024
    private const val MAX_DISK_BYTES = 260L * 1024L * 1024L
    private const val NEGATIVE_CACHE_MS = 5 * 60_000L

    private enum class Priority(val weight: Int) { VISIBLE(0), PREFETCH(1) }
    private data class Target(val width: Int, val height: Int, val diskBucket: Int)

    private class PriorityTask(val priority: Priority, val sequence: Long, private val block: () -> Unit) : Runnable {
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
    private val networkPool = ThreadPoolExecutor(workerCount, workerCount, 30L, TimeUnit.SECONDS, taskQueue).apply { allowCoreThreadTimeOut(false) }
    private val trimCounter = AtomicInteger(0)
    private val inFlight = ConcurrentHashMap<String, FutureTask<Bitmap?>>()
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
    fun loadPriority(view: ImageView, rawUrl: String?) = load(view, rawUrl)
    fun loadPriority(view: ImageView, candidates: List<String?>) = load(view, candidates)

    fun load(view: ImageView, candidates: List<String?>) {
        cancel(view)
        val urls = candidates.mapNotNull(::normalizeUrl).distinct()
        val target = target(view.context)
        val requestKey = urls.joinToString("|") + "@${target.diskBucket}"
        view.tag = requestKey
        view.setImageDrawable(skeleton())
        if (urls.isEmpty()) return

        urls.firstNotNullOfOrNull { url -> cache.get(cacheKey(url, target))?.takeIf { bmp -> !bmp.isRecycled } }?.let {
            show(view, requestKey, it)
            return
        }

        val app = view.context.applicationContext
        coordinatorPool.execute {
            var bitmap: Bitmap? = null
            var resolvedUrl: String? = null
            for (url in urls) {
                if (view.tag != requestKey) return@execute
                val key = cacheKey(url, target)
                if (isNegative(key)) continue
                bitmap = cache.get(key)?.takeIf { !it.isRecycled }
                    ?: readDisk(app.cacheDir, url, target)?.also { cache.put(key, it) }
                    ?: sharedDownload(url, Priority.VISIBLE, target).getOrNull()?.also {
                        cache.put(key, it)
                        resolvedUrl = url
                    }
                if (bitmap != null) break
            }
            val result = bitmap
            main.post {
                if (view.tag == requestKey) {
                    if (result != null && !result.isRecycled) show(view, requestKey, result)
                    else view.setImageDrawable(skeleton())
                }
            }
            if (result != null && resolvedUrl != null) {
                val url = resolvedUrl!!
                backgroundPool.execute { writeDisk(app.cacheDir, url, target, result) }
            }
        }
    }

    fun cancel(view: ImageView) {
        view.animate().cancel()
        view.tag = null
    }

    fun prefetch(context: android.content.Context, urls: List<String?>) {
        val app = context.applicationContext
        val target = target(app)
        urls.mapNotNull(::normalizeUrl).distinct().take(prefetchLimit(app)).forEach { url ->
            val key = cacheKey(url, target)
            if (cache.get(key) != null || diskFile(app.cacheDir, url, target).isFile || isNegative(key)) return@forEach
            backgroundPool.execute {
                val bmp = sharedDownload(url, Priority.PREFETCH, target).getOrNull()
                if (bmp != null && !bmp.isRecycled) {
                    cache.put(key, bmp)
                    writeDisk(app.cacheDir, url, target, bmp)
                }
            }
        }
    }

    fun warmPrefetch(context: android.content.Context, urls: List<String?>) = prefetch(context, urls)

    private fun show(view: ImageView, requestKey: String, bitmap: Bitmap) {
        if (view.tag != requestKey) return
        val fade = CommercialRuntime.feature(view.context, CommercialRuntime.FEATURE_IMAGE_FADE) &&
            !CommercialRuntime.reducedMotion(view.context)
        view.animate().cancel()
        if (fade) view.alpha = .25f
        view.setImageBitmap(bitmap)
        if (fade) view.animate().alpha(1f).setDuration(120L).start() else view.alpha = 1f
    }

    private fun sharedDownload(url: String, priority: Priority, target: Target): FutureTask<Bitmap?> {
        val key = cacheKey(url, target)
        if (isNegative(key)) return FutureTask<Bitmap?> { null }.apply { run() }
        inFlight[key]?.let { return it }

        val future = FutureTask<Bitmap?> {
            val result = downloadWithRetry(url, target)
            if (result == null) failedUntil[key] = System.currentTimeMillis() + NEGATIVE_CACHE_MS else failedUntil.remove(key)
            result
        }
        val existing = inFlight.putIfAbsent(key, future)
        if (existing != null) return existing

        networkPool.execute(PriorityTask(priority, taskSequence.incrementAndGet()) {
            try { future.run() } finally { inFlight.remove(key, future) }
        })
        return future
    }

    private fun downloadWithRetry(url: String, target: Target): Bitmap? {
        repeat(2) { runCatching { execute(url, target) }.getOrNull()?.let { return it } }
        return null
    }

    private fun execute(url: String, target: Target): Bitmap? {
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
                inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, target.width, target.height)
            })
        }
    }

    private fun readDisk(cacheDir: File, url: String, target: Target): Bitmap? {
        val file = diskFile(cacheDir, url, target)
        if (!file.isFile || file.length() <= 0L) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) { file.delete(); return null }
        val bmp = BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply {
            inPreferredConfig = Bitmap.Config.RGB_565
            inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, target.width, target.height)
        })
        if (bmp == null) file.delete() else file.setLastModified(System.currentTimeMillis())
        return bmp
    }

    private fun writeDisk(cacheDir: File, url: String, target: Target, bitmap: Bitmap) {
        if (bitmap.isRecycled) return
        val dir = File(cacheDir, "blofy_posters").apply { mkdirs() }
        val file = diskFile(cacheDir, url, target)
        if (!file.isFile || file.length() <= 0L) runCatching {
            file.outputStream().buffered().use { bitmap.compress(Bitmap.CompressFormat.JPEG, jpegQuality(target), it) }
        }
        if (trimCounter.incrementAndGet() % 32 == 0) trimDisk(dir)
    }

    private fun trimDisk(dir: File) {
        val files = dir.listFiles()?.filter { it.isFile } ?: return
        var total = files.sumOf { it.length() }
        if (total <= MAX_DISK_BYTES) return
        files.sortedBy { it.lastModified() }.forEach { file ->
            if (total <= MAX_DISK_BYTES) return
            total -= file.length()
            file.delete()
        }
    }

    private fun isNegative(key: String): Boolean {
        val until = failedUntil[key] ?: return false
        if (until <= System.currentTimeMillis()) {
            failedUntil.remove(key, until)
            return false
        }
        return true
    }

    private fun target(context: android.content.Context): Target = when (CommercialRuntime.imageMode(context)) {
        CommercialRuntime.ImageMode.ECONOMY -> Target(280, 420, 280)
        CommercialRuntime.ImageMode.HIGH -> Target(640, 960, 640)
        CommercialRuntime.ImageMode.BALANCED -> Target(420, 630, 420)
    }

    private fun jpegQuality(target: Target): Int = when (target.diskBucket) {
        280 -> 78
        640 -> 90
        else -> 84
    }

    private fun cacheKey(url: String, target: Target) = "$url@${target.diskBucket}"
    private fun skeleton() = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(0xFF21182D.toInt(), 0xFF30203F.toInt(), 0xFF17111F.toInt())).apply { cornerRadius = 18f }
    private fun diskFile(cacheDir: File, url: String, target: Target) = File(File(cacheDir, "blofy_posters"), hash(cacheKey(url, target)) + ".jpg")
    private fun hash(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
    private fun sampleSize(w: Int, h: Int, tw: Int, th: Int): Int { var s = 1; while (w / (s * 2) >= tw && h / (s * 2) >= th) s *= 2; return s }

    private fun normalizeUrl(raw: String?): String? {
        val value = raw?.trim()?.takeIf { it.isNotBlank() && !it.equals("null", true) } ?: return null
        return runCatching { java.net.URI(value) }.getOrNull()?.takeIf { (it.scheme.equals("https", true) || it.scheme.equals("http", true)) && !it.host.isNullOrBlank() }?.let { value }
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

    private fun prefetchLimit(context: android.content.Context): Int {
        if (CommercialRuntime.safeMode(context)) return 6
        return when {
            workerCount <= 4 -> 12
            workerCount <= 6 -> 18
            else -> 24
        }
    }

    private fun <T> FutureTask<T>.getOrNull(): T? = runCatching { get() }.getOrNull()
}
