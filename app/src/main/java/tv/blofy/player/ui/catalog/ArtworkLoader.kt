package tv.blofy.player.ui.catalog

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import android.widget.ImageView
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.Collections
import java.util.WeakHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Fast artwork loader for TV catalogs: visible images are prioritised, disk persistence is off the render path. */
object ArtworkLoader {
    private const val MAX_IMAGE_BYTES = 8 * 1024 * 1024
    private const val MAX_DISK_BYTES = 260L * 1024L * 1024L
    private val main = Handler(Looper.getMainLooper())
    private val visiblePool = Executors.newFixedThreadPool(10)
    private val backgroundPool = Executors.newFixedThreadPool(2)
    private val trimCounter = AtomicInteger(0)
    private val activeCalls = Collections.synchronizedMap(WeakHashMap<ImageView, Call>())
    private val client = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(7, TimeUnit.SECONDS)
        .callTimeout(10, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()
    private val cache = object : LruCache<String, Bitmap>(56 * 1024) {
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
        visiblePool.execute {
            var result: Bitmap? = null
            var downloadedUrl: String? = null
            for (url in urls) {
                if (view.tag != requestKey) return@execute
                result = cache.get(url)?.takeIf { !it.isRecycled }
                    ?: readDisk(app.cacheDir, url)?.also { cache.put(url, it) }
                    ?: download(view, requestKey, url)?.also {
                        cache.put(url, it)
                        downloadedUrl = url
                    }
                if (result != null) break
            }

            val bitmap = result
            main.post {
                if (view.tag == requestKey) {
                    if (bitmap != null && !bitmap.isRecycled) view.setImageBitmap(bitmap)
                    else view.setImageDrawable(skeleton())
                }
                activeCalls.remove(view)
            }

            if (bitmap != null && downloadedUrl != null) {
                val url = downloadedUrl!!
                backgroundPool.execute { writeDisk(app.cacheDir, url, bitmap) }
            }
        }
    }

    fun cancel(view: ImageView) {
        activeCalls.remove(view)?.cancel()
        view.tag = null
    }

    fun prefetch(context: android.content.Context, urls: List<String?>) {
        val app = context.applicationContext
        urls.mapNotNull(::normalizeUrl).distinct().take(18).forEach { url ->
            if (cache.get(url) != null || diskFile(app.cacheDir, url).isFile) return@forEach
            backgroundPool.execute {
                val bmp = downloadBackground(url) ?: return@execute
                cache.put(url, bmp)
                writeDisk(app.cacheDir, url, bmp)
            }
        }
    }

    private fun download(view: ImageView, requestKey: String, url: String): Bitmap? {
        repeat(2) {
            if (view.tag != requestKey) return null
            runCatching { downloadCall(view, requestKey, url) }.getOrNull()?.let { return it }
        }
        return null
    }

    private fun downloadBackground(url: String): Bitmap? {
        repeat(2) { runCatching { execute(client.newCall(request(url))) }.getOrNull()?.let { return it } }
        return null
    }

    private fun downloadCall(view: ImageView, requestKey: String, url: String): Bitmap? {
        if (view.tag != requestKey) return null
        val call = client.newCall(request(url))
        activeCalls[view]?.cancel()
        activeCalls[view] = call
        return execute(call)
    }

    private fun request(url: String) = Request.Builder().url(url)
        .header("User-Agent", "Mozilla/5.0 (Linux; Android TV) BLOFY-PLAYER/2.0")
        .header("Accept", "image/avif,image/webp,image/*,*/*;q=0.8")
        .build()

    private fun execute(call: Call): Bitmap? {
        call.execute().use { response ->
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

    private fun skeleton() = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(0xFF21182D.toInt(), 0xFF30203F.toInt(), 0xFF17111F.toInt())).apply {
        cornerRadius = 18f
    }

    private fun diskFile(cacheDir: File, url: String) = File(File(cacheDir, "blofy_posters"), hash(url) + ".jpg")
    private fun hash(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
    private fun sampleSize(w: Int, h: Int, tw: Int, th: Int): Int { var s = 1; while (w / (s * 2) >= tw && h / (s * 2) >= th) s *= 2; return s }
    private fun normalizeUrl(raw: String?): String? {
        val value = raw?.trim()?.takeIf { it.isNotBlank() && !it.equals("null", true) } ?: return null
        return runCatching { java.net.URI(value) }.getOrNull()?.takeIf {
            (it.scheme.equals("https", true) || it.scheme.equals("http", true)) && !it.host.isNullOrBlank()
        }?.let { value }
    }
}
