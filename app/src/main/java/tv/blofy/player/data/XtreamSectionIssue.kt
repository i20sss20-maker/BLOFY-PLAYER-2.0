package tv.blofy.player.data

import com.google.gson.JsonParseException
import java.io.EOFException
import java.io.IOException
import java.net.SocketTimeoutException
import retrofit2.HttpException

/**
 * Reports useful sanitized failure causes, never a full exception message,
 * request URL, password, or internal BLOFY host address on the loading screen.
 */
data class XtreamSectionIssue(
    val section: PlaylistSyncStage,
    val httpStatus: Int?,
    val failureType: FailureType = FailureType.UNKNOWN
) {
    enum class FailureType { UNKNOWN, INTERRUPTED, TIMEOUT, NETWORK, INVALID_CONTENT }

    companion object {
        fun from(sectionIndex: Int, error: Throwable): XtreamSectionIssue {
            val section = listOf(PlaylistSyncStage.LIVE, PlaylistSyncStage.MOVIES, PlaylistSyncStage.SERIES)
                .getOrElse(sectionIndex) { PlaylistSyncStage.M3U }
            val chain = generateSequence(error) { it.cause }.take(12).toList()
            val status = chain.filterIsInstance<HttpException>().firstOrNull()?.code()
            val kind = when {
                chain.any { it is SocketTimeoutException } -> FailureType.TIMEOUT
                chain.any { it is EOFException || it is JsonParseException } -> FailureType.INTERRUPTED
                chain.any { it is IOException } -> FailureType.NETWORK
                chain.any { it is IllegalStateException && it.message?.startsWith("Incomplete ") == true } ->
                    FailureType.INVALID_CONTENT
                else -> FailureType.UNKNOWN
            }
            return XtreamSectionIssue(section, status, kind)
        }

        fun describe(issues: List<XtreamSectionIssue>): String {
            if (issues.isEmpty()) return "تعذر تحديث بعض أقسام الباقة"
            val names = issues.joinToString("، ") { issue ->
                when (issue.section) {
                    PlaylistSyncStage.LIVE -> "القنوات"
                    PlaylistSyncStage.MOVIES -> "الأفلام"
                    PlaylistSyncStage.SERIES -> "المسلسلات"
                    PlaylistSyncStage.M3U -> "القائمة"
                }
            }
            if (issues.all { it.httpStatus == null && it.failureType == issues[0].failureType }) {
                val reason = when (issues[0].failureType) {
                    FailureType.INTERRUPTED -> "انقطع نقل بيانات السيرفر"
                    FailureType.TIMEOUT -> "انتهت مهلة استجابة السيرفر"
                    FailureType.NETWORK -> "تعذر الاتصال بالسيرفر"
                    FailureType.INVALID_CONTENT -> "بيانات السيرفر غير مكتملة"
                    FailureType.UNKNOWN -> "تعذر اكتمال بيانات السيرفر"
                }
                return "تعذر تحميل $names • $reason"
            }
            return issues.joinToString(" • ") { issue ->
                val sectionName = when (issue.section) {
                    PlaylistSyncStage.LIVE -> "القنوات"
                    PlaylistSyncStage.MOVIES -> "الأفلام"
                    PlaylistSyncStage.SERIES -> "المسلسلات"
                    PlaylistSyncStage.M3U -> "القائمة"
                }
                when (val code = issue.httpStatus ?: -1) {
                    401, 403 -> "رفض اشتراك $sectionName (HTTP $code)"
                    404 -> "مسار $sectionName غير متاح (HTTP 404)"
                    429 -> "سيرفر $sectionName مشغول (HTTP 429)"
                    in 500..599 -> "خطأ سيرفر $sectionName (HTTP $code)"
                    else -> "تعذر اكتمال تحميل $sectionName"
                }
            }
        }
    }
}
