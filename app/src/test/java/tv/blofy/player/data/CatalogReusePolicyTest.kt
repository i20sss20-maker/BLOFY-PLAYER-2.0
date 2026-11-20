package tv.blofy.player.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogReusePolicyTest {
    @Test fun oldReadyMarkerDoesNotCauseDestructiveReconnect() {
        assertTrue(CatalogReusePolicy.canReuseSavedCatalog(hasCatalog = true, connectionChanged = false))
        assertFalse(CatalogReusePolicy.shouldStageReplacement(hasCatalog = true, connectionChanged = false))
    }

    @Test fun changedBLOFYHostOrCredentialsRequireStaging() {
        assertFalse(CatalogReusePolicy.canReuseSavedCatalog(hasCatalog = true, connectionChanged = true))
        assertTrue(CatalogReusePolicy.shouldStageReplacement(hasCatalog = true, connectionChanged = true))
    }

    @Test fun firstLoadUsesFreshDownload() {
        assertFalse(CatalogReusePolicy.canReuseSavedCatalog(hasCatalog = false, connectionChanged = false))
        assertFalse(CatalogReusePolicy.shouldStageReplacement(hasCatalog = false, connectionChanged = true))
    }
}
