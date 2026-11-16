// BLOFY isolated migration lab: generated movie-like A/V only, no Xtream traffic.
// This entrypoint will NOT run against the customer's live project or S3 bucket.
import {runRailwaySyntheticAvSmoke} from './railway-isolated-av-smoke.mjs';

export const LAB_PROJECT='538a56fa-cdbb-49ba-9620-d350dcdc6aa4';
export const LAB_BUCKET='blofy-xtream-migration-test-media-obm-ml';
const BASE={synthetic:true,privateOnly:true,sourceRequests:0,
  automaticCopy:false,customerCutover:false,devicePlaybackVerified:false};

export async function runMigrationLabAvSmoke({
  env=process.env,runner=runRailwaySyntheticAvSmoke
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
  // The lab runner can only generate 2 seconds of local test video and
  // audio. It must not receive any owner/source credentials at all.
  if(Object.keys(env).some(k=>/^(BLOFY_STREAM_UPSTREAM|BLOFY_XTREAM_|BLOFY_CONTENT_HUB_BRIDGE_TOKEN|XTREAM_(USERNAME|PASSWORD))/.test(k)))
    return {ok:false,code:'migration_lab_upstream_credentials_forbidden',...BASE};
  const result=await runner({env});
  return {...result,scope:'BLOFY-XTREAM-MIGRATION-LAB',
    sourceRequests:0,customerCutover:false,automaticCopy:false};
}

if(process.argv[1]?.endsWith('/railway-migration-lab-av-smoke.mjs')){
  const result=await runMigrationLabAvSmoke();
  console.log('BLOFY_MIGRATION_LAB_AV_SMOKE '+JSON.stringify(result));
  process.exitCode=result.ok===true?0:1;
}
