package tv.blofy.player.ui.catalog

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import android.widget.ImageView
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Resilient artwork loader for large TV catalogs: memory + disk cache + multi-source fallback. */
object ArtworkLoader {
    private const val MAX_IMAGE_BYTES = 8 * 1024 * 1024
    private const val MAX_DISK_BYTES = 260L * 1024L * 1024L
    private val main = Handler(Looper.getMainLooper())
    private val pool = Executors.newFixedThreadPool(8)
    private val placeholder = ColorDrawable(Color.rgb(24, 16, 34))
    private val client = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(9, TimeUnit.SECONDS)
        .callTimeout(13, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()
    private val cache = object : LruCache<String, Bitmap>(42 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = (value.byteCount / 1024).coerceAtLeast(1)
    }

    fun load(view: ImageView, rawUrl: String?) = load(view, listOf(rawUrl))

    fun load(view: ImageView, candidates: List<String?>) {
        val urls = candidates.mapNotNull(::normalizeUrl).distinct()
        val requestKey = urls.joinToString("|")
        view.tag = requestKey
        view.setImageDrawable(placeholder)
        if (urls.isEmpty()) return

        urls.firstNotNullOfOrNull { cache.get(it)?.takeIf { bmp -> !bmp.isRecycled } }?.let {
            view.setImageBitmap(it)
            return
        }
        val app = view.context.applicationContext
        pool.execute {
            var result: Bitmap? = null
            for (url in urls) {
                result = cache.get(url)?.takeIf { !it.isRecycled }
                    ?: readDisk(app.cacheDir, url)
                    ?: downloadWithRetry(url)?.also { bmp ->
                        cache.put(url, bmp)
                        writeDisk(app.cacheDir, url, bmp)
                    }
                if (result != null) break
            }
            main.post {
                if (view.tag == requestKey) {
                    if (result != null && !result!!.isRecycled) view.setImageBitmap(result)
                    else view.setImageDrawable(placeholder)
                }
            }
        }
    }

    fun prefetch(context: android.content.Context, urls: List<String?>) {
        urls.mapNotNull(::normalizeUrl).distinct().take(24).forEach { url ->
            if (cache.get(url) != null) return@forEach
            val app = context.applicationContext
            pool.execute {
                val bmp = readDisk(app.cacheDir, url) ?: downloadWithRetry(url)?.also { writeDisk(app.cacheDir, url, it) }
                if (bmp != null) cache.put(url, bmp)
            }
        }
    }

    private fun downloadWithRetry(url: String): Bitmap? {
        repeat(2) { attempt ->
            runCatching { download(url) }.getOrNull()?.let { return it }
            if (attempt == 0) runCatching { Thread.sleep(120L) }
        }
        return null
    }

    private fun download(url: String): Bitmap? {
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
                val out = java.io.ByteArrayOutputStream()
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
        val bmp = BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.RGB_565 })
        if (bmp == null) file.delete() else file.setLastModified(System.currentTimeMillis())
        return bmp
    }

    private fun writeDisk(cacheDir: File, url: String, bitmap: Bitmap) {
        val dir = File(cacheDir, "blofy_posters").apply { mkdirs() }
        val file = File(dir, hash(url) + ".jpg")
        runCatching { file.outputStream().buffered().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }; trimDisk(dir) }
    }

    private fun trimDisk(dir: File) {
        val files = dir.listFiles()?.filter { it.isFile } ?: return
        var total = files.sumOf { it.length() }
        files.sortedBy { it.lastModified() }.forEach { file ->
            if (total <= MAX_DISK_BYTES) return
            total -= file.length(); file.delete()
        }
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
