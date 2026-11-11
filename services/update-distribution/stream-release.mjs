// Strictly separate the owner-signed BLOFY STREAM package from BLOFY PLAYER.
// Only a verified same-package owner-signed STREAM build may be advertised here.
// Default is the latest already-published, checked release (version 2000088).
const APPROVED = Object.freeze({
  versionCode:2000088,
  versionName:'2.0.0-rc07.55.8.11-STREAM',
  minSupportedVersionCode:1,
  packageName:'tv.blofy.player.v2.stream',
  downloadUrl:'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/blofy-stream-55.8.11-owner-signed-20261111/BLOFY-STREAM-55.8.11-FFMPEG-OWNER-SIGNED.apk',
  sha256:'f29333559ed510050e3dd08347f0ae4d6d1193141484080e1d47e56fba6ba17e',
  apkSizeBytes:292310844,
  releaseNotes:'BLOFY STREAM 55.8.11: ثبات التصنيفات ودعم الصوتيات والترجمة على Android TV والأجهزة المحمولة.'
});
const SHA=/^[0-9a-f]{64}$/i;
const NAME=/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,63}$/;
function safeUrl(candidate){
  try{
    const url=new URL(candidate);
    return url.protocol==='https:'&&!url.username&&!url.password&&
      ['github.com','updates.blofyplayer.com'].includes(url.hostname)&&!url.hash?
      url.toString():null;
  }catch{return null;}
}
// Setting one new version flag without ALL signed build details never
// accidentally promotes a nonexistent or differently signed APK.
export function streamReleasePayload(env=process.env){
  const code=Number(env.BLOFY_STREAM_RELEASE_VERSION_CODE);
  const requested=Number.isSafeInteger(code)&&code>APPROVED.versionCode;
  const url=safeUrl(String(env.BLOFY_STREAM_RELEASE_DOWNLOAD_URL||'').trim());
  const sha=String(env.BLOFY_STREAM_RELEASE_SHA256||'').trim().toLowerCase();
  const name=String(env.BLOFY_STREAM_RELEASE_VERSION_NAME||'').trim();
  const size=Number(env.BLOFY_STREAM_RELEASE_APK_SIZE_BYTES);
  const valid=requested&&url&&SHA.test(sha)&&NAME.test(name)&&
    Number.isSafeInteger(size)&&size>=1024&&size<=1024*1024*1024;
  const release=valid?{
    ...APPROVED,versionCode:code,versionName:name,downloadUrl:url,
    sha256:sha,apkSizeBytes:size,
    releaseNotes:String(env.BLOFY_STREAM_RELEASE_NOTES||'BLOFY STREAM: تحسينات الأداء والتوافق.')
      .replace(/[\u0000-\u001f\u007f]/g,'').slice(0,600)
  }:APPROVED;
  return {ok:true,service:'blofy-stream-updates',
    release:{app:{...release}}};
}
