package tv.blofy.player.ui.library

import org.junit.Assert.*
import org.junit.Test

class NativeDownloadResumePolicyTest {
    private val tag = "\"version-1\""

    @Test fun resumesOnlyMatchingCompleteRange() {
        assertEquals(NativeDownloadResumePolicy.Plan(100,1000,tag),
            NativeDownloadResumePolicy.plan(206,100,tag,tag,"bytes 100-999/1000",900))
        for (range in listOf("bytes 99-999/1000","bytes 100-998/1000","bytes 100-999/*","bytes 100-999/999","bytes 100-999/9223372036854775808"))
            assertNull(range, NativeDownloadResumePolicy.plan(206,100,tag,tag,range,900))
        assertNull(NativeDownloadResumePolicy.plan(206,100,tag,"\"version-2\"","bytes 100-999/1000",900))
        assertNull(NativeDownloadResumePolicy.plan(206,100,tag,null,"bytes 100-999/1000",900))
        assertNull(NativeDownloadResumePolicy.plan(206,100,tag,tag,"bytes 100-999/1000",899))
    }

    @Test fun fullResponseRestartsAndWeakValidatorsNeverResume() {
        assertEquals(NativeDownloadResumePolicy.Plan(0,1000,"\"version-2\""),
            NativeDownloadResumePolicy.plan(200,100,tag,"\"version-2\"",null,1000))
        assertEquals(NativeDownloadResumePolicy.Plan(0,1000,null),
            NativeDownloadResumePolicy.plan(200,100,tag,"W/\"version-1\"",null,1000))
        assertNull(NativeDownloadResumePolicy.strongTag("W/\"version-1\""))
        assertNull(NativeDownloadResumePolicy.strongTag("\"bad\nheader\""))
        assertNull(NativeDownloadResumePolicy.plan(416,100,tag,tag,null,0))
    }
}
