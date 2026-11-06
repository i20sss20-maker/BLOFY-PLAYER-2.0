// Prevent repeated expensive playback requests to a single channel after the
// source explicitly rejected it. This never changes identities, redirects,
// IP addresses or authorization. A working channel is never disabled because
// another channel was rejected.
const DENIED=new Set([403,456]);

export class XtreamDenialCooldown {
  constructor({windowMs=60000,cooldownMs=45000,threshold=2,maxEntries=1800}={}){
    this.windowMs=windowMs;
    this.cooldownMs=cooldownMs;
    this.threshold=threshold;
    this.maxEntries=maxEntries;
    this.entries=new Map();
  }
  active(key,now=Date.now()){
    const state=this.entries.get(String(key));
    if(!state)return null;
    if(state.until>now)return {status:state.status,retryAfterSeconds:Math.max(1,Math.ceil((state.until-now)/1000))};
    if(now-state.first>this.windowMs||state.until)this.entries.delete(String(key));
    return null;
  }
  denied(key,status,now=Date.now()){
    if(!DENIED.has(status))return false;
    const id=String(key);
    const previous=this.entries.get(id);
    const seen=previous&&previous.status===status&&now-previous.first<this.windowMs?
      {first:previous.first,count:previous.count+1}: {first:now,count:1};
    if(seen.count>=this.threshold)seen.until=now+this.cooldownMs;
    else seen.until=0;
    seen.status=status;
    this.entries.delete(id);
    this.entries.set(id,seen);
    while(this.entries.size>this.maxEntries)
      this.entries.delete(this.entries.keys().next().value);
    return Boolean(seen.until);
  }
  clear(key){this.entries.delete(String(key));}
  get size(){return this.entries.size;}
}
