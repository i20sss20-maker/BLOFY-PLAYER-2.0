// Isolated synthetic handoff QA, not a provider capacity or production controller.
// Each acknowledgement must already have been authenticated by the transport.
export function createSyntheticHandoffQa(){
 let state='idle',engine=null;
 return {
  next(){
   if(state==='idle')return {engineId:'hostbrr',operation:'qa-start'};
   if(state==='primary-ready')return {engineId:'hostbrr',operation:'qa-stop'};
   if(state==='primary-stopped')return {engineId:'linode',operation:'qa-start'};
   if(state==='backup-ready')return {engineId:'linode',operation:'qa-stop'};
   return null;
  },
  acknowledge(proof){
   const cmd=this.next();
   if(!cmd||proof?.scope!=='synthetic-only'||proof.engineId!==cmd.engineId||proof.operation!==cmd.operation||proof.verified!==true)return false;
   if(cmd.operation==='qa-start'){
    if(proof.status!=='synthetic_hls_ready'||engine!==null)return false;
    engine=cmd.engineId;state=engine==='hostbrr'?'primary-ready':'backup-ready';
   }else{
    if(proof.status!=='synthetic_stopped'||engine!==cmd.engineId)return false;
    engine=null;state=cmd.engineId==='hostbrr'?'primary-stopped':'passed';
   }
   return true;
  },
  uncertain(){state='hold'},
  snapshot(){return {state,engine,scope:'synthetic-only'}}
 };
}
