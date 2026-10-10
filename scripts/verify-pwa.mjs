import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const prefix = '/codex-orchestrator/';
const types = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname;
  if (!name.startsWith(prefix)) {
    res.writeHead(404);
    res.end();
    return;
  }
  const file = path.resolve(
    'dist',
    decodeURIComponent(name.slice(prefix.length)) || 'index.html',
  );
  if (!file.startsWith(path.resolve('dist') + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const content = await readFile(file);
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}${prefix}`;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page
    .getByRole('heading', { name: 'What are we working on?' })
    .waitFor();
  await page.evaluate(() => navigator.serviceWorker.ready);
  const manifest = await (
    await context.request.get(url + 'manifest.webmanifest')
  ).json();
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    assert.equal((await context.request.get(url + icon.src)).status(), 200);
  }
  await context.setOffline(true);
  await page.reload();
  await page
    .getByRole('heading', { name: 'What are we working on?' })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'Passed: repository subpath, service-worker activation, install manifest/icons, and offline reload.',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
