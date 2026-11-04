package tv.blofy.player.data

import retrofit2.HttpException

/**
 * WorkManager already backs off. Never endlessly retry a permanent provider
 * error (404/401/403) or an exhausted transient section.
 */
internal object CatalogRetryDecision {
    private const val MAX_WORK_ATTEMPTS = 3

    fun shouldRetry(failures: List<XtreamSectionIssue>, runAttemptCount: Int): Boolean =
        runAttemptCount < MAX_WORK_ATTEMPTS - 1 &&
            failures.none { it.httpStatus?.let(::isPermanentStatus) == true }

    fun shouldRetry(error: Throwable, runAttemptCount: Int): Boolean {
        if (runAttemptCount >= MAX_WORK_ATTEMPTS - 1) return false
        val statuses = generateSequence(error) { it.cause }.take(12)
            .filterIsInstance<HttpException>().map { it.code() }
        return statuses.none(::isPermanentStatus)
    }

    private fun isPermanentStatus(status: Int): Boolean =
        status in 400..499 && status != 408 && status != 429
}
