package tv.blofy.player.ui.guide

import android.content.Context
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import tv.blofy.player.data.local.EpgEntity
import java.util.concurrent.TimeUnit
import kotlin.math.max

object EpgReminderScheduler {
    private const val LEAD_TIME_MS = 5 * 60_000L

    fun schedule(
        context: Context,
        providerId: String,
        streamId: String,
        categoryId: String?,
        channelName: String,
        program: EpgEntity,
        nowMs: Long = System.currentTimeMillis()
    ): Boolean {
        if (providerId.isBlank() || streamId.isBlank() || program.startMs <= nowMs) return false
        val delayMs = delayUntil(program.startMs, nowMs)
        val identity = "$providerId|$streamId|${program.startMs}|${program.title}"
        val stableId = identity.hashCode()
        val request = OneTimeWorkRequestBuilder<EpgReminderWorker>()
            .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
            .setInputData(
                workDataOf(
                    EpgReminderWorker.KEY_PROGRAM_TITLE to program.title,
                    EpgReminderWorker.KEY_CHANNEL_NAME to channelName,
                    EpgReminderWorker.KEY_STREAM_ID to streamId,
                    EpgReminderWorker.KEY_CATEGORY_ID to categoryId.orEmpty(),
                    EpgReminderWorker.KEY_NOTIFICATION_ID to stableId
                )
            )
            .addTag("blofy_epg_reminder")
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            "blofy_epg_${stableId.toUInt().toString(16)}",
            ExistingWorkPolicy.REPLACE,
            request
        )
        return true
    }

    internal fun delayUntil(startMs: Long, nowMs: Long): Long =
        max(1_000L, startMs - LEAD_TIME_MS - nowMs)
}
