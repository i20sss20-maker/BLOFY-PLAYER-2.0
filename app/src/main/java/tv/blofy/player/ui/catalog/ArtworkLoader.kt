package tv.blofy.player.ui.catalog

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import android.widget.ImageView
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.lang.ref.WeakReference
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Fast artwork loader for large TV catalogs: memory + disk cache with request deduplication. */
object ArtworkLoader {
    private const val MAX_IMAGE_BYTES = 6 * 1024 * 1024
    private const val MAX_DISK_BYTES = 180L * 1024L * 1024L
    private const val TRIM_EVERY_WRITES = 32
    private val main = Handler(Looper.getMainLooper())
    private val pool = Executors.newFixedThreadPool(6) { runnable ->
        Thread(runnable, "blofy-artwork").apply { priority = Thread.NORM_PRIORITY - 1 }
    }
    private val client = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(7, TimeUnit.SECONDS)
        .callTimeout(10, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()
    private val cache = object : LruCache<String, Bitmap>(28 * 1024) {
        override fun sizeOf(key: String, value: Bitmap): Int = (value.byteCount / 1024).coerceAtLeast(1)
    }
    private val waiting = ConcurrentHashMap<String, CopyOnWriteArrayList<WeakReference<ImageView>>>()
    private val writesSinceTrim = AtomicInteger(0)

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
        val created = CopyOnWriteArrayList<WeakReference<ImageView>>()
        val existing = waiting.putIfAbsent(url, created)
        val listeners = existing ?: created
        listeners += WeakReference(view)
        if (existing != null) return

        val appContext = view.context.applicationContext
        pool.execute {
            val bitmap = runCatching {
                readDisk(appContext.cacheDir, url) ?: download(url)?.also { writeDisk(appContext.cacheDir, url, it) }
            }.getOrNull()
            if (bitmap != null) cache.put(url, bitmap)
            val targets = waiting.remove(url).orEmpty()
            if (bitmap != null) {
                main.post {
                    targets.forEach { ref ->
                        val image = ref.get() ?: return@forEach
                        if (image.tag == url) image.setImageBitmap(bitmap)
                    }
                }
            }
        }
    }

    /** Warm the next visible posters without binding them to views. */
    fun prefetch(context: android.content.Context, urls: List<String?>) {
        urls.asSequence().mapNotNull { it?.trim() }.filter(::isHttpUrl).distinct().take(12).forEach { url ->
            if (cache.get(url) != null || waiting.containsKey(url)) return@forEach
            val created = CopyOnWriteArrayList<WeakReference<ImageView>>()
            if (waiting.putIfAbsent(url, created) != null) return@forEach
            val appContext = context.applicationContext
            pool.execute {
                val bitmap = runCatching {
                    readDisk(appContext.cacheDir, url) ?: download(url)?.also { writeDisk(appContext.cacheDir, url, it) }
                }.getOrNull()
                if (bitmap != null) cache.put(url, bitmap)
                waiting.remove(url)
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
                val buffer = ByteArray(24 * 1024)
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
            val sample = sampleSize(bounds.outWidth, bounds.outHeight, 300, 450)
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply {
                inPreferredConfig = Bitmap.Config.RGB_565
                inSampleSize = sample
            })
        }
    }

    private fun readDisk(cacheDir: File, url: String): Bitmap? {
        val file = diskFile(cacheDir, url)
        if (!file.isFile || file.length() <= 0L) return null
        file.setLastModified(System.currentTimeMillis())
        return BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply {
            inPreferredConfig = Bitmap.Config.RGB_565
        })
    }

    private fun writeDisk(cacheDir: File, url: String, bitmap: Bitmap) {
        val dir = File(cacheDir, "blofy_posters").apply { mkdirs() }
        val target = File(dir, hash(url) + ".jpg")
        val temp = File(dir, target.name + ".tmp")
        runCatching {
            temp.outputStream().buffered().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 88, it) }
            if (!temp.renameTo(target)) {
                temp.copyTo(target, overwrite = true)
                temp.delete()
            }
            if (writesSinceTrim.incrementAndGet() >= TRIM_EVERY_WRITES && writesSinceTrim.getAndSet(0) >= TRIM_EVERY_WRITES) {
                trimDisk(dir)
            }
        }
    }

    private fun trimDisk(dir: File) {
        val files = dir.listFiles()?.filter { it.isFile && !it.name.endsWith(".tmp") } ?: return
        var total = files.sumOf { it.length() }
        if (total <= MAX_DISK_BYTES) return
        files.sortedBy { it.lastModified() }.forEach { file ->
            if (total <= MAX_DISK_BYTES) return
            total -= file.length()
            file.delete()
        }
    }

    private fun diskFile(cacheDir: File, url: String) = File(File(cacheDir, "blofy_posters"), hash(url) + ".jpg")
    private fun hash(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

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
