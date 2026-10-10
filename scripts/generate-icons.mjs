import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {}) });
const page = await browser.newPage();
const svg = await readFile('public/icons/icon.svg', 'utf8');
for (const size of [192,512]) {
  await page.setViewportSize({width:size,height:size});
  await page.setContent(`<style>body{margin:0;background:#315bec}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
  await page.screenshot({path:`public/icons/icon-${size}.png`});
}
await browser.close();
