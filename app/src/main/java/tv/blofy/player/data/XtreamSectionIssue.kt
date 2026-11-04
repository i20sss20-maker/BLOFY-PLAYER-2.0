package tv.blofy.player.data

import retrofit2.HttpException

/**
 * A sanitized Xtream failure. Never format a request URL, exception message,
 * token, or password into a catalog error shown on a TV.
 */
data class XtreamSectionIssue(val section: PlaylistSyncStage, val httpStatus: Int?) {
    companion object {
        fun from(sectionIndex: Int, error: Throwable): XtreamSectionIssue {
            val section = listOf(PlaylistSyncStage.LIVE, PlaylistSyncStage.MOVIES, PlaylistSyncStage.SERIES)
                .getOrElse(sectionIndex) { PlaylistSyncStage.M3U }
            val status = generateSequence(error) { it.cause }.take(10)
                .filterIsInstance<HttpException>().firstOrNull()?.code()
            return XtreamSectionIssue(section, status)
        }

        fun describe(issues: List<XtreamSectionIssue>): String {
            if (issues.isEmpty()) return "تعذر تحديث بعض أقسام الباقة"
            return issues.joinToString(" • ") { issue ->
                val area = when (issue.section) {
                    PlaylistSyncStage.LIVE -> "القنوات"
                    PlaylistSyncStage.MOVIES -> "الأفلام"
                    PlaylistSyncStage.SERIES -> "المسلسلات"
                    PlaylistSyncStage.M3U -> "القائمة"
                }
                when (issue.httpStatus) {
                    401, 403 -> "رفض السيرفر اشتراك $area (HTTP ${issue.httpStatus})"
                    404 -> "مسار $area غير متاح في الهوست (HTTP 404)"
                    429 -> "السيرفر مشغول عند تحميل $area (HTTP 429)"
                    in 500..599 -> "خطأ سيرفر $area (HTTP ${issue.httpStatus})"
                    else -> "تعذر اكتمال تحميل $area"
                }
            }
        }
    }
}
