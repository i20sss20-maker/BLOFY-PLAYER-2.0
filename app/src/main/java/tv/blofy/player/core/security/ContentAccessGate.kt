package tv.blofy.player.core.security

import android.app.AlertDialog
import android.content.Intent
import android.os.SystemClock
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.core.profile.KidsPolicy
import tv.blofy.player.core.profile.ProfileStore
import tv.blofy.player.data.SeriesEpisodeParser
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.StreamEntity
import java.util.UUID

/** One gate for cached content identities, before details, episode lists or playback start. */
class ContentAccessGate(private val activity: AppCompatActivity) {
    private data class Grant(val key: String, val providerId: String, val profileId: String, val credential: String?)
    private data class Transfer(val grant: Grant, val expiresAt: Long)
    private var grant: Grant? = null
    private var pending: Job? = null
    private var dialog: AlertDialog? = null
    private var generation = 0

    init {
        activity.lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onDestroy(owner: LifecycleOwner) { cancel() }
        })
    }

    fun cancel() {
        generation++
        pending?.cancel()
        pending = null
        dialog?.dismiss()
        dialog = null
    }

    fun requireAccess(
        providerId: String,
        contentKey: String,
        seriesId: String = "",
        transferToken: String? = null,
        onDenied: () -> Unit = {},
        onGranted: () -> Unit
    ) {
        cancel()
        val request = generation
        val profile = ProfileStore.active(activity)
        val inherited = transferToken?.let { transfers.remove(it) }
            ?.takeIf { it.expiresAt >= SystemClock.elapsedRealtime() }?.grant
        // Preserve the existing synchronous path when parental protection is not configured.
        if (!profile.kids && !ParentalGate.hasPin(activity)) { onGranted(); return }
        pending = activity.lifecycleScope.launch {
            val stream = try {
                withContext(Dispatchers.IO) {
                    resolve(BlofyDatabase.get(activity).dao(), providerId, contentKey, seriesId)
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) { null }
            fun current() = generation == request && !activity.isFinishing && !activity.isDestroyed &&
                ProfileStore.active(activity).id == profile.id && ProfileStore.isKids(activity) == profile.kids
            if (!current()) { if (generation == request) onDenied(); return@launch }
            if (stream == null || (profile.kids && (stream.locked ||
                    KidsPolicy.isBlocked(stream.name, stream.genre, stream.plot)))) {
                Toast.makeText(activity, if (stream == null) "تعذر التحقق من حماية المحتوى" else
                    "هذا المحتوى غير متاح في وضع الأطفال", Toast.LENGTH_SHORT).show()
                onDenied()
                return@launch
            }
            if (!stream.locked) { grant = null; onGranted(); return@launch }
            val expected = Grant(stream.key, providerId, profile.id, ParentalGate.credentialVersion(activity))
            if (expected == grant || expected == inherited) {
                grant = expected
                onGranted()
                return@launch
            }
            dialog = ParentalGate.requestPin(activity, onGranted = {
                if (current()) {
                    // Verification can migrate a legacy PIN hash; bind to the resulting credential.
                    grant = expected.copy(credential = ParentalGate.credentialVersion(activity))
                    onGranted()
                } else if (generation == request) onDenied()
            }, onDenied = { if (generation == request) onDenied() })
        }
    }

    /** Process-local, single-use handoff. Never an unrestricted boolean or a persisted unlock. */
    fun forwardTo(intent: Intent) {
        val existing = grant ?: return
        if (intent.component?.packageName != activity.packageName) return
        if (existing.profileId != ProfileStore.active(activity).id || ProfileStore.isKids(activity) ||
            existing.credential != ParentalGate.credentialVersion(activity)) return
        val now = SystemClock.elapsedRealtime()
        transfers.entries.removeAll { it.value.expiresAt < now }
        while (transfers.size >= 64) transfers.remove(transfers.keys.first())
        val token = UUID.randomUUID().toString()
        transfers[token] = Transfer(existing, now + 60_000L)
        intent.putExtra(EXTRA_TRANSFER, token)
    }

    companion object {
        internal const val EXTRA_TRANSFER = "blofy_content_access_transfer"
        // Accessed only from the main thread; lost on process death and never stored on disk.
        private val transfers = LinkedHashMap<String, Transfer>()

        internal suspend fun resolve(dao: BlofyDao, providerId: String, contentKey: String, seriesId: String = ""): StreamEntity? {
            if (providerId.isBlank()) return null
            if (contentKey.isNotBlank()) {
                dao.stream(contentKey)?.let { return it.takeIf { row -> row.providerId == providerId } }
                dao.episode(contentKey)?.let { episode ->
                    return if (episode.providerId == providerId) parent(dao, providerId, episode.seriesId) else null
                }
                val catchup = contentKey.lastIndexOf(":catchup:")
                if (catchup > 0 && contentKey.substring(catchup + 9).toLongOrNull() != null) {
                    return dao.stream(contentKey.substring(0, catchup))
                        ?.takeIf { it.providerId == providerId && it.kind == "live" }
                }
                return null
            }
            return if (seriesId.isNotBlank()) parent(dao, providerId, seriesId) else null
        }

        private suspend fun parent(dao: BlofyDao, providerId: String, rawId: String): StreamEntity? {
            val normalized = SeriesEpisodeParser.normalizeSeriesIdForRequest(rawId)
            return dao.streamByIdentity(providerId, "series", rawId)
                ?: (if (normalized != rawId) dao.streamByIdentity(providerId, "series", normalized) else null)
                ?: (if (normalized.matches(Regex("[+-]?\\d+"))) dao.seriesWithLegacyDecimalId(providerId, normalized) else null)
        }
    }
}
