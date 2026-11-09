package tv.blofy.player.core.device

import android.content.Context
import android.os.Build

/**
 * Hardware-aware BLOFY STREAM policy. Never branch on model names: cheap Android TV
 * boxes frequently misreport their brands and can have very small process heaps.
 *
 * Android 7–16 uses the same secure app/session APIs; this class only bounds memory
 * and connection work. It never relaxes HTTPS, entitlement, DRM, or codec support.
 */
object StreamDeviceCompatibility {
    data class Profile(
        val sdk: Int,
        val television: Boolean,
        val lowMemory: Boolean,
        val legacyAndroid: Boolean,
        val maxCatalogRequestsPerHost: Int,
        val playerMinBufferMs: Int,
        val playerMaxBufferMs: Int,
        val playerTargetBufferBytes: Int,
        val connectTimeoutSeconds: Long,
        val readTimeoutSeconds: Long
    ) {
        val engine: String = "Media3"
        val decoderFallback: Boolean = true
    }

    fun current(context: Context): Profile = classify(
        sdk = Build.VERSION.SDK_INT,
        television = DeviceClass.isTv(context),
        lowMemory = DeviceClass.isLowMemory(context)
    )

    /** Kept pure to test old/new SDK and low-RAM combinations without a device. */
    fun classify(sdk: Int, television: Boolean, lowMemory: Boolean): Profile {
        val constrained = lowMemory || (television && sdk <= Build.VERSION_CODES.P)
        return Profile(
            sdk = sdk,
            television = television,
            lowMemory = constrained,
            legacyAndroid = sdk <= Build.VERSION_CODES.P,
            maxCatalogRequestsPerHost = if (constrained) 2 else if (television) 4 else 6,
            playerMinBufferMs = if (constrained) 8_000 else 15_000,
            playerMaxBufferMs = if (constrained) 28_000 else 50_000,
            playerTargetBufferBytes = if (constrained) 16 * 1024 * 1024 else 32 * 1024 * 1024,
            connectTimeoutSeconds = if (sdk <= Build.VERSION_CODES.P) 15L else 12L,
            readTimeoutSeconds = if (constrained) 45L else 35L
        )
    }
}
