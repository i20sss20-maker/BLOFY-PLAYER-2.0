package tv.blofy.player.data

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.security.MessageDigest
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.identity.StreamCodeSession
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.remote.XtreamClient
import java.util.concurrent.TimeUnit

/**
 * STREAM 56: a small, resumable, incremental catalog reader. Server-side
 * Xtream ingestion is authoritative. The app never contacts source secrets,
 * re-redeems codes, copies videos or executes the old 95% Room promotion.
 *
 * Each page commits <=120 rows. On interrupted runs, resume the exact revision,
 * kind and cursor. Revision changes invalidate the cursor, never saved content.
 */
internal class StreamCatalogDeltaWorker(
    context: Context, parameters: WorkerParameters
) : CoroutineWorker(context, parameters) {
    private val app = applicationContext
    private val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val providerId get() = StreamCodeSession.providerId

    override suspend fun doWork(): Result {
        val automatic = inputData.getBoolean(KEY_AUTO, true)
        if (!BuildConfig.CODE_ONLY_LOGIN) return Result.success()
        if (!StreamCodeSession.isClaimed(app) ||
            !CatalogSyncState.isReady(app, providerId)
        ) return if (automatic) Result.success() else notReady()
        if (CatalogPlaybackGate.isPlaying)
            return recoverableFailure("playback_busy")
        return try {
            withTimeout(6 * 60_000L) { syncMutex.withLock { syncBounded() } }
        } catch (_: TimeoutCancellationException) {
            recoverableFailure("timeout")
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // Detailed network/server faults are kept away from the customer.
            recoverableFailure("unavailable")
        }
    }

    private suspend fun syncBounded(): Result {
        // Code-bound authorization must remain identical through every
        // resumed page. Never import one subscriber's rows into another code.
        val sessionAtStart = StreamCodeSession.token(app) ?: return notReady()
        // A new redemption may refer to a different account/source even though
        // STREAM reuses the same local provider ID. A revision number is not an
        // account identity. Never reuse a previous subscriber's delta cursor.
        val accountFingerprint = MessageDigest.getInstance("SHA-256")
            .digest(sessionAtStart.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
        if (prefs.getString(KEY_ACCOUNT_FINGERPRINT, null) != accountFingerprint) {
            check(prefs.edit().clear()
                .putString(KEY_ACCOUNT_FINGERPRINT, accountFingerprint).commit())
        }
        val dao = BlofyDatabase.get(app).dao()
        val provider = dao.provider(providerId) ?: return notReady()
        if (dao.activeProviderId() != providerId || !dao.hasCatalog(providerId))
            return notReady()
        val version = XtreamClient.api.objectResponse(
            "${StreamCodeSession.HOST}/player_api.php?action=get_blofy_catalog_version"
        )
        val current = version["revision"].asNumber()?.toLong() ?: return recoverableFailure()
        if (version["ok"] != true || current <= 0L)
            return recoverableFailure("source_not_ready")
        if (version["syncStatus"] != "online")
            return recoverableFailure("source_syncing")
        val storedBase = prefs.getLong(KEY_COMPLETE_REVISION, 0L)
        val base = if (storedBase in 0L..current) storedBase else 0L
        val priorPending = prefs.getLong(KEY_PENDING_REVISION, -1L)
        val priorBase = prefs.getLong(KEY_PENDING_BASE, -1L)
        if (current == base) {
            // A successful no-change poll is still useful diagnostic information.
            if (!prefs.edit().putLong(KEY_LAST_CHECK, System.currentTimeMillis()).commit())
                return recoverableFailure()
            clearCheckpoint()
            return Result.success(workDataOf(KEY_STATUS to "up_to_date"))
        }
        if (priorPending != current || priorBase != base) {
            check(prefs.edit().putLong(KEY_PENDING_REVISION, current)
                .putLong(KEY_PENDING_BASE, base)
                .putInt(KEY_PART_INDEX, 0).putLong(KEY_CURSOR, 0L)
                .putLong(KEY_APPLIED_COUNT, 0L).commit())
        }
        val stages = listOf(
            "live" to "categories", "live" to "items", "live" to "removed",
            "movie" to "categories", "movie" to "items", "movie" to "removed",
            "series" to "categories", "series" to "items", "series" to "removed"
        )
        var completedItems = prefs.getLong(KEY_APPLIED_COUNT, 0L)
        val fromPart = prefs.getInt(KEY_PART_INDEX, 0).coerceIn(0, stages.size)
        for (position in fromPart until stages.size) {
            if (CatalogPlaybackGate.isPlaying) return recoverableFailure("playback_busy")
            val (kind, part) = stages[position]
            var cursor = if (position == fromPart) prefs.getLong(KEY_CURSOR, 0L) else 0L
            do {
                if (CatalogPlaybackGate.isPlaying) return recoverableFailure("playback_busy")
                if (!StreamCodeSession.isClaimed(app) ||
                    StreamCodeSession.token(app) != sessionAtStart ||
                    dao.activeProviderId() != providerId ||
                    !CatalogSyncState.isReady(app,providerId)) return Result.failure()
                val url = "${StreamCodeSession.HOST}/player_api.php?action=get_blofy_catalog_delta" +
                    "&kind=$kind&part=$part&since=$base&revision=$current&after=$cursor"
                val page = XtreamClient.api.objectResponse(url)
                if (page["ok"] != true || page["kind"] != kind ||
                    page["part"] != part || page["revision"].asNumber()?.toLong() != current
                ) return recoverableFailure()
                if (StreamCodeSession.token(app) != sessionAtStart ||
                    dao.activeProviderId() != providerId) return Result.failure()
                val items = page["items"] as? List<*>
                    ?: return recoverableFailure()
                if (items.size > 120) return recoverableFailure()
                when (part) {
                    "categories" -> {
                        val parsed = items.mapNotNull { value ->
                            (value as? Map<*, *>)?.let {
                                StreamCatalogDeltaParser.category(providerId,kind,it)
                            }
                        }
                        if (parsed.size != items.size) return recoverableFailure()
                        val existing = if (parsed.isEmpty()) emptyMap() else
                            dao.categoriesByKeys(parsed.map { it.key }).associateBy { it.key }
                        dao.upsertCategories(parsed.map { row ->
                            existing[row.key]?.let { old ->
                                row.copy(hidden=old.hidden,orderIndex=old.orderIndex)
                            } ?: row
                        })
                    }
                    "items" -> {
                        val first = items.mapNotNull { value ->
                            (value as? Map<*, *>)?.let {
                                StreamCatalogDeltaParser.item(providerId,kind,it)
                            }
                        }
                        if (first.size != items.size) return recoverableFailure()
                        val existing = if (first.isEmpty()) emptyMap() else
                            dao.streamsByKeys(first.map { it.key }).associateBy { it.key }
                        val rows = items.mapIndexed { i, value ->
                            StreamCatalogDeltaParser.item(providerId,kind,
                                value as Map<*, *>,existing[first[i].key])
                                ?: return recoverableFailure()
                        }
                        dao.applyChangedCatalogRows(rows)
                    }
                    else -> {
                        val keys = items.mapNotNull { v ->
                            val id = v.asNumber()?.toLong()
                            id?.takeIf { it > 0 }?.let { "$providerId:$kind:$it" }
                        }
                        if (keys.size != items.size) return recoverableFailure()
                        dao.removeCatalogRowsByKeys(keys)
                    }
                }
                completedItems += items.size
                val next = page["nextCursor"].asNumber()?.toLong()
                val complete = page["complete"] == true
                if (!complete && (next == null || next <= cursor))
                    return recoverableFailure()
                cursor = if (complete) 0L else checkNotNull(next)
                // Save only AFTER the Room page commit. Retrying repeats at
                // most one idempotent small batch, not a full-library import.
                val changed = prefs.edit().putInt(KEY_PART_INDEX,
                    if (complete) position + 1 else position)
                    .putLong(KEY_CURSOR,cursor)
                    .putLong(KEY_APPLIED_COUNT,completedItems).commit()
                if (!changed) return recoverableFailure()
                setProgress(workDataOf(KEY_KIND to kind, KEY_PART to part,
                    KEY_APPLIED to completedItems.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()))
            } while (!complete)
        }
        // Do not claim a completed revision if ingestion changed mid-transfer.
        val endVersion = XtreamClient.api.objectResponse(
            "${StreamCodeSession.HOST}/player_api.php?action=get_blofy_catalog_version"
        )
        if (endVersion["revision"].asNumber()?.toLong() != current ||
            endVersion["syncStatus"] != "online") return recoverableFailure()
        if (!prefs.edit().putLong(KEY_COMPLETE_REVISION,current)
                .putLong(KEY_LAST_SUCCESS,System.currentTimeMillis())
                .putLong(KEY_LAST_CHECK,System.currentTimeMillis()).commit())
            return recoverableFailure()
        clearCheckpoint()
        // Invalidate derived home metadata only after all nine parts have been
        // applied; neither the code token nor the provider identity changes.
        CatalogSyncState.markSourceReplaced(app,providerId)
        return Result.success(workDataOf(KEY_STATUS to "updated",
            KEY_APPLIED to completedItems.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()))
    }

    private fun notReady() = Result.failure(workDataOf(KEY_STATUS to "not_ready"))

    private fun recoverableFailure(reason: String = "unavailable"): Result =
        if (!inputData.getBoolean(KEY_AUTO, true))
            Result.failure(workDataOf(KEY_STATUS to reason))
        // Unlimited automatic one-time retries can remain ENQUEUED for hours
        // on TV boxes when the source is syncing or offline. WorkManager's
        // periodic schedule and entry checks will retry later; let the current
        // attempt stop after one exponential backoff instead of spinning forever.
        else if (StreamCatalogRetryPolicy.shouldDefer(runAttemptCount))
            Result.success(workDataOf(KEY_STATUS to "deferred"))
        else Result.retry()

    private fun clearCheckpoint() {
        prefs.edit().remove(KEY_PENDING_REVISION).remove(KEY_PENDING_BASE)
            .remove(KEY_PART_INDEX).remove(KEY_CURSOR).remove(KEY_APPLIED_COUNT).apply()
    }

    companion object {
        private const val PREFS = "blofy_stream_incremental_catalog_56"
        private val syncMutex = Mutex()
        private const val KEY_ACCOUNT_FINGERPRINT = "account_fingerprint"
        private const val KEY_COMPLETE_REVISION = "complete_revision"
        private const val KEY_PENDING_REVISION = "pending_revision"
        private const val KEY_PENDING_BASE = "pending_base"
        private const val KEY_PART_INDEX = "part_index"
        private const val KEY_CURSOR = "cursor"
        private const val KEY_APPLIED_COUNT = "applied"
        private const val KEY_LAST_SUCCESS = "last_success"
        private const val KEY_LAST_CHECK = "last_check"
        private const val KEY_LAST_ATTEMPT = "last_attempt"
        const val KEY_AUTO = "auto"
        const val KEY_STATUS = "status"
        const val KEY_KIND = "kind"
        const val KEY_PART = "part"
        const val KEY_APPLIED = "applied"
        private const val UNIQUE = "blofy-stream-56-incremental-"
        private const val PERIODIC = "blofy-stream-56-periodic-"

        fun workName(providerId: String) = UNIQUE + providerId

        /** Only reads a timestamp, no network or subscriber credentials. */
        fun lastCheckedAt(context: Context): Long = context.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_LAST_CHECK, 0L)

        fun enqueue(context: Context, providerId: String, automatic: Boolean = true) {
            if (!BuildConfig.CODE_ONLY_LOGIN || providerId != StreamCodeSession.providerId) return
            val request = OneTimeWorkRequestBuilder<StreamCatalogDeltaWorker>()
                .setConstraints(Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setInputData(workDataOf(KEY_AUTO to automatic))
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL,20,TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context.applicationContext)
                .enqueueUniqueWork(workName(providerId),
                    if (automatic) ExistingWorkPolicy.KEEP else ExistingWorkPolicy.REPLACE,
                    request)
        }

        fun enqueueIfDue(context: Context, providerId: String) {
            if (!BuildConfig.CODE_ONLY_LOGIN || providerId != StreamCodeSession.providerId)
                return
            val prefs=context.applicationContext.getSharedPreferences(PREFS,Context.MODE_PRIVATE)
            val now=System.currentTimeMillis()
            val last=prefs.getLong(KEY_LAST_ATTEMPT,0L)
            if (!StreamCatalogRefreshCadence.isEntryCheckDue(last, now)) return
            if (prefs.edit().putLong(KEY_LAST_ATTEMPT,now).commit())
                enqueue(context,providerId,true)
        }

        fun schedule(context: Context, providerId: String) {
            if (!BuildConfig.CODE_ONLY_LOGIN || providerId != StreamCodeSession.providerId) return
            // WorkManager schedules best-effort checks, not exact wall-clock polling.
            // The revision endpoint is cheap; pages download only on a changed revision.
            val request=PeriodicWorkRequestBuilder<StreamCatalogDeltaWorker>(
                StreamCatalogRefreshCadence.PERIODIC_MINUTES, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setInputData(workDataOf(KEY_AUTO to true))
                .build()
            WorkManager.getInstance(context.applicationContext)
                .enqueueUniquePeriodicWork(PERIODIC+providerId,
                    ExistingPeriodicWorkPolicy.UPDATE,request)
        }
    }
}

private fun Any?.asNumber(): Number? = when(this) {
    is Number -> this
    is String -> this.toLongOrNull()
    else -> null
}

/**
 * Small server revision checks are safe to run often. Full catalogue downloads
 * happen only when that revision changes, and WorkManager defers during playback.
 * Not a push service: sleeping devices may be checked later by Android.
 */
internal object StreamCatalogRefreshCadence {
    const val ENTRY_MINIMUM_GAP_MS = 20L * 60_000L
    const val PERIODIC_MINUTES = 30L

    fun isEntryCheckDue(lastAttemptMs: Long, nowMs: Long): Boolean =
        lastAttemptMs <= 0L || nowMs < lastAttemptMs ||
            nowMs - lastAttemptMs >= ENTRY_MINIMUM_GAP_MS
}

/** A periodic worker must complete this cycle, not permanently fail/cancel it. */
internal object StreamCatalogRetryPolicy {
    const val MAX_RETRIES_PER_CYCLE = 1
    fun shouldDefer(runAttemptCount: Int) = runAttemptCount >= MAX_RETRIES_PER_CYCLE
}
