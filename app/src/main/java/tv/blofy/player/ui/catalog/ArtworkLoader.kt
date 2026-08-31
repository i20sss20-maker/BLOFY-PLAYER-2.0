package tv.blofy.player.ui.catalog

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import android.widget.ImageView
import okhttp3.OkHttpClient
import okhttp3.Request
import java.lang.ref.WeakReference
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Lightweight in-memory artwork loader shared by TV poster grids and detail pages. */
object ArtworkLoader {
    private const val MAX_IMAGE_BYTES = 6 * 1024 * 1024
    private val main = Handler(Looper.getMainLooper())
    private val pool = Executors.newFixedThreadPool(4) { runnable ->
        Thread(runnable, "blofy-artwork").apply { priority = Thread.NORM_PRIORITY - 1 }
    }
    private val client = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .callTimeout(12, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()
    private val cache = object : LruCache<String, Bitmap>(20 * 1024) {
        override fun sizeOf(key: String, value: Bitmap): Int = (value.byteCount / 1024).coerceAtLeast(1)
    }

    fun load(view: ImageView, rawUrl: String?) {
        val url = rawUrl?.trim().orEmpty()
        view.tag = url
        if (!isHttpUrl(url)) {
            view.setImageDrawable(null)
            return
        }
        cache.get(url)?.takeIf { !it.isRecycled }?.let {
            view.setImageBitmap(it)
            return
        }
        view.setImageDrawable(null)
        val target = WeakReference(view)
        pool.execute {
            val bitmap = runCatching { download(url) }.getOrNull() ?: return@execute
            cache.put(url, bitmap)
            main.post {
                val image = target.get() ?: return@post
                if (image.tag == url) image.setImageBitmap(bitmap)
            }
        }
    }

    private fun download(url: String): Bitmap? {
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", "BLOFY PLAYER/2.0")
            .header("Accept", "image/avif,image/webp,image/*,*/*;q=0.5")
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return null
            val body = response.body ?: return null
            val declared = body.contentLength()
            if (declared > MAX_IMAGE_BYTES) return null
            val bytes = body.byteStream().use { input ->
                val output = java.io.ByteArrayOutputStream(if (declared in 1..MAX_IMAGE_BYTES) declared.toInt() else 32 * 1024)
                val buffer = ByteArray(16 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    output.write(buffer, 0, read)
                    if (output.size() > MAX_IMAGE_BYTES) return null
                }
                output.toByteArray()
            }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            val sample = sampleSize(bounds.outWidth, bounds.outHeight, 360, 520)
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply {
                inPreferredConfig = Bitmap.Config.RGB_565
                inSampleSize = sample
            })
        }
    }

    private fun sampleSize(width: Int, height: Int, targetWidth: Int, targetHeight: Int): Int {
        if (width <= 0 || height <= 0) return 1
        var sample = 1
        while (width / (sample * 2) >= targetWidth && height / (sample * 2) >= targetHeight) sample *= 2
        return sample
    }

    private fun isHttpUrl(value: String): Boolean = runCatching {
        val uri = java.net.URI(value)
        (uri.scheme.equals("https", true) || uri.scheme.equals("http", true)) && !uri.host.isNullOrBlank()
    }.getOrDefault(false)
}
