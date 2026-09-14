package tv.blofy.player.ui.guide

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import tv.blofy.player.R

class EpgReminderWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return Result.success()

        val programTitle = inputData.getString(KEY_PROGRAM_TITLE)?.takeIf(String::isNotBlank) ?: return Result.failure()
        val channelName = inputData.getString(KEY_CHANNEL_NAME).orEmpty()
        val streamId = inputData.getString(KEY_STREAM_ID).orEmpty()
        val categoryId = inputData.getString(KEY_CATEGORY_ID)
        val notificationId = inputData.getInt(KEY_NOTIFICATION_ID, programTitle.hashCode())

        ensureChannel()
        val target = Intent(applicationContext, LiveGuideActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            if (streamId.isNotBlank()) putExtra(LiveGuideActivity.EXTRA_STREAM_ID, streamId)
            if (!categoryId.isNullOrBlank()) putExtra(LiveGuideActivity.EXTRA_CATEGORY_ID, categoryId)
        }
        val pendingIntent = PendingIntent.getActivity(
            applicationContext,
            notificationId,
            target,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val detail = listOf(channelName, programTitle).filter(String::isNotBlank).joinToString(" • ")
        val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(R.drawable.blofy_logo)
            .setContentTitle("BLOFY • البرنامج يبدأ بعد قليل")
            .setContentText(detail)
            .setStyle(NotificationCompat.BigTextStyle().bigText(detail))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        NotificationManagerCompat.from(applicationContext).notify(notificationId, notification)
        return Result.success()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = applicationContext.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "تذكيرات دليل البرامج",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "تنبيهات البرامج التي اخترت تذكيرك بها داخل BLOFY"
            }
        )
    }

    companion object {
        const val CHANNEL_ID = "blofy_epg_reminders"
        const val KEY_PROGRAM_TITLE = "program_title"
        const val KEY_CHANNEL_NAME = "channel_name"
        const val KEY_STREAM_ID = "stream_id"
        const val KEY_CATEGORY_ID = "category_id"
        const val KEY_NOTIFICATION_ID = "notification_id"
    }
}
