package tv.blofy.player.core.update

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import java.io.File
import java.security.MessageDigest

object UpdatePackageVerifier {
    internal fun compatible(
        packageName: String, installedPackage: String, version: Long, installedVersion: Long,
        expectedVersion: Int, certificates: Set<String>, installedCertificates: Set<String>
    ): Boolean = packageName == installedPackage && version == expectedVersion.toLong() &&
        version > installedVersion && certificates.isNotEmpty() && certificates == installedCertificates

    @Suppress("DEPRECATION")
    fun verify(context: Context, file: File, expectedVersion: Int): Boolean = runCatching {
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val installed = context.packageManager.getPackageInfo(context.packageName, flags)
        val candidate = context.packageManager.getPackageArchiveInfo(file.absolutePath, flags) ?: return false
        compatible(candidate.packageName, installed.packageName, version(candidate), version(installed),
            expectedVersion, certificates(candidate), certificates(installed))
    }.getOrDefault(false)

    @Suppress("DEPRECATION")
    private fun version(info: PackageInfo): Long = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()

    @Suppress("DEPRECATION")
    private fun certificates(info: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
        return signatures.orEmpty().map { signature ->
            MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()).joinToString("") { "%02x".format(it) }
        }.toSet()
    }
}
