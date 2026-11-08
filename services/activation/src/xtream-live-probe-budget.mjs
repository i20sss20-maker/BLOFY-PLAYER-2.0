// The admin's live media check used to abort after 4.5s, while production
// playback allows materially longer for headers and first bytes. This caused
// false "source timeout" diagnostics for slow-start channels. Keep the entire
// admin scan within its 11.5s budget and leave time for a second sample.
export function liveDiagnosticTimeoutMs(remainingMs){
  const n=Number(remainingMs);
  if(!Number.isFinite(n))return 1200;
  return Math.max(1200,Math.min(9000,Math.trunc(n)-1000));
}
