// Only trusted results returned by our own bounded, first-byte admin probes.
// Provider 404 is final on original same-file URL after the relay's own
// Range/plain-GET compatibility checks; unrelated 502s remain transient.
export function operatorMediaRegistryOutcome(probe){
 if(!probe||typeof probe!=='object')return null;
 if(probe.httpStatus===502&&probe.error==='relay_provider_not_found')
  return 'missing';
 if(probe.httpStatus===404)return 'missing';
 if(probe.ok===true&&[200,206].includes(probe.httpStatus))
  return 'recovered';
 return null;
}
