package tv.blofy.player.data

import tv.blofy.player.data.local.EpisodeEntity

/** A silent background refresh is additive: incomplete provider replies must not
 * delete previously downloaded episode metadata. A full explicit refresh may still
 * use the authoritative provider snapshot when needed.
 */
internal object SeriesEpisodeRetentionPolicy {
    fun preserveCached(cached: List<EpisodeEntity>, fetched: List<EpisodeEntity>): List<EpisodeEntity> {
        if (fetched.isEmpty()) return cached
        return (cached + fetched).associateBy(EpisodeEntity::key).values.toList()
    }
}
