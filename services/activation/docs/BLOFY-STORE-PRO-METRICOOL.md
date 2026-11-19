# BLOFY STORE PRO — official Metricool read-only connection

## Connection modes

BLOFY currently has a ChatGPT-connected Metricool brand (observed 2026-11-19):
- brand/blog ID 8052229; user ID 6325113; timezone Asia/Riyadh;
- TikTok (@i.20as) was the only attached publishing network in the brand settings;
- X and Instagram should never be described as connected or automatically publishable
  without a fresh network-settings check.

**Important:** ChatGPT's authenticated Metricool plugin does not automatically
grant the BLOFY website an API token. The direct API is a separate integration.
As documented by Metricool, API tokens require an Advanced or Custom plan.
The standard connected plugin/MCP may work even on the Free plan.

## Safe read-only site integration

The authenticated owner endpoint
`GET /api/v1/admin/store/metricool` reads the upcoming 30-day calendar
from the documented official Metricool endpoint:

`https://app.metricool.com/api/v2/scheduler/posts`

The request always uses exactly one fixed host, a GET only, and parameterized
`userId`, `blogId`, `start`, `end`, `timezone`, with the provider
token in the server-side `X-Mc-Auth` header. No browser API key is used.

Configuration is deliberately off by default:

- `BLOFY_METRICOOL_API_ENABLED=true`
- `BLOFY_METRICOOL_API_TOKEN` — store in Railway secrets only
- `BLOFY_METRICOOL_USER_ID=6325113`
- `BLOFY_METRICOOL_BLOG_ID=8052229`

The owner UI displays only scheduled-post counts, network status metadata,
truncated text previews, and warnings for the **IPTV** keyword. Raw API
responses, media URLs, access tokens, and account IDs are not sent to the UI.
The connector never schedules or changes posts, and does not attribute sales.

When the API is unconfigured, owner UI accurately displays "not enabled".
No fake campaign history, X/Instagram connections, or published-post totals.

## Operational plan

1. Review pending TikTok posts in the Metricool planner, including wording
   and media, before automatic publishing. Never auto-delete or rewrite an
   already-approved post without an explicit owner instruction.
2. Obtain a dedicated Metricool API token only if the plan supports it. Do not
   reuse or expose credentials from ChatGPT or TikTok.
3. Test the GET API endpoint on a non-production environment and check 429,
   invalid token, missing media, empty calendar, and real post status.
4. Confirm scheduling and approval workflows independently of ecommerce
   checkout. For automation, introduce an additional explicit-reviewed draft
   creation flow later, never auto-publish customer data or promotional messages.
5. Review performance and mobile layout on actual iOS Safari and Android Chrome.

Source: https://help.metricool.com/basic-guide-for-api-integration-r97af
