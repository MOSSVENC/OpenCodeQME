# OpenCode Console API compatibility

OpenCode replaced the old `/workspace/<id>/go` HTML and `/_server` data path in September 2026.
OpenCodeQME now prefers the authenticated Console API and keeps the old implementation only as fallback.

## Workspace discovery

- `GET /console/api/me/orgs`
- The selected workspace ID is sent as the `x-org-id` header on scoped requests.

## Go quota

- `GET /console/api/go/status?fresh=true`
- Response fields:
  - `access.meters.fiveHour`
  - `access.meters.week`
  - `access.meters.month`
- Each meter contains `usedMicroCents`, `limitMicroCents`, and `resetsAt`.

## Usage aggregates

- `GET /console/api/usage/summary?range=30d`
- `GET /console/api/usage/models?range=30d&page=1&pageSize=100&costOrder=desc`
- `GET /console/api/usage/cost-by-day?range=30d&bucket=day`

The new console exposes daily and per-model aggregates rather than the old per-request usage list.
Cost values are micro-cents: `1 USD = 100,000,000 micro-cents`.

## Authentication

The extension uses the user's existing `opencode.ai` browser session with `credentials: include`.
No cookie values are stored by the extension.
