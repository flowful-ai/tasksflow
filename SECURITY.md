# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub: **Security → Report a vulnerability** on <https://github.com/flowful-ai/tasksflow> (a private security advisory). Include the affected version or commit, the steps to reproduce, and the impact you expect. We aim to acknowledge reports within a few working days and will keep you informed while we fix it. We credit reporters in the advisory unless you prefer otherwise.

## Supported versions

| Version                    | Supported |
| -------------------------- | --------- |
| 2.x (`v2` branch / `main`) | Yes       |
| 1.x                        | No        |

Fixes land on the latest release only. Self-hosters should redeploy from the latest commit.

## Security model (summary)

**Authentication**

- Sign-up is GitHub or Google OAuth only (Better Auth); email/password sign-up is disabled, and existing password accounts can still sign in. Implicit account linking requires a provider-verified email that matches a verified local email.
- Sessions are cookies signed with `BETTER_AUTH_SECRET`. Auth endpoints are rate limited in Postgres, keyed on a client IP the server resolves from `X-Forwarded-For` with `TRUSTED_PROXY_HOPS` (client-sent values are overwritten).
- In production only `WEB_URL` and `BETTER_AUTH_URL` are trusted origins for CORS and auth.

**Authorization**

- Every route resolves the resource to its workspace and checks membership, the project ACL (`all`, `members`, `admin`) and the role permission (`owner`, `admin`, `member`) through one `AuthorizationService`. Resources outside the caller's reach return 404.
- Only owners can grant, revoke or change the owner role; ownership moves with an explicit transfer.
- Realtime streams only carry events for projects the user can access, are re-checked every minute, and close as soon as a member is removed.

**MCP and AI**

- MCP access is OAuth 2.1 only: Authorization Code with PKCE (S256), dynamic client registration with strict redirect URI rules, 15-minute access tokens, 30-day rotating refresh tokens with reuse detection (reuse revokes the whole token family), and RFC 8707 resource binding. Only workspace owners and admins can authorize a client, and each grant is limited to one workspace and the tools selected on the consent page.
- Every tool call checks the grant, the role permission and the project ACL, and validates arguments against the tool's JSON Schema.
- Text written by users or synced from GitHub is returned to models as `{ "untrusted_text": "…" }`. In the in-app chat, tools that change data require the user's approval, and Markdown images are never loaded.

**Data at rest**

- AI provider keys are encrypted with AES-256-GCM using `API_KEY_ENCRYPTION_KEY`; Slack bot tokens with `INTEGRATION_ENCRYPTION_KEY` (default: the same key).
- Public share passwords are bcrypt-hashed and attempts are limited per share and per IP.

**Integrations and webhooks**

- GitHub webhooks are verified with `GITHUB_WEBHOOK_SECRET` (HMAC-SHA256) and deduplicated by delivery id. Installing the GitHub App requires a session-bound state nonce and the installing user's OAuth code, checked against the user's installations.
- Slack requests are verified with `SLACK_SIGNING_SECRET`, with a timestamp window.
- Outgoing webhooks are signed (`X-FlowTask-Signature: sha256=<HMAC of "<timestamp>.<body>">`) and blocked from private, loopback and link-local addresses unless `ALLOW_PRIVATE_WEBHOOK_TARGETS=true`.

**HTTP**

- Content Security Policy on the SPA, HSTS in production, `X-Content-Type-Options: nosniff`, a `Referrer-Policy`, and framing denied.
- Request bodies are limited to 1 MB (5 MB for incoming webhooks). Logs redact share and invitation tokens and OAuth query parameters.
- Internal errors return a generic message; details stay in the server log.
