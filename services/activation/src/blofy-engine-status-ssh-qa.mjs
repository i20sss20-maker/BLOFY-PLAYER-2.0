import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createPublicKey,randomBytes} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyWorkerStatus} from './blofy-engine-status-response.mjs';
const run=promisify(execFile);
const hosts=Object.freeze({linode:'172.239.239.142',hostbrr:'77.90.2.179'});
export async function probeEngineStatus({engineId,identity,hostKey,workerPublicKey,execute=run,clock=Date.now}={}){
 const fail=reason=>({ok:false,reason});
 if(!Object.hasOwn(hosts,engineId))return fail('invalid_engine');
 if(typeof identity!=='string'||identity.length>8192||!/^-----BEGIN OPENSSH PRIVATE KEY-----\r?\n/.test(identity)||
    typeof hostKey!=='string'||!/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/.test(hostKey)||hostKey.length>256||
    typeof workerPublicKey!=='string'||workerPublicKey.length>512)return fail('invalid_identity');
 let dir;
 try{
  const publicKey=createPublicKey(workerPublicKey);
  if(publicKey.asymmetricKeyType!=='ed25519')return fail('invalid_worker_key');
  dir=await mkdtemp(join(tmpdir(),'blofy-control-qa-'));
  const key=join(dir,'identity'),known=join(dir,'known_hosts');
  await writeFile(key,identity,{mode:0o600});
  await writeFile(known,hosts[engineId]+' '+hostKey+'\n',{mode:0o600});
  const challenge=randomBytes(16).toString('hex');
  const start=clock();
  const {stdout}=await execute('/usr/bin/ssh',['-F','/dev/null','-T','-i',key,
   '-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','IdentityAgent=none',
   '-o','StrictHostKeyChecking=yes','-o','HostKeyAlgorithms=ssh-ed25519',
   '-o','UserKnownHostsFile='+known,'-o','GlobalKnownHostsFile=/dev/null',
   '-o','ClearAllForwardings=yes','-o','ConnectTimeout=4',
   '-o','PasswordAuthentication=no','-o','KbdInteractiveAuthentication=no',
   'blofycontrolqa@'+hosts[engineId],'status '+challenge],
   {timeout:8000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin',LANG:'C'}});
  const now=clock();
  if(typeof stdout!=='string'||stdout.length>4096||now-start>10000||now<start)return fail('status_timeout');
  const e=JSON.parse(stdout);
  if(!verifyWorkerStatus(e,{publicKey,engineId,challenge,now})||e.status.observedAt<start-2000)return fail('unverified_status');
  return {ok:true,engineId,deliveryActive:e.status.deliveryActive,heartbeatActive:e.status.heartbeatActive};
 }catch{return fail('status_unavailable')}
 finally{if(dir)await rm(dir,{recursive:true,force:true}).catch(()=>{});}
}
// QA only. Requires a separate non-root forced-command SSH account and pinned
// SSH host key. No shell, start, stop, provider request, production route or
// admission decision is implemented. SSH authentication protects the request.
