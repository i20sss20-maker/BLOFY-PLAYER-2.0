import pg from 'pg';
import { databaseOptions } from './database-options.mjs';
import { safeErrorSummary } from './diagnostics-sanitizer.mjs';

const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
if (!DATABASE_URL) {
  console.warn('BLOFY curated sources skipped: DATABASE_URL missing');
} else {
  const pool = new pg.Pool({
    ...databaseOptions(DATABASE_URL),
    max: 1,
    connectionTimeoutMillis: 4000,
    idleTimeoutMillis: 5000,
    statement_timeout: 10000
  });

  const sources = [
    {
      id: 'internet-archive', internalName: 'InternetArchiveProvider', name: 'Internet Archive',
      description: 'Open archive video and audio from Internet Archive; item rights vary.',
      iconUrl: 'https://www.google.com/s2/favicons?domain=archive.org&sz=%size%',
      pluginUrl: 'https://raw.githubusercontent.com/recloudstream/extensions/builds/InternetArchiveProvider.cs3',
      repositoryUrl: 'https://github.com/recloudstream/extensions',
      fileHash: 'sha256-54f3de560bebeff2e4a10d1163f6146313c59061d21c3a230125611f01b531eb',
      fileSize: 28037, apiVersion: 1, pluginVersion: 1, status: 1, language: null,
      authors: ['Luna712'], tvTypes: ['Others'], enabled: true, category: 'archive', priority: 10,
      rightsNote: 'Internet Archive contains mixed-rights material; users must respect item-level rights.'
    },
    {
      id: 'twitch', internalName: 'TwitchProvider', name: 'Twitch',
      description: 'Live streams from Twitch.',
      iconUrl: 'https://www.google.com/s2/favicons?domain=twitch.tv&sz=%size%',
      pluginUrl: 'https://raw.githubusercontent.com/recloudstream/extensions/builds/TwitchProvider.cs3',
      repositoryUrl: 'https://github.com/recloudstream/extensions',
      fileHash: 'sha256-a7cc95f77bbd00a311d122201c63babe70b63fb398641fa28bf2b2c77346150a',
      fileSize: 15239, apiVersion: 1, pluginVersion: 2, status: 1, language: null,
      authors: ['CranberrySoup'], tvTypes: ['Live'], enabled: true, category: 'live', priority: 20,
      rightsNote: 'Content rights remain with creators and Twitch.'
    },
    {
      id: 'dailymotion', internalName: 'DailymotionProvider', name: 'Dailymotion',
      description: 'Video catalog from Dailymotion.',
      iconUrl: 'https://www.google.com/s2/favicons?domain=www.dailymotion.com&sz=%size%',
      pluginUrl: 'https://raw.githubusercontent.com/recloudstream/extensions/builds/DailymotionProvider.cs3',
      repositoryUrl: 'https://github.com/recloudstream/extensions',
      fileHash: 'sha256-9036525a64e8b3c8fe04f94e9fe89a744c13d69af684ed0d2ad2a7eb0f332cd9',
      fileSize: 11472, apiVersion: 1, pluginVersion: 4, status: 1, language: null,
      authors: ['Luna712'], tvTypes: ['Others'], enabled: true, category: 'video', priority: 30,
      rightsNote: 'Content rights remain with creators and Dailymotion.'
    },
    {
      id: 'youtube', internalName: 'YoutubeProvider', name: 'YouTube',
      description: 'YouTube videos, live streams and series-style content.',
      iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/YouTube_full-color_icon_%282017%29.svg/3840px-YouTube_full-color_icon_%282017%29.svg.png',
      pluginUrl: 'https://raw.githubusercontent.com/recloudstream/extensions/builds/YoutubeProvider.cs3',
      repositoryUrl: 'https://github.com/recloudstream/extensions',
      fileHash: 'sha256-a246eb1584cec9e69ba8c50136b9e8dc11a2fc0ab225710c31ad66c2ec4f4efe',
      fileSize: 13152, apiVersion: 1, pluginVersion: 1, status: 1, language: null,
      authors: ['KaifTaufiq'], tvTypes: ['Other','Live','TvSeries'], enabled: true, category: 'video-live-series', priority: 40,
      rightsNote: 'Content rights remain with creators and YouTube.'
    },
    {
      id: 'invidious', internalName: 'InvidiousProvider', name: 'Invidious',
      description: 'Video access through user-selected Invidious instances.',
      iconUrl: 'https://www.google.com/s2/favicons?domain=invidious.io&sz=%size%',
      pluginUrl: 'https://raw.githubusercontent.com/recloudstream/extensions/builds/InvidiousProvider.cs3',
      repositoryUrl: 'https://github.com/recloudstream/extensions',
      fileHash: 'sha256-a0a2ff7e8484f69118598d347458774935733399ba0f76ef0d4921886a7db4a9',
      fileSize: 13695, apiVersion: 1, pluginVersion: 9, status: 1, language: null,
      authors: ['Cloudburst'], tvTypes: ['Others'], enabled: true, category: 'video', priority: 50,
      rightsNote: 'Instance availability and platform terms vary; users choose the instance.'
    },
    {
      id: 'librivox-audiobook', internalName: 'LibriVoxAudiobook', name: 'LibriVox Audiobooks',
      description: 'Public-domain audiobooks from LibriVox.',
      iconUrl: 'https://librivox.org/wp-content/themes/librivox/images/librivox-logo.png',
      pluginUrl: 'https://raw.githubusercontent.com/NivinCNC/CNCVerse-Cloud-Stream-Extension/builds/LibriVoxAudiobook.cs3',
      repositoryUrl: 'https://github.com/NivinCNC/CNCVerse-Cloud-Stream-Extension',
      fileHash: null, fileSize: null, apiVersion: 1, pluginVersion: 33, status: 1, language: 'en',
      authors: ['NivinCNC'], tvTypes: ['Others'], enabled: true, category: 'audiobooks', priority: 60,
      rightsNote: 'LibriVox recordings are public-domain works where applicable; metadata may have separate terms.'
    },
    {
      id: 'bilibili', internalName: 'BilibiliProvider', name: 'Bilibili (Beta)',
      description: 'Bilibili international catalog for anime, movies, series and documentary-style content; beta provider.',
      iconUrl: 'https://play-lh.googleusercontent.com/G9s84Cm1TDnKDX2P8nipS_s60cuCnYtjBRRLespF8nivjXmbV9tF1fY37clZhXMLaA',
      pluginUrl: 'https://raw.githubusercontent.com/NivinCNC/CNCVerse-Cloud-Stream-Extension/builds/BilibiliProvider.cs3',
      repositoryUrl: 'https://github.com/NivinCNC/CNCVerse-Cloud-Stream-Extension',
      fileHash: 'sha256-5a89a7439c1180d762ce629be81eeb687314c2baf67b3ca3ee846dfd2636ed81',
      fileSize: 103765, apiVersion: 1, pluginVersion: 36, status: 3, language: 'ta',
      authors: ['NivinCNC'], tvTypes: ['Anime','Movies','TvSeries','Documentary'], enabled: true, category: 'movies-series-anime-documentary', priority: 70,
      rightsNote: 'Availability and licensing depend on Bilibili region/catalog; beta connector.'
    },
    {
      id: 'm3u-playlist-player', internalName: 'M3UPlaylistPlayerProvider', name: 'M3U Playlist Player',
      description: 'User-supplied M3U live playlist player; no bundled channels.',
      iconUrl: null,
      pluginUrl: 'https://raw.githubusercontent.com/NivinCNC/CNCVerse-Cloud-Stream-Extension/builds/M3UPlaylistPlayerProvider.cs3',
      repositoryUrl: 'https://github.com/NivinCNC/CNCVerse-Cloud-Stream-Extension',
      fileHash: null, fileSize: null, apiVersion: 1, pluginVersion: 17, status: 1, language: null,
      authors: ['NivinCNC'], tvTypes: ['Live'], enabled: true, category: 'live-user-playlist', priority: 80,
      rightsNote: 'No channels are bundled. Users must provide playlists they are authorized to access.'
    }
  ];

  async function seed() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(718420679)');
      await client.query(`CREATE TABLE IF NOT EXISTS blofy_source_registry (
        id TEXT PRIMARY KEY,
        internal_name TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        icon_url TEXT,
        plugin_url TEXT NOT NULL,
        repository_url TEXT,
        file_hash TEXT,
        file_size BIGINT,
        api_version INTEGER NOT NULL DEFAULT 1,
        plugin_version INTEGER NOT NULL DEFAULT 1,
        status SMALLINT NOT NULL DEFAULT 1 CHECK(status BETWEEN 0 AND 3),
        language TEXT,
        authors JSONB NOT NULL DEFAULT '[]'::jsonb,
        tv_types JSONB NOT NULL DEFAULT '[]'::jsonb,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        category TEXT NOT NULL DEFAULT 'other',
        priority INTEGER NOT NULL DEFAULT 100,
        rights_note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      for (const item of sources) {
        await client.query(`INSERT INTO blofy_source_registry(
          id,internal_name,name,description,icon_url,plugin_url,repository_url,file_hash,file_size,
          api_version,plugin_version,status,language,authors,tv_types,enabled,category,priority,rights_note,updated_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18,$19,NOW())
        ON CONFLICT(internal_name) DO UPDATE SET
          name=EXCLUDED.name,description=EXCLUDED.description,icon_url=EXCLUDED.icon_url,
          plugin_url=EXCLUDED.plugin_url,repository_url=EXCLUDED.repository_url,file_hash=EXCLUDED.file_hash,
          file_size=EXCLUDED.file_size,api_version=EXCLUDED.api_version,plugin_version=EXCLUDED.plugin_version,
          language=EXCLUDED.language,authors=EXCLUDED.authors,tv_types=EXCLUDED.tv_types,updated_at=NOW()`, [
          item.id,item.internalName,item.name,item.description,item.iconUrl,item.pluginUrl,item.repositoryUrl,
          item.fileHash,item.fileSize,item.apiVersion,item.pluginVersion,item.status,item.language,
          JSON.stringify(item.authors),JSON.stringify(item.tvTypes),item.enabled,item.category,item.priority,item.rightsNote
        ]);
      }
      await client.query('COMMIT');
      console.log(`BLOFY curated sources ready: ${sources.length}`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('BLOFY curated sources seed failed:', safeErrorSummary(error));
    } finally {
      client.release();
      await pool.end().catch(() => {});
    }
  }

  await seed();
}
