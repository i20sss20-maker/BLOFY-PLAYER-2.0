// Preserve pool sizing, credentials and TLS settings. Railway private PostgreSQL
// can exhaust container /dev/shm on parallel query workers even with free RAM.
// Constrain only these sessions; do not restart or alter the database itself.
export function privateDbPoolOptions(connectionString, env=process.env){
 let url;
 try{url=new URL(connectionString)}catch{return {connectionString}}
 if(!['postgres:','postgresql:'].includes(url.protocol)||
    !url.hostname.endsWith('.railway.internal')||
    env.BLOFY_POSTGRES_PARALLEL_GATHER_SAFE_MODE==='0')
  return {connectionString};
 const existing=url.searchParams.getAll('options').join(' ').trim();
 url.searchParams.delete('options');
 return {connectionString:url.toString(),
  options:[existing,'-c max_parallel_workers_per_gather=0'].filter(Boolean).join(' ')};
}
