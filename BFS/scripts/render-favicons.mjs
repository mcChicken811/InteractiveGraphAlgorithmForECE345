// Renders icons/favicon-{light,dark}.svg to 64×64 PNGs (fallbacks for browsers without
// SVG favicon support, e.g. Safari). Run after editing the SVGs: npm run icons
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SIZE = 64;
const dir = fileURLToPath(new URL('../icons/', import.meta.url));

// Uses the installed Google Chrome, like `npm run test:e2e:local`.
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
for (const theme of ['light', 'dark']) {
  const svg = await readFile(`${dir}favicon-${theme}.svg`, 'utf8');
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${SIZE}px;height:${SIZE}px}</style>${svg}`,
  );
  await page.screenshot({ path: `${dir}favicon-${theme}.png`, omitBackground: true });
  console.log(`icons/favicon-${theme}.png`);
}
await browser.close();
