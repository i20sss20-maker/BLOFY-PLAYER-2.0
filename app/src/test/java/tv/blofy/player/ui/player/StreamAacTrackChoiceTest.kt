package tv.blofy.player.ui.player

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.TrackGroup
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28])
@OptIn(markerClass = [UnstableApi::class])
class StreamAacTrackChoiceTest {
    private fun makeAudio(supported: IntArray, selected: BooleanArray) = Tracks(listOf(
        Tracks.Group(
            TrackGroup(
                Format.Builder().setSampleMimeType(MimeTypes.AUDIO_E_AC3).build(),
                Format.Builder().setSampleMimeType(MimeTypes.AUDIO_AAC).build()
            ),
            false,
            supported,
            selected
        )
    ))

    @Test fun offersOnlyMedia3SupportedUnselectedAacTrack() {
        val tracks = makeAudio(
            intArrayOf(C.FORMAT_HANDLED, C.FORMAT_HANDLED),
            booleanArrayOf(true, false)
        )
        val candidate = StreamAacTrackChoice.available(tracks)
        assertEquals(1, candidate?.index)
        assertEquals(MimeTypes.AUDIO_AAC, candidate?.group?.getTrackFormat(candidate.index)?.sampleMimeType)
    }

    @Test fun neverOffersUnsupportedAacOnAndroid9() {
        val tracks = makeAudio(
            intArrayOf(C.FORMAT_HANDLED, C.FORMAT_UNSUPPORTED_SUBTYPE),
            booleanArrayOf(true, false)
        )
        assertNull(StreamAacTrackChoice.available(tracks))
    }

    @Test fun selectedAacIsNotOfferedAgain() {
        val tracks = makeAudio(
            intArrayOf(C.FORMAT_HANDLED, C.FORMAT_HANDLED),
            booleanArrayOf(false, true)
        )
        assertNull(StreamAacTrackChoice.available(tracks))
    }

    @Test fun noAudioOrOnlyVideoCannotCauseTrackSwitch() {
        val tracks = Tracks(listOf(Tracks.Group(
            TrackGroup(Format.Builder().setSampleMimeType(MimeTypes.VIDEO_H264).build()),
            false,
            intArrayOf(C.FORMAT_HANDLED),
            booleanArrayOf(true)
        )))
        assertNull(StreamAacTrackChoice.available(tracks))
    }

    @Test fun selectedUnsupportedAc3StillOffersSupportedAacAsOptIn() {
        val tracks = makeAudio(
            intArrayOf(C.FORMAT_UNSUPPORTED_SUBTYPE, C.FORMAT_HANDLED),
            booleanArrayOf(true, false)
        )
        assertEquals(1, StreamAacTrackChoice.available(tracks)?.index)
    }
}
