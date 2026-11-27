import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {probeEngineStatus} from '../../src/blofy-engine-status-ssh-qa.mjs';
const hosts={
 linode:{hostKey:'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAID61WNbA7/YGqca0kBjqmBfVxgFh7F3aPmKVueA9Wi27',worker:'MCowBQYDK2VwAyEArpMic8QQuCg/6+q89qmP6cslqKPBfRI/MjGfbvsCUcA='},
 hostbrr:{hostKey:'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHSBGorEVeW0D+F0c5IIdnJ/aQAfIaoIGRo7dhGr6/Js',worker:'MCowBQYDK2VwAyEAgix7KGEHl4YmO9+1wga6rWt2Ocz80nCszBOgHC0KVeE='}
};
if(process.env.BLOFY_ENGINE_QA_RUN!=='1'){console.log('QA_DISABLED');process.exit(0);}
process.umask(0o077);
const dir=await mkdtemp(join(tmpdir(),'blofy-ephemeral-'));
try{
 const configs=[];
 for(const [engineId,conf] of Object.entries(hosts)){
  const path=join(dir,engineId);
  execFileSync('/usr/bin/ssh-keygen',['-q','-t','ed25519','-N','','-C','BLOFY-RAILWAY-QA-'+engineId,'-f',path],{stdio:'ignore',timeout:5000});
  console.log('QA_PUBLIC_KEY '+engineId+' '+(await readFile(path+'.pub','utf8')).trim());
  configs.push({engineId,identity:await readFile(path,'utf8'),hostKey:conf.hostKey,workerPublicKey:'-----BEGIN PUBLIC KEY-----\n'+conf.worker+'\n-----END PUBLIC KEY-----\n'});
 }
 const end=Date.now()+15*60*1000;
 while(Date.now()<end){
  const results=await Promise.all(configs.map(c=>probeEngineStatus(c)));
  console.log('QA_STATUS '+JSON.stringify(results));
  if(results.every(x=>x.ok&&x.deliveryActive&&x.heartbeatActive)){console.log('BLOFY_RAILWAY_STATUS_QA_PASS');break;}
  await delay(20000);
 }
}finally{await rm(dir,{recursive:true,force:true});}
console.log('QA_FINISHED_KEYS_DESTROYED');
