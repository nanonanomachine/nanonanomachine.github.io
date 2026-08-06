// Render the Open Graph cards and the apple-touch icon.
//
// Deliberately NOT part of `npm run build`: it needs a browser, and the CI
// deploy stays a plain `npm ci && eleventy`. Run it by hand when you add a
// post, then commit the PNGs it writes into src/static/.
//
//   npx playwright@latest install chromium   # once
//   node scripts/og.mjs
//
// Cards are read from src/posts/*.md frontmatter, so adding a post and
// re-running is all it takes.

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STATIC = path.join(ROOT, 'src', 'static');
const site = JSON.parse(await fs.readFile(path.join(ROOT, 'src/_data/site.json'), 'utf8'));

const INK = '#E6E8EB';
const PAPER = '#0E1013';
const MUTED = '#8C949E';
const SIGNAL = '#FF6AA0';

// Single quotes inside the stacks on purpose: these strings go into a
// style="..." attribute, and a double quote would terminate it early — which
// silently drops every declaration in that attribute.
const DISPLAY =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const MONO =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";
const SERIF = "ui-serif, 'Iowan Old Style', Palatino, Georgia, serif";

/** Longer titles need to step down or they overflow 630px of height. */
function titleSize(text) {
  if (text.length > 90) return 56;
  if (text.length > 60) return 66;
  return 78;
}

const card = (title, subtitle) => `
<div style="
  width:1200px;height:630px;background:${PAPER};color:${INK};
  box-sizing:border-box;padding:76px 88px;display:flex;flex-direction:column;
  justify-content:space-between;font-family:${DISPLAY};">
  <div>
    <div style="height:4px;width:120px;background:${SIGNAL};margin-bottom:52px;"></div>
    <div style="
      font-family:${DISPLAY};font-size:${titleSize(title)}px;font-weight:700;
      letter-spacing:-0.03em;line-height:1.08;">${title}</div>
    <div style="
      font-family:${SERIF};font-size:27px;color:${MUTED};
      line-height:1.45;margin-top:30px;max-width:900px;">${subtitle}</div>
  </div>
  <div style="
    font-family:${MONO};font-size:21px;color:${MUTED};
    display:flex;justify-content:space-between;align-items:baseline;">
    <span style="color:${INK};">${site.author}</span>
    <span>${site.url.replace('https://', '')}</span>
  </div>
</div>`;

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Minimal frontmatter reader — these files are ours and always start with ---. */
function frontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });

await fs.mkdir(path.join(STATIC, 'og'), { recursive: true });

const jobs = [['default', site.author, site.description]];
for (const file of await fs.readdir(path.join(ROOT, 'src/posts'))) {
  if (!file.endsWith('.md')) continue;
  const fm = frontmatter(await fs.readFile(path.join(ROOT, 'src/posts', file), 'utf8'));
  if (fm.title) jobs.push([file.replace(/\.md$/, ''), fm.title, fm.dek ?? '']);
}

for (const [slug, title, subtitle] of jobs) {
  await page.setContent(card(esc(title), esc(subtitle)));
  const out = path.join(STATIC, 'og', `${slug}.png`);
  await page.locator('div').first().screenshot({ path: out });
  console.log(`og/${slug}.png  ${title.slice(0, 60)}`);
}

// apple-touch-icon, rendered from the same SVG the browser tab uses.
const svg = await fs.readFile(path.join(STATIC, 'favicon.svg'), 'utf8');
const icon = await browser.newPage({ viewport: { width: 180, height: 180 } });
await icon.setContent(
  `<div style="margin:0;width:180px;height:180px;background:${PAPER}">${svg.replace('width="32" height="32"', 'width="180" height="180"')}</div>`,
);
await icon.locator('div').first().screenshot({ path: path.join(STATIC, 'apple-touch-icon.png') });
console.log('apple-touch-icon.png');

await browser.close();
