import {randomBytes} from 'node:crypto';
import {signStatusCommand} from './blofy-engine-status-command.mjs';
import {verifyWorkerStatus} from './blofy-engine-status-response.mjs';
// Single-process, read-only QA coordinator, NOT a production or multi-replica ledger.
// Network adapter must authenticate the worker independently before calling either method.
export function createStatusPollQa({controllerKey,workerKeys,clock=Date.now}={}){
 const pending=new Map();
 function validEngine(id){return ['linode','hostbrr'].includes(id)&&Object.hasOwn(workerKeys??{},id)}
 function poll(authenticatedEngine){
  if(!validEngine(authenticatedEngine))return null;
  const now=clock(), old=pending.get(authenticatedEngine);
  if(old&&old.command.expiresAt>now)return old;
  const command={version:1,engineId:authenticatedEngine,operation:'status',challenge:randomBytes(16).toString('hex'),issuedAt:now,expiresAt:now+25000};
  const signed=signStatusCommand(command,controllerKey,now);
  Object.freeze(signed.command);Object.freeze(signed);
  pending.set(authenticatedEngine,signed);
  return signed;
 }
 function complete(authenticatedEngine,response){
  if(!validEngine(authenticatedEngine))return {ok:false};
  const p=pending.get(authenticatedEngine),now=clock();
  if(!p||p.command.expiresAt<=now)return {ok:false};
  if(!verifyWorkerStatus(response,{publicKey:workerKeys[authenticatedEngine],engineId:authenticatedEngine,challenge:p.command.challenge,now})||
    response.status.observedAt<p.command.issuedAt-2000)return {ok:false};
  pending.delete(authenticatedEngine);
  return {ok:true,engineId:authenticatedEngine,deliveryActive:response.status.deliveryActive,heartbeatActive:response.status.heartbeatActive};
 }
 return {poll,complete};
}
