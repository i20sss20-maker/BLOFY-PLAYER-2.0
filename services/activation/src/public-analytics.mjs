// Google Analytics is optional and limited to the public website, never device pairing.
export const PUBLIC_ANALYTICS_SCRIPT = '<script src="/public-analytics.js" defer></script>';

export const PUBLIC_ANALYTICS_CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; " +
  "connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com https://www.googletagmanager.com; " +
  "img-src 'self' data: https://www.google-analytics.com https://region1.google-analytics.com; " +
  "frame-ancestors 'none'";

export function withPublicAnalytics(html) {
  if (html.includes(PUBLIC_ANALYTICS_SCRIPT)) return html;
  if (!html.includes('</head>')) throw new Error('public_analytics_head_missing');
  return html.replace('</head>', `  ${PUBLIC_ANALYTICS_SCRIPT}\n</head>`);
}
