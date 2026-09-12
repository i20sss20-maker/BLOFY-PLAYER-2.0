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
        if (!file.isFile || !file.name.endsWith(".apk", ignoreCase = true)) return false
        val pm = context.packageManager
        val modernFlags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val installed = pm.getPackageInfo(context.packageName, modernFlags)
        val candidate = pm.getPackageArchiveInfo(file.absolutePath, modernFlags)
            ?: pm.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_SIGNATURES)
            ?: return false

        var candidateCertificates = certificates(candidate)
        var installedCertificates = certificates(installed)

        // Some Android TV/OEM PackageManager builds parse the APK but leave signingInfo empty for
        // archive files. Fall back to the legacy signatures field before declaring the update bad.
        if (Build.VERSION.SDK_INT >= 28 && (candidateCertificates.isEmpty() || installedCertificates.isEmpty())) {
            candidateCertificates = pm.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_SIGNATURES)
                ?.let(::legacyCertificates)
                .orEmpty()
            installedCertificates = runCatching {
                legacyCertificates(pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES))
            }.getOrDefault(emptySet())
        }

        compatible(
            candidate.packageName,
            installed.packageName,
            version(candidate),
            version(installed),
            expectedVersion,
            candidateCertificates,
            installedCertificates
        )
    }.getOrDefault(false)

    @Suppress("DEPRECATION")
    private fun version(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()

    @Suppress("DEPRECATION")
    private fun certificates(info: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
        return digest(signatures.orEmpty().map { it.toByteArray() })
    }

    @Suppress("DEPRECATION")
    private fun legacyCertificates(info: PackageInfo): Set<String> =
        digest(info.signatures.orEmpty().map { it.toByteArray() })

    private fun digest(certificates: List<ByteArray>): Set<String> =
        certificates.map { bytes ->
            MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        }.toSet()
}
