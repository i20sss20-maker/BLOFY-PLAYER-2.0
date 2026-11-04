package tv.blofy.player.data

import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

class XtreamSectionIssueTest {
    private fun http(code: Int): HttpException =
        HttpException(Response.error<Unit>(code, "secret://hidden-host".toResponseBody()))

    @Test fun missingActionIdentifiesSectionWithoutExposingHost() {
        val issue = XtreamSectionIssue.from(2, http(404))
        val message = XtreamSectionIssue.describe(listOf(issue))
        assertEquals(PlaylistSyncStage.SERIES, issue.section)
        assertTrue(message.contains("المسلسلات"))
        assertTrue(message.contains("404"))
        assertFalse(message.contains("hidden-host"))
    }

    @Test fun timeoutKeepsSectionNameButDoesNotLeakExceptionMessage() {
        val issue = XtreamSectionIssue.from(0, IOException("username=u&password=secret"))
        val message = XtreamSectionIssue.describe(listOf(issue))
        assertTrue(message.contains("القنوات"))
        assertFalse(message.contains("secret"))
        assertNull(issue.httpStatus)
    }

    @Test fun explicitUnauthorizedIsNotTreatedAsMissingAction() {
        val message = XtreamSectionIssue.describe(listOf(XtreamSectionIssue.from(1, http(401))))
        assertTrue(message.contains("401"))
        assertTrue(message.contains("رفض"))
    }

    @Test fun reportsEveryBrokenSection() {
        val message = PlaylistSyncResult(
            freshItemCount = 350,
            failedSectionCount = 2,
            failedSections = listOf(XtreamSectionIssue.from(1, http(404)), XtreamSectionIssue.from(2, http(503)))
        ).safeFailureMessage()
        assertTrue(message.contains("الأفلام"))
        assertTrue(message.contains("المسلسلات"))
    }
}
