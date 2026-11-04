package tv.blofy.player.data

import com.google.gson.JsonSyntaxException
import java.io.EOFException
import java.io.IOException
import java.net.UnknownHostException
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class CatalogSplitDownloadPolicyTest {
    private fun status(code: Int) =
        HttpException(Response.error<Unit>(code, "failed".toResponseBody()))

    @Test fun truncatedJsonAndTimeoutUseSmallerArrays() {
        assertTrue(CatalogSplitDownloadPolicy.canSplit(IOException("socket closed"), 5))
        assertTrue(CatalogSplitDownloadPolicy.canSplit(JsonSyntaxException(EOFException("truncated")), 5))
    }

    @Test fun sectionNotAvailableWithoutCategoryMaySupportFilteredCalls() {
        assertTrue(CatalogSplitDownloadPolicy.canSplit(status(404), 2))
    }

    @Test fun authenticationAndDnsAreNotMaskedByFallback() {
        assertFalse(CatalogSplitDownloadPolicy.canSplit(status(401), 5))
        assertFalse(CatalogSplitDownloadPolicy.canSplit(status(403), 5))
        assertFalse(CatalogSplitDownloadPolicy.canSplit(UnknownHostException("host"), 5))
    }

    @Test fun fallbackRequiresBoundedKnownCategories() {
        assertFalse(CatalogSplitDownloadPolicy.canSplit(IOException("offline"), 0))
        assertFalse(CatalogSplitDownloadPolicy.canSplit(IOException("offline"), 2001))
    }
}
