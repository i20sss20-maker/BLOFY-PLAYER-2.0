// BLOFY isolated migration lab: synthetic live HLS, movie and episode.
// This entrypoint never reads Xtream or customer playlists.
import {execFile as execFileCb} from 'node:child_process';
import {promisify} from 'node:util';
import {runRailwaySyntheticAvSmoke} from './railway-isolated-av-smoke.mjs';

export const LAB_PROJECT='538a56fa-cdbb-49ba-9620-d350dcdc6aa4';
export const LAB_BUCKET='blofy-xtream-migration-test-media-obm-ml';
const LIVE_URL='http://blofy-migration-live-lab.railway.internal:8888/demo/index.m3u8';
const execFile=promisify(execFileCb);
const BASE={synthetic:true,privateOnly:true,sourceRequests:0,
  automaticCopy:false,customerCutover:false,devicePlaybackVerified:false};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function verifySyntheticLabLive({command=execFile}={}){
  // Pinned internal DNS and path: no arbitrary origin or external playlists.
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const r=await command('ffprobe',[
        '-v','error','-rw_timeout','15000000',
        '-show_entries','stream=codec_type','-of','json',LIVE_URL
      ],{timeout:25000,maxBuffer:262144});
      const streams=JSON.parse(r.stdout||'{}')?.streams||[];
      if(!streams.some(x=>x.codec_type==='video')||
         !streams.some(x=>x.codec_type==='audio'))
        throw Error('synthetic_live_tracks_missing');
      await command('ffmpeg',[
        '-hide_banner','-loglevel','error','-nostdin',
        '-rw_timeout','15000000','-i',LIVE_URL,'-t','2',
        '-map','0:v:0','-map','0:a:0','-f','null','-'
      ],{timeout:30000,maxBuffer:262144});
      return {ok:true,liveVerified:true,videoDecoded:true,
        audioDecoded:true,streamOrigin:'private_synthetic_railway_lab',
        providerRequests:0,customerCutover:false};
    }catch{
      if(attempt<3)await pause(1500);
    }
  }
  return {ok:false,liveVerified:false,
    code:'migration_lab_synthetic_hls_decode_failed',
    providerRequests:0,customerCutover:false};
}

export async function runMigrationLabAvSmoke({
  env=process.env,runner=runRailwaySyntheticAvSmoke,
  liveProbe=verifySyntheticLabLive
}={}){
  if(env.RAILWAY_PROJECT_ID!==LAB_PROJECT||
     env.RAILWAY_ENVIRONMENT_NAME!=='test')
    return {ok:false,code:'migration_lab_wrong_project_or_environment',...BASE};
  if(env.BLOFY_CONTENT_HUB_S3_BUCKET!==LAB_BUCKET||
     env.BLOFY_QA_EXPECTED_BUCKET!==LAB_BUCKET||
     env.BLOFY_CONTENT_HUB_S3_URL_STYLE!=='virtual-host')
    return {ok:false,code:'migration_lab_bucket_not_isolated',...BASE};
  if(env.BLOFY_QA_SYNTHETIC_ONLY!=='1'||
     env.BLOFY_QA_ISOLATED_BUCKET!=='1'||
     env.BLOFY_QA_SYNTHETIC_AV!=='1'||
     env.BLOFY_QA_PLATFORM_ENCRYPTION_DOC_ACK!=='1')
    return {ok:false,code:'migration_lab_approval_missing',...BASE};
  // No upstream login information is permitted in the synthetic lab.
  if(Object.keys(env).some(k=>/^(BLOFY_STREAM_UPSTREAM|BLOFY_XTREAM_|BLOFY_CONTENT_HUB_BRIDGE_TOKEN|XTREAM_(USERNAME|PASSWORD))/.test(k)))
    return {ok:false,code:'migration_lab_upstream_credentials_forbidden',...BASE};
  // Both fixtures use actual private Railway T3 storage and clean up their
  // exact keys; no source URL is passed to the runner or its S3 adapter.
  const movie=await runner({env,mediaKind:'movie'});
  if(movie?.ok!==true)return {...movie,ok:false,
    code:'migration_lab_movie_failed',movieVerified:false,
    episodeVerified:false,liveVerified:false,...BASE};
  const episode=await runner({env,mediaKind:'episode'});
  if(episode?.ok!==true)return {...episode,ok:false,
    code:'migration_lab_episode_failed',movieVerified:true,
    episodeVerified:false,liveVerified:false,...BASE};
  const live=await liveProbe();
  const ok=live?.ok===true&&live.videoDecoded===true&&
    live.audioDecoded===true;
  return {ok,code:ok?'migration_lab_all_three_synthetic_media_verified':
    'migration_lab_live_failed',...BASE,
    scope:'BLOFY-XTREAM-MIGRATION-LAB',
    movieVerified:movie.fullShaVerified===true&&movie.avVerified===true,
    episodeVerified:episode.fullShaVerified===true&&episode.avVerified===true,
    liveVerified:ok,totalSyntheticBytesWritten:
      (Number(movie.writtenBytes)||0)+(Number(episode.writtenBytes)||0),
    storageCleaned:movie.cleanedUp===true&&episode.cleanedUp===true,
    s3ObjectsAfter:episode.objectCountAfter,
    movieReadbackSha256:movie.fullShaVerified===true,
    episodeReadbackSha256:episode.fullShaVerified===true,
    liveAudioVideoDecoded:ok};
}

if(process.argv[1]?.endsWith('/railway-migration-lab-av-smoke.mjs')){
  const result=await runMigrationLabAvSmoke();
  console.log('BLOFY_MIGRATION_LAB_AV_SMOKE '+JSON.stringify(result));
  process.exitCode=result.ok===true?0:1;
}
