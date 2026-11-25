import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const run=promisify(execFile);
const host='172.239.239.142';
const base={id:'linode-engine',name:'BLOFY ENGINE PRO — Linode',tier:'test',httpStatus:null};
export function validateBridgeReport(report,now=Date.now()){
  const age=now-Date.parse(report?.timestamp);
  if(report?.product!=='BLOFY ENGINE PRO'||report?.mode!=='monitoring-only'||
     !Number.isFinite(age)||age< -5000||age>120000||
     !['HEALTHY','DEGRADED'].includes(report?.status)||
     !Number.isSafeInteger(report?.alert_count)||report.alert_count<0)
    throw new Error('invalid_or_stale_report');
  return report.status==='HEALTHY'&&report.alert_count===0&&
    report.live?.healthy===true&&report.timeshift?.healthy===true;
}
export async function probeLinodeBridge(env=process.env,execute=run){
  if(env.BLOFY_LINODE_BRIDGE_ENABLED!=='true')return null;
  const started=Date.now();
  const result=(status,note)=>({...base,status,note,latencyMs:Date.now()-started});
  let dir;
  try{
    const encoded=env.BLOFY_LINODE_BRIDGE_KEY_B64||'';
    const publicKey=env.BLOFY_LINODE_BRIDGE_HOST_KEY||'';
    if(encoded.length>8192||! /^[A-Za-z0-9+/]+={0,2}$/.test(encoded)||
       !/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/.test(publicKey)||publicKey.length>256)
      return result('error','إعدادات مفتاح الربط غير مكتملة');
    const privateKey=Buffer.from(encoded,'base64');
    if(!privateKey.toString('utf8').startsWith('-----BEGIN OPENSSH PRIVATE KEY-----'))
      return result('error','صيغة مفتاح الربط غير صالحة');
    dir=await mkdtemp(join(tmpdir(),'blofy-bridge-'));
    const key=join(dir,'identity'),known=join(dir,'known_hosts');
    await writeFile(key,privateKey,{mode:0o600});
    await writeFile(known,host+' '+publicKey+'\n',{mode:0o600});
    const {stdout}=await execute('/usr/bin/ssh',[
      '-F','/dev/null','-T','-i',key,
      '-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','IdentityAgent=none',
      '-o','StrictHostKeyChecking=yes','-o','HostKeyAlgorithms=ssh-ed25519',
      '-o','UserKnownHostsFile='+known,'-o','GlobalKnownHostsFile=/dev/null',
      '-o','ClearAllForwardings=yes','-o','ConnectTimeout=4',
      '-o','PasswordAuthentication=no','-o','KbdInteractiveAuthentication=no',
      'blofybridge@'+host,'status'
    ],{timeout:6500,maxBuffer:16384,env:{PATH:'/usr/bin:/bin',LANG:'C'}});
    return validateBridgeReport(JSON.parse(stdout))?
      result('healthy','تقرير حديث من المحرك المعزول؛ لا يثبت تشغيل بث العملاء'):
      result('error','المحرك أبلغ عن حالة متدهورة');
  }catch{return result('offline','تعذر التحقق من تقرير المحرك أو الاتصال المشفر');}
  finally{if(dir)await rm(dir,{recursive:true,force:true}).catch(()=>{});}
}
