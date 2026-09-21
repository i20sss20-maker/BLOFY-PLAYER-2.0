package tv.blofy.player.ui.catalog

import android.content.ComponentCallbacks2
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.util.AtomicFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import android.util.LruCache
import android.widget.ImageView
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Call
import tv.blofy.player.core.commercial.CommercialRuntime
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.FutureTask
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

object ArtworkLoader {
    private const val MAX_IMAGE_BYTES = 8 * 1024 * 1024
    private const val MAX_DISK_BYTES = 260L * 1024L * 1024L
    private const val NEGATIVE_CACHE_MS = 5 * 60_000L
    private const val MAX_FAILED_URLS = 2_048

    private enum class Priority { VISIBLE, PREFETCH }
    private data class Target(val width: Int, val height: Int, val diskBucket: Int)
    private data class Downloaded(val bitmap: Bitmap, val encoded: ByteArray)
    private class ViewRequest {
        var local: FutureTask<Unit>? = null
        var release: (() -> Unit)? = null
    }

    private val main = Handler(Looper.getMainLooper())
    private val workerCount = adaptiveWorkerCount()
    private val viewRequests = java.util.WeakHashMap<ImageView, ViewRequest>()
    // Local hits must never queue behind a view waiting for a slow HTTP response.
    private val localPool = Executors.newFixedThreadPool(2)
    private val backgroundPool = Executors.newFixedThreadPool(2)
    private val storagePool = Executors.newSingleThreadExecutor()
    private val pendingWrites = java.util.Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())
    private val pendingPrefetch = java.util.Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())
    private val fileLocks = Array(64) { Any() }
    // A priority queue cannot preempt background calls that already occupy every worker.
    private val networkPool = ThreadPoolExecutor(workerCount, workerCount, 30L, TimeUnit.SECONDS, LinkedBlockingQueue<Runnable>())
    private val backgroundNetworkPool = ThreadPoolExecutor(1, 1, 30L, TimeUnit.SECONDS, LinkedBlockingQueue<Runnable>())
    private val cancellationPool = Executors.newSingleThreadScheduledExecutor()
    private val requestLock = Any()
    private val trimCounter = AtomicInteger(0)
    private val inFlight = HashMap<String, Download>()
    // Broken artwork can have a different URL for every catalog row. Bound those entries too.
    private val failedUntil = LruCache<String, Long>(MAX_FAILED_URLS)

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

    fun trimMemory(level: Int) {
        when {
            level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL -> clearMemory()
            level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW -> {
                cache.trimToSize(cache.size() / 2)
                failedUntil.trimToSize(failedUntil.size() / 2)
            }
        }
    }

    fun clearMemory() {
        // Views may still display these bitmaps: release cache references, never recycle them.
        cache.evictAll()
        failedUntil.evictAll()
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
        view.alpha = 1f
        view.setImageDrawable(skeleton())
        if (urls.isEmpty()) return

        urls.firstNotNullOfOrNull { url -> cache.get(cacheKey(url, target))?.takeIf { bmp -> !bmp.isRecycled } }?.let {
            show(view, requestKey, it)
            return
        }

        val app = view.context.applicationContext
        val request = ViewRequest()
        viewRequests[view] = request
        val task = FutureTask<Unit> {
            var bitmap: Bitmap? = null
            for (url in urls) {
                if (Thread.currentThread().isInterrupted) return@FutureTask
                bitmap = cache.get(cacheKey(url, target))?.takeUnless { it.isRecycled }
                    ?: readPinned(app, url, target) ?: readDisk(app.cacheDir, url, target)
                if (bitmap != null) {
                    cache.put(cacheKey(url, target), bitmap)
                    retainLocally(app, url, target, bitmap)
                    break
                }
            }
            val local = bitmap
            main.post {
                if (viewRequests[view] !== request || view.tag != requestKey) return@post
                if (local != null) {
                    viewRequests.remove(view)
                    show(view, requestKey, local)
                } else {
                    loadRemote(view, urls, target, requestKey, request, 0)
                }
            }
        }
        request.local = task
        localPool.execute(task)
    }

    private fun loadRemote(view: ImageView, urls: List<String>, target: Target, requestKey: String, request: ViewRequest, index: Int) {
        request.release?.invoke()
        request.release = null
        if (index >= urls.size) {
            viewRequests.remove(view)
            return
        }
        // Completion callbacks do not occupy a coordinator thread while a server is slow.
        val lease = acquire(view.context.applicationContext, urls[index], Priority.VISIBLE, target) { result ->
            main.post {
                if (viewRequests[view] !== request || view.tag != requestKey) return@post
                if (result != null && !result.isRecycled) {
                    request.release?.invoke()
                    viewRequests.remove(view)
                    show(view, requestKey, result)
                } else loadRemote(view, urls, target, requestKey, request, index + 1)
            }
        }
        request.release = lease::close
    }

    class StorageFull : java.io.IOException("مساحة الجهاز غير كافية لحفظ المكتبة كاملة؛ وفر مساحة ثم استكمل الناقص")

    private fun pinnedFile(context: android.content.Context, url: String): File {
        val id = hash(url)
        return File(File(File(context.filesDir, "blofy_library_art"), id.take(2)), "$id.jpg")
    }

    fun isPersisted(context: android.content.Context, url: String): Boolean = synchronized(fileLock(url)) {
        pinnedFile(context.applicationContext, url).let { it.isFile && it.length() > 0L }
    }

    private fun readPinned(context: android.content.Context, url: String, target: Target): Bitmap? = synchronized(fileLock(url)) {
        // Older Android AtomicFile implementations write directly to the base file.
        // Readers must wait for finishWrite instead of decoding/deleting a partial image.
        val file = pinnedFile(context, url)
        if (!file.isFile || file.length() == 0L) return@synchronized null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) { file.delete(); return@synchronized null }
        BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply {
            inPreferredConfig = Bitmap.Config.RGB_565
            inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, target.width, target.height)
        }).also { if (it == null) file.delete() }
    }

    /** Await download AND an atomic durable write. Pinned library artwork is never LRU-evicted. */
    suspend fun persist(context: android.content.Context, rawUrl: String): Boolean = withContext(Dispatchers.IO) {
        val app = context.applicationContext
        val url = normalizeUrl(rawUrl) ?: return@withContext false
        val target = target(app)
        currentCoroutineContext().ensureActive()
        if (isPersisted(app, url)) return@withContext true
        if (app.filesDir.usableSpace < 64L * 1024L * 1024L) throw StorageFull()
        val bitmap = cache.get(cacheKey(url, target))?.takeUnless { it.isRecycled }
            ?: readDisk(app.cacheDir, url, target)
            ?: awaitDownload(app, url, target)
            ?: return@withContext false
        currentCoroutineContext().ensureActive()
        writePinned(app, url, target, bitmap)
        failedUntil.remove(cacheKey(url, target))
        isPersisted(app, url)
    }

    private fun fileLock(url: String) = fileLocks[(url.hashCode() and Int.MAX_VALUE) % fileLocks.size]

    private fun writePinned(context: android.content.Context, url: String, target: Target, bitmap: Bitmap, encoded: ByteArray? = null) {
        synchronized(fileLock(url)) {
            if (isPersisted(context, url)) return
            if (context.filesDir.usableSpace < 64L * 1024L * 1024L) throw StorageFull()
            val file = pinnedFile(context, url)
            check(file.parentFile?.isDirectory == true || file.parentFile?.mkdirs() == true) { "Unable to create artwork directory" }
            writeAtomic(file, target, bitmap, encoded)
        }
    }

    private fun writeAtomic(file: File, target: Target, bitmap: Bitmap, encoded: ByteArray? = null) {
        val atomic = AtomicFile(file)
        val output = atomic.startWrite()
        try {
            if (encoded != null) output.write(encoded)
            else check(bitmap.compress(if (bitmap.hasAlpha()) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG,
                jpegQuality(target), output)) { "Unable to encode artwork" }
            atomic.finishWrite(output)
        } catch (error: Throwable) {
            atomic.failWrite(output)
            throw error
        }
    }

    private fun retainLocally(context: android.content.Context, url: String, target: Target, bitmap: Bitmap) {
        // Promote older disposable-cache hits without making the visible image wait for a write.
        if (isPersisted(context, url)) return
        synchronized(pendingWrites) {
            // A fast scroll through legacy cache must not retain an unbounded bitmap queue.
            if (pendingWrites.size >= 12 || !pendingWrites.add(url)) return
        }
        storagePool.execute {
            try { saveDownloaded(context, url, target, bitmap) }
            finally { pendingWrites.remove(url) }
        }
    }

    private fun saveDownloaded(context: android.content.Context, url: String, target: Target, bitmap: Bitmap, encoded: ByteArray? = null) {
        // No space or write permission must not turn a successfully decoded image into a failure.
        if (runCatching { writePinned(context, url, target, bitmap, encoded) }.isFailure) {
            writeDisk(context.cacheDir, url, target, bitmap, encoded)
        }
    }

    fun cancel(view: ImageView) {
        view.animate().cancel()
        viewRequests.remove(view)?.let { request ->
            request.local?.cancel(true)
            request.release?.invoke()
        }
        view.tag = null
    }

    fun prefetch(context: android.content.Context, urls: List<String?>) {
        val app = context.applicationContext
        val target = target(app)
        urls.mapNotNull(::normalizeUrl).distinct().take(prefetchLimit(app)).forEach { url ->
            val key = cacheKey(url, target)
            if (cache.get(key) != null || isNegative(key)) return@forEach
            // Repeated bindings must not enqueue the same offscreen work indefinitely.
            synchronized(pendingPrefetch) {
                if (pendingPrefetch.size >= 48 || !pendingPrefetch.add(key)) return@forEach
            }
            backgroundPool.execute {
                try {
                    if (cache.get(key) != null) return@execute
                    val local = readPinned(app, url, target) ?: readDisk(app.cacheDir, url, target)
                    val bmp = local ?: awaitDownload(app, url, target)
                    if (bmp != null && !bmp.isRecycled) {
                        cache.put(key, bmp)
                        if (local != null) retainLocally(app, url, target, bmp)
                    }
                } finally { pendingPrefetch.remove(key) }
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

    private class Download(
        val context: android.content.Context,
        val url: String,
        val target: Target,
        var priority: Priority
    ) : Runnable {
        val key = cacheKey(url, target)
        val listeners = LinkedHashMap<Any, (Bitmap?) -> Unit>()
        var users = 0
        var started = false
        var published = false
        var result: Bitmap? = null
        @Volatile var call: Call? = null
        @Volatile var bodyComplete = false
        val future = object : FutureTask<Bitmap?>({ performDownload(this@Download) }) {
            override fun done() {
                publish(this@Download, getOrNull())
                synchronized(requestLock) {
                    if (inFlight[key] === this@Download) inFlight.remove(key)
                }
            }
        }
        override fun run() {
            synchronized(requestLock) { started = true }
            future.run()
        }
    }

    private class Lease(val download: Download, val token: Any) {
        private var closed = false
        fun close(): Unit = synchronized(requestLock) {
            if (closed) return@synchronized
            closed = true
            download.listeners.remove(token)
            download.users--
            if (download.users != 0 || download.published) return@synchronized
            if (!download.started) {
                networkPool.remove(download)
                backgroundNetworkPool.remove(download)
                download.future.cancel(false)
            } else {
                // Brief detach/attach cycles and another consumer can retain the same call.
                cancellationPool.schedule({
                    synchronized(requestLock) {
                        if (download.users == 0 && !download.published && !download.bodyComplete) {
                            download.call?.cancel()
                            download.future.cancel(true)
                        }
                    }
                }, 150, TimeUnit.MILLISECONDS)
            }
            Unit
        }
    }

    private fun acquire(
        context: android.content.Context, url: String, priority: Priority, target: Target,
        listener: ((Bitmap?) -> Unit)? = null
    ): Lease = synchronized(requestLock) {
        val key = cacheKey(url, target)
        var download = inFlight[key]
        val fresh = download == null
        if (download == null) {
            download = Download(context, url, target, priority)
            inFlight[key] = download
        }
        val lease = Lease(download, Any())
        download.users++
        if (listener != null) {
            if (download.published) listener(download.result)
            else download.listeners[lease.token] = listener
        }
        if (fresh) {
            (if (priority == Priority.VISIBLE) networkPool else backgroundNetworkPool).execute(download)
        } else if (priority == Priority.VISIBLE && download.priority == Priority.PREFETCH &&
            backgroundNetworkPool.remove(download)) {
            // A queued library image that becomes visible must bypass the library backlog.
            download.priority = Priority.VISIBLE
            networkPool.execute(download)
        }
        lease
    }

    private fun publish(download: Download, bitmap: Bitmap?) {
        val callbacks = synchronized(requestLock) {
            if (download.published) return
            download.published = true
            download.result = bitmap
            download.listeners.values.toList().also { download.listeners.clear() }
        }
        callbacks.forEach { it(bitmap) }
    }

    private fun awaitDownload(context: android.content.Context, url: String, target: Target): Bitmap? {
        val lease = acquire(context, url, Priority.PREFETCH, target)
        return try { lease.download.future.getOrNull() } finally { lease.close() }
    }

    private fun performDownload(download: Download): Bitmap? {
        val (context, url, target) = Triple(download.context, download.url, download.target)
        val key = download.key
        if (isNegative(key) || download.future.isCancelled) return null
        var encoded: ByteArray? = null
        val bitmap = cache.get(key)?.takeUnless { it.isRecycled }
            ?: readPinned(context, url, target)
            ?: readDisk(context.cacheDir, url, target)
            ?: runCatching { execute(download) }.getOrNull()?.let {
                encoded = it.encoded
                it.bitmap
            }
            ?: return null
        cache.put(key, bitmap)
        failedUntil.remove(key)
        // Deliver to views now. Background persist still awaits the atomic durable write.
        publish(download, bitmap)
        saveDownloaded(context, url, target, bitmap, encoded)
        return bitmap
    }

    private fun execute(download: Download): Downloaded? {
        val request = Request.Builder().url(download.url)
            .header("User-Agent", "Mozilla/5.0 (Linux; Android TV) BLOFY-PLAYER/2.0")
            .header("Accept", "image/webp,image/jpeg,image/png,image/gif;q=0.8")
            .build()
        val call = client.newCall(request)
        download.call = call
        if (download.future.isCancelled) { call.cancel(); return null }
        // OkHttp already retries recoverable connection failures. Do not repeat 404s,
        // unsupported images, or ten-second timeouts before trying a valid fallback.
        call.execute().use { response ->
            if (!response.isSuccessful) {
                if (response.code in setOf(400, 401, 403, 404, 410)) {
                    failedUntil.put(download.key, System.currentTimeMillis() + NEGATIVE_CACHE_MS)
                }
                // Offline/timeout/5xx failures must not hide a recovered image for five minutes.
                return null
            }
            val body = response.body ?: return null
            val declared = body.contentLength()
            if (declared > MAX_IMAGE_BYTES) return null
            val bytes = body.byteStream().use { input ->
                val out = java.io.ByteArrayOutputStream(if (declared in 1..MAX_IMAGE_BYTES.toLong()) declared.toInt() else 64 * 1024)
                val buffer = ByteArray(32 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    if (out.size() + read > MAX_IMAGE_BYTES) return null
                    out.write(buffer, 0, read)
                }
                out.toByteArray()
            }
            download.bodyComplete = true
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply {
                inPreferredConfig = Bitmap.Config.RGB_565
                inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, download.target.width, download.target.height)
            }) ?: return null
            return Downloaded(bitmap, bytes)
        }
    }

    private fun readDisk(cacheDir: File, url: String, target: Target): Bitmap? = synchronized(fileLock(url)) {
        // Reuse existing artwork after an image-quality change or an upgrade from the old cache.
        val dir = File(cacheDir, "blofy_posters")
        val candidates = listOf(diskFile(cacheDir, url, target)) +
            listOf(640, 420, 280).filter { it != target.diskBucket }
                .map { File(dir, hash("$url@$it") + ".jpg") } + File(dir, hash(url) + ".jpg")
        for (file in candidates) {
            if (!file.isFile || file.length() <= 0L) continue
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.absolutePath, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) { file.delete(); continue }
            val bmp = BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply {
                inPreferredConfig = Bitmap.Config.RGB_565
                inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, target.width, target.height)
            })
            if (bmp == null) file.delete() else {
                file.setLastModified(System.currentTimeMillis())
                return@synchronized bmp
            }
        }
        null
    }

    private fun writeDisk(cacheDir: File, url: String, target: Target, bitmap: Bitmap, encoded: ByteArray? = null) {
        if (bitmap.isRecycled) return
        val dir = File(cacheDir, "blofy_posters").apply { mkdirs() }
        val file = diskFile(cacheDir, url, target)
        synchronized(fileLock(url)) {
            if (!file.isFile || file.length() <= 0L) runCatching { writeAtomic(file, target, bitmap, encoded) }
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

    private fun isNegative(key: String): Boolean = synchronized(failedUntil) {
        val until = failedUntil.get(key) ?: return@synchronized false
        if (until <= System.currentTimeMillis()) {
            failedUntil.remove(key)
            return@synchronized false
        }
        true
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

    private fun <T> FutureTask<T>.getOrNull(): T? = try { get() }
    catch (_: InterruptedException) { Thread.currentThread().interrupt(); null }
    catch (_: java.util.concurrent.ExecutionException) { null }
    catch (_: java.util.concurrent.CancellationException) { null }
}
