import { xtreamTransportReason } from './xtream-core.mjs';

// Only fixed machine-readable codes can cross the admin boundary. Never
// expose provider URLs, embedded playlist passwords, HTTP response bodies,
// socket addresses or raw nested exception messages.
const TRANSPORT_MAP=Object.freeze({
  xtream_dns_failure:'xtream_m3u_dns_failure',
  xtream_connection_refused:'xtream_m3u_connection_refused',
  xtream_connect_timeout:'xtream_m3u_connect_timeout',
  xtream_network_unreachable:'xtream_m3u_network_unreachable',
  xtream_connection_reset:'xtream_m3u_connection_reset',
  xtream_tls_failure:'xtream_m3u_tls_failure',
  xtream_transport_failed:'xtream_m3u_connection_failed'
});
export function safeXtreamM3uFailure(error){
  const code=String(error?.message||'');
  if(/^xtream_m3u_[a-z0-9_]{1,72}$/.test(code))return code;
  const transport=xtreamTransportReason(error);
  return TRANSPORT_MAP[transport]||'xtream_m3u_index_unavailable';
}
