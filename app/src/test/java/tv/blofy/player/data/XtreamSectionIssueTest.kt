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

    @Test fun groupedInterruptedSectionsStayReadableWithoutLeakingSecrets() {
        val interrupted = java.io.EOFException("username=private&password=secret")
        val issues = listOf(
            XtreamSectionIssue.from(0, IllegalStateException("wrapper", interrupted)),
            XtreamSectionIssue.from(1, IllegalStateException("wrapper", interrupted)),
            XtreamSectionIssue.from(2, IllegalStateException("wrapper", interrupted))
        )
        val message = XtreamSectionIssue.describe(issues)
        assertTrue(message.contains("القنوات"))
        assertTrue(message.contains("الأفلام"))
        assertTrue(message.contains("المسلسلات"))
        assertTrue(message.contains("انقطع"))
        assertFalse(message.contains("secret"))
        assertTrue(message.length < 125)
    }

    @Test fun malformedJsonIsNotReportedAsNetworkInterruption() {
        val issue = XtreamSectionIssue.from(0, com.google.gson.JsonSyntaxException("private response"))
        assertEquals(XtreamSectionIssue.FailureType.INVALID_CONTENT, issue.failureType)
        assertFalse(XtreamSectionIssue.describe(listOf(issue)).contains("private"))
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
