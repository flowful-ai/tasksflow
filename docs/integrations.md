# GitHub and Slack setup

Both integrations are optional. Their environment variables are listed in [configuration.md](configuration.md).

## GitHub App

FlowTask uses a GitHub App (separate from the OAuth app used for sign-in).

1. Create an App at <https://github.com/settings/apps/new> (or under your organization).
2. **Callback URLs**: add `https://<your-domain>/api/github/callback` (and keep `https://<your-domain>/api/auth/callback/github` if this App also handles GitHub sign-in), and tick **Request user authorization (OAuth) during installation**. FlowTask refuses installations without this step: it checks that the installing user can access the installation.
3. **Webhook**: active, URL `https://<your-domain>/api/webhooks/github`, and a random **webhook secret** (`openssl rand -hex 32`).
4. **Repository permissions**: Issues: Read and write; Pull requests: Read-only; Metadata: Read-only.
5. **Subscribe to events**: Issues, Issue comment, Pull request.
6. Generate a private key and note the App ID, the Client ID, a new client secret and the App slug (from its public URL).
7. Set `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_SLUG` and `VITE_GITHUB_APP_SLUG`.

Then, in a project's settings, install the App and link repositories. Issues and PRs become tasks; changes to a linked task's title, description, state, priority and labels, and new comments, are written back to GitHub.

## Slack app

Slack gets notifications only (task created, state changed, assigned, comment added); FlowTask never creates tasks from Slack.

1. Create an app at <https://api.slack.com/apps>.
2. **OAuth & Permissions**: add the redirect URL `https://<your-domain>/api/webhooks/slack/oauth` and the bot scopes `chat:write`, `chat:write.public`, `channels:read`, `groups:read` and `incoming-webhook`.
3. Optional: a slash command or Event Subscriptions pointing at `https://<your-domain>/api/webhooks/slack` (slash commands answer with help text; events are acknowledged and ignored).
4. Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_SIGNING_SECRET` (from **Basic Information**).
5. In a project's settings, click **Add to Slack** and pick the channel. The bot token is stored per project, encrypted.
