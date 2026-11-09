/**
 * Route-level webhook tests. The database-backed ones are skipped unless
 * TEST_DATABASE_URL is set.
 */
import { describe, expect, spyOn, test } from 'bun:test';
import { createHmac, randomUUID } from 'crypto';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
const SECRET = 'webhook-test-secret';

function sign(body: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
}

async function loadRoutes() {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.GITHUB_WEBHOOK_SECRET = SECRET;
  const { webhookRoutes } = await import('./webhooks.js');
  return webhookRoutes;
}

function issuesDelivery(deliveryId: string, body: string, signature = sign(body)): Request {
  return new Request('http://localhost/github', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'issues',
      'x-github-delivery': deliveryId,
      'x-hub-signature-256': signature,
    },
    body,
  });
}

const body = JSON.stringify({
  action: 'opened',
  issue: {
    id: 1,
    number: 1,
    title: 'x',
    body: null,
    html_url: 'https://github.com/nobody-links-this/repo/issues/1',
    state: 'open',
    labels: [],
  },
  repository: {
    id: 1,
    name: 'repo',
    full_name: 'nobody-links-this/repo',
    owner: { login: 'nobody-links-this' },
  },
  sender: { login: 'octocat', id: 1 },
  installation: { id: 1 },
});

describeDb('POST /api/webhooks/github', () => {
  test('rejects a bad signature', async () => {
    const routes = await loadRoutes();
    const res = await routes.request(issuesDelivery(randomUUID(), body, sign(`${body} `)));
    expect(res.status).toBe(401);
  });

  test('deduplicates on X-GitHub-Delivery', async () => {
    const routes = await loadRoutes();
    const deliveryId = randomUUID();

    const first = await routes.request(issuesDelivery(deliveryId, body));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ reason: 'No matching integration found' });

    const second = await routes.request(issuesDelivery(deliveryId, body));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ status: 'ignored', reason: 'Duplicate delivery' });
  });

  test('releases the delivery id when the target lookup throws', async () => {
    const routes = await loadRoutes();
    const integrations = await import('../integrations/index.js');
    const deliveryId = randomUUID();

    const lookup = spyOn(integrations, 'findGitHubTargetsForRepo').mockRejectedValueOnce(
      new Error('connection reset')
    );
    try {
      const first = await routes.request(issuesDelivery(deliveryId, body));
      expect(first.status).toBe(500);
    } finally {
      lookup.mockRestore();
    }

    // GitHub's retry is processed, not dropped as a duplicate.
    const retry = await routes.request(issuesDelivery(deliveryId, body));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ reason: 'No matching integration found' });
  });
});
