import { expect, test } from '@playwright/test';
import type { AppState } from '../../src/types';

const state: AppState = {
  workspaces: [
    {
      id: 'w1',
      name: 'Website',
      path: '/tmp/website',
      documents: [{ name: 'README.md', text: 'A personal website.' }],
      indexedAt: new Date().toISOString(),
    },
  ],
  sessions: [],
  config: { routerUrl: 'http://127.0.0.1:4000/v1', decisionModel: 'router' },
  codexConnected: true,
};
test('empty state, settings, mobile layout and workspace navigation', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'What are we working on?' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send task' })).toBeDisabled();
  await page.getByRole('button', { name: 'Connect companion' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Companion URL').fill('http://127.0.0.1:4317');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole('heading', { name: 'What are we working on?' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/overview.png', fullPage: true });
});
test('paired task flow shows results and routing decisions', async ({
  page,
}) => {
  const current = structuredClone(state);
  await page.addInitScript(() => {
    sessionStorage.setItem('orbit-token', 'test-token');
  });
  await page.route('http://127.0.0.1:4317/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': 'http://127.0.0.1:5187',
          'Access-Control-Allow-Headers': 'Authorization,Content-Type',
          'Access-Control-Allow-Methods': 'GET,POST,PATCH',
        },
      });
      return;
    }
    if (url.pathname === '/api/messages' && request.method() === 'POST') {
      current.sessions = [
        {
          id: 's1',
          title: 'Improve the website',
          status: 'completed',
          archived: false,
          workspaceId: 'w1',
          workspaceName: 'Website',
          updatedAt: new Date().toISOString(),
          decisions: [
            {
              workspaceId: 'w1',
              workspaceName: 'Website',
              model: 'test-codex',
              effort: 'medium',
              confidence: 0.92,
              reason: 'The website workspace owns the requested pages.',
              decisionModel: 'router',
              durationMs: 400,
              choices: [
                {
                  name: 'workspace',
                  choice: 'w1',
                  confidence: 0.92,
                  probabilities: [
                    { value: 'w1', probability: 1, label: 'Website' },
                  ],
                },
              ],
              sources: ['README.md'],
              decidedAt: new Date().toISOString(),
            },
          ],
          messages: [
            { id: 'u1', role: 'user', text: 'Improve the website' },
            {
              id: 'a1',
              role: 'assistant',
              text: 'Updated the homepage and verified the responsive layout.',
            },
          ],
          activity: [],
          approvals: [],
        },
      ];
      await route.fulfill({
        json: current.sessions[0],
        headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:5187' },
      });
      return;
    }
    await route.fulfill({
      json: current,
      headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:5187' },
    });
  });
  await page.routeWebSocket('ws://127.0.0.1:4317/events', (ws) => {
    ws.onMessage(() => {
      ws.send(JSON.stringify({ type: 'state', state: current }));
    });
  });
  await page.goto('/');
  await expect(
    page.getByText('Local connected', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('New task').fill('Improve the website');
  await page.getByRole('button', { name: 'Send task' }).click();
  // Reconnect triggers a fresh snapshot, like the companion's live broadcast.
  await page.reload();
  await page
    .getByRole('button')
    .filter({ hasText: 'Improve the website' })
    .click();
  await expect(
    page.getByText('Updated the homepage and verified the responsive layout.'),
  ).toBeVisible();
  await expect(
    page.getByText('The website workspace owns the requested pages.'),
  ).toBeVisible();
  await expect(page.getByText('92% confidence', { exact: true })).toBeVisible();
  await page.getByText('Decisions API evidence', { exact: true }).click();
  await expect(page.getByText('Website: 100% · selected')).toBeVisible();
  await page.screenshot({ path: 'test-results/session.png', fullPage: true });
});

test('workspace discovery lets the user register a project and inspect indexed context', async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem('orbit-token', 'test-token'),
  );
  const current = structuredClone(state);
  let broadcast: ((data: string) => void) | undefined;
  await page.routeWebSocket('ws://127.0.0.1:4317/events', (socket) => {
    broadcast = (data) => socket.send(data);
    socket.onMessage(() =>
      socket.send(JSON.stringify({ type: 'state', state: current })),
    );
  });
  await page.route('http://127.0.0.1:4317/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      'Access-Control-Allow-Origin': 'http://127.0.0.1:5187',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    if (url.pathname === '/api/workspaces/scan') {
      expect(request.postDataJSON()).toEqual({ path: '/tmp/projects' });
      await route.fulfill({
        headers,
        json: {
          candidates: [
            { name: 'Payments', path: '/tmp/projects/payments', kind: 'git' },
          ],
          truncated: false,
        },
      });
      return;
    }
    if (url.pathname === '/api/workspaces' && request.method() === 'POST') {
      const workspace = {
        id: 'w2',
        name: 'Payments',
        path: '/tmp/projects/payments',
        documents: [
          {
            name: 'docs/ARCHITECTURE.md',
            text: 'Refund reconciliation ownership.',
          },
        ],
        files: ['src/refunds.ts', 'docs/ARCHITECTURE.md'],
        context: { bytes: 32, truncated: false },
        indexedAt: new Date().toISOString(),
      };
      current.workspaces.push(workspace);
      broadcast?.(JSON.stringify({ type: 'state', state: current }));
      await route.fulfill({ headers, json: workspace });
      return;
    }
    await route.fulfill({ headers, json: current });
  });
  await page.goto('/');
  await expect(
    page.getByText('Local connected', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: /Workspaces/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Add workspace', exact: true })
    .last()
    .click();
  await page.getByLabel('Absolute folder path').fill('/tmp/projects');
  await page.getByRole('button', { name: 'Scan for projects' }).click();
  await expect(
    page.getByText('/tmp/projects/payments', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Added', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  const card = page.locator('.workspace-card').filter({
    has: page.getByRole('heading', { name: 'Payments', exact: true }),
  });
  await card.getByRole('button', { name: 'View routing context' }).click();
  await expect(
    card.getByText('src/refunds.ts', { exact: false }),
  ).toBeVisible();
  await expect(
    card.getByText('Refund reconciliation ownership.'),
  ).toBeVisible();
});
