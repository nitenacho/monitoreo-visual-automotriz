import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const CONFIG = {
  strapiApiUrl: process.env.STRAPI_API_URL,
  strapiToken: process.env.STRAPI_TOKEN,
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
  reportBaseUrl: process.env.REPORT_BASE_URL || process.env.DEPLOY_URL || process.env.URL || '',
  thresholdPercent: Number(process.env.DIFF_THRESHOLD_PERCENT || 1),
  maxPages: Number(process.env.MAX_PAGES || 0),
  useSeedWhenNoStrapi: process.env.USE_SEED_WHEN_NO_STRAPI !== 'false',
  headless: process.env.HEADLESS !== 'false',
  outputDir: process.env.OUTPUT_DIR || 'reports',
  baselinesDir: process.env.BASELINE_DIR || 'baselines',
  screenshotsDir: process.env.SCREENSHOTS_DIR || 'screenshots',
  timeoutMs: Number(process.env.PAGE_TIMEOUT_MS || 90_000)
};

const DEFAULT_IGNORE_SELECTORS = [
  'iframe[src*="recaptcha"]',
  '.grecaptcha-badge',
  '[class*="cookie"]',
  '[id*="cookie"]',
  '[class*="chat"]',
  '[id*="chat"]',
  '[class*="whatsapp"]',
  '[id*="whatsapp"]',
  '.modal',
  '[role="dialog"]'
];

const SEED_PAGES = [
  ['Maxus', 'Home', 'https://www.maxus.cl', 'Home'],
  ['Maxus', 'Ficha T60', 'https://www.maxus.cl/camionetas/t60/', 'Pickup'],
  ['Maxus', 'Ficha T90', 'https://www.maxus.cl/camionetas/t90/', 'Pickup'],
  ['Maxus', 'Ficha D60', 'https://www.maxus.cl/suv/d60/', 'SUV'],
  ['Maxus', 'Ficha V80', 'https://www.maxus.cl/vans/v80/', 'Cargo'],
  ['Maxus', 'Ficha Deliver 9', 'https://www.maxus.cl/vans/deliver-9/', 'Cargo'],
  ['Kaiyi', 'Home', 'https://www.kaiyi.cl', 'Home'],
  ['Kaiyi', 'Ficha X3', 'https://www.kaiyi.cl/modelos/x3/', 'SUV'],
  ['Kaiyi', 'Ficha X3 Pro', 'https://www.kaiyi.cl/modelos/x3-pro/', 'SUV'],
  ['Soueast', 'Home', 'https://www.soueast.cl', 'Home'],
  ['Soueast', 'Ficha DX3', 'https://www.soueast.cl/modelos/dx3/', 'SUV'],
  ['Soueast', 'Ficha DX7', 'https://www.soueast.cl/modelos/dx7/', 'SUV'],
  ['Jetour', 'Home', 'https://www.jetour.cl', 'Home'],
  ['Jetour', 'Ficha X70', 'https://www.jetour.cl/modelos/x70/', 'SUV'],
  ['Jetour', 'Ficha X70 Plus', 'https://www.jetour.cl/modelos/x70-plus/', 'SUV'],
  ['Jetour', 'Ficha Dashing', 'https://www.jetour.cl/modelos/dashing/', 'SUV'],
  ['Foton', 'Home', 'https://www.foton.cl', 'Home'],
  ['Foton', 'Ficha G7', 'https://www.foton.cl/camionetas/g7/', 'Pickup'],
  ['Foton', 'Ficha G9', 'https://www.foton.cl/camionetas/g9/', 'Pickup'],
  ['Foton', 'Ficha TM3', 'https://www.foton.cl/camiones-livianos/tm3/', 'Cargo'],
  ['Foton', 'Ficha eAumark', 'https://www.foton.cl/camiones-electricos/eaumark/', 'Cargo']
].map(([brand, name, url, category]) => ({ brand, name, url, category, isActive: true, viewport: 'Desktop', ignoreSelectors: [] }));

await main();

async function main() {
  await ensureDirs();
  const startedAt = new Date();
  const pages = await getPages();
  const selectedPages = CONFIG.maxPages > 0 ? pages.slice(0, CONFIG.maxPages) : pages;

  if (!selectedPages.length) {
    throw new Error('No hay páginas activas para monitorear. Revisa Strapi o habilita USE_SEED_WHEN_NO_STRAPI=true.');
  }

  const browser = await chromium.launch({ headless: CONFIG.headless });
  const results = [];

  try {
    for (const pageConfig of selectedPages) {
      const result = await monitorPage(browser, pageConfig).catch((error) => ({
        ...normalizePage(pageConfig),
        status: 'error',
        error: error.message,
        diffPercent: 0,
        changed: false
      }));
      results.push(result);
      console.log(`${result.status.toUpperCase()} ${result.brand} / ${result.name}: ${result.diffPercent?.toFixed?.(3) ?? 0}%`);
    }
  } finally {
    await browser.close();
  }

  const reportPath = await generateReport(results, { startedAt, finishedAt: new Date() });
  await notifyDiscord(results, reportPath);

  const changed = results.filter((result) => result.changed).length;
  const errors = results.filter((result) => result.status === 'error').length;
  console.log(`Reporte generado: ${reportPath}`);
  console.log(`Resumen: ${results.length} páginas, ${changed} cambios, ${errors} errores.`);
}

async function ensureDirs() {
  await Promise.all([
    fs.mkdir(CONFIG.outputDir, { recursive: true }),
    fs.mkdir(CONFIG.baselinesDir, { recursive: true }),
    fs.mkdir(CONFIG.screenshotsDir, { recursive: true }),
    fs.mkdir(path.join(CONFIG.outputDir, 'assets'), { recursive: true })
  ]);
}

async function getPages() {
  if (!CONFIG.strapiApiUrl || !CONFIG.strapiToken) {
    if (CONFIG.useSeedWhenNoStrapi) return SEED_PAGES;
    throw new Error('Faltan STRAPI_API_URL o STRAPI_TOKEN.');
  }

  const url = new URL(CONFIG.strapiApiUrl.replace(/\/$/, '') + '/api/pages');
  url.searchParams.set('filters[IsActive][$eq]', 'true');
  url.searchParams.set('populate[Brand][fields][0]', 'Name');
  url.searchParams.set('pagination[pageSize]', '100');

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${CONFIG.strapiToken}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Strapi respondió ${response.status}: ${await response.text()}`);
  }

  const json = await response.json();
  return (json.data || []).map((entry) => normalizeStrapiPage(entry)).filter((page) => page.isActive && page.url);
}

function normalizeStrapiPage(entry) {
  const attrs = entry.attributes || entry;
  const brandRaw = attrs.Brand?.data?.attributes || attrs.brand?.data?.attributes || attrs.Brand || attrs.brand || {};
  return normalizePage({
    id: entry.id,
    name: attrs.Name || attrs.name,
    url: attrs.URL || attrs.Url || attrs.url,
    isActive: attrs.IsActive ?? attrs.isActive ?? true,
    ignoreSelectors: attrs.IgnoreSelectors || attrs.ignoreSelectors || [],
    category: attrs.Category || attrs.category || 'Sin categoría',
    viewport: attrs.Viewport || attrs.viewport || 'Desktop',
    brand: brandRaw.Name || brandRaw.name || 'Sin marca'
  });
}

function normalizePage(page) {
  return {
    id: page.id,
    brand: page.brand || page.Brand || 'Sin marca',
    name: page.name || page.Name || 'Sin nombre',
    url: page.url || page.URL,
    isActive: page.isActive ?? page.IsActive ?? true,
    ignoreSelectors: parseIgnoreSelectors(page.ignoreSelectors ?? page.IgnoreSelectors),
    category: page.category || page.Category || 'Sin categoría',
    viewport: page.viewport || page.Viewport || 'Desktop'
  };
}

function parseIgnoreSelectors(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return value.split('\n').map((selector) => selector.trim()).filter(Boolean);
  }
}

async function monitorPage(browser, rawPageConfig) {
  const pageConfig = normalizePage(rawPageConfig);
  const slug = makeSlug(`${pageConfig.brand}-${pageConfig.category}-${pageConfig.name}-${pageConfig.viewport}`);
  const currentPath = path.join(CONFIG.screenshotsDir, `${slug}.png`);
  const baselinePath = path.join(CONFIG.baselinesDir, `${slug}.png`);
  const reportCurrentPath = path.join(CONFIG.outputDir, 'assets', `${slug}-current.png`);
  const reportBaselinePath = path.join(CONFIG.outputDir, 'assets', `${slug}-baseline.png`);
  const reportDiffPath = path.join(CONFIG.outputDir, 'assets', `${slug}-diff.png`);

  const context = await browser.newContext({
    viewport: getViewport(pageConfig.viewport),
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'light',
    locale: 'es-CL'
  });

  const page = await context.newPage();
  page.setDefaultTimeout(CONFIG.timeoutMs);
  page.setDefaultNavigationTimeout(CONFIG.timeoutMs);

  try {
    await page.goto(pageConfig.url, { waitUntil: 'networkidle', timeout: CONFIG.timeoutMs });
    await dismissCommonPopups(page);
    await maskSelectors(page, [...DEFAULT_IGNORE_SELECTORS, ...pageConfig.ignoreSelectors]);
    await autoScroll(page);
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => null);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(800);
    await page.screenshot({ path: currentPath, fullPage: true, animations: 'disabled' });
  } finally {
    await context.close();
  }

  const baselineExists = await exists(baselinePath);
  if (!baselineExists) {
    await fs.copyFile(currentPath, baselinePath);
    await fs.copyFile(currentPath, reportCurrentPath);
    await fs.copyFile(baselinePath, reportBaselinePath);
    await fs.copyFile(currentPath, reportDiffPath);
    return {
      ...pageConfig,
      slug,
      status: 'baseline_created',
      changed: false,
      diffPercent: 0,
      baselineImage: toReportPath(reportBaselinePath),
      currentImage: toReportPath(reportCurrentPath),
      diffImage: toReportPath(reportDiffPath)
    };
  }

  const comparison = await compareImages(baselinePath, currentPath, reportDiffPath);
  await fs.copyFile(currentPath, reportCurrentPath);
  await fs.copyFile(baselinePath, reportBaselinePath);

  return {
    ...pageConfig,
    slug,
    status: comparison.diffPercent >= CONFIG.thresholdPercent ? 'changed' : 'ok',
    changed: comparison.diffPercent >= CONFIG.thresholdPercent,
    diffPercent: comparison.diffPercent,
    diffPixels: comparison.diffPixels,
    totalPixels: comparison.totalPixels,
    baselineImage: toReportPath(reportBaselinePath),
    currentImage: toReportPath(reportCurrentPath),
    diffImage: toReportPath(reportDiffPath)
  };
}

function getViewport(viewport) {
  const normalized = String(viewport || '').toLowerCase();
  if (normalized.includes('mobile')) return { width: 390, height: 844 };
  if (normalized.includes('tablet')) return { width: 820, height: 1180 };
  return { width: 1440, height: 1200 };
}

async function dismissCommonPopups(page) {
  const labels = [/aceptar/i, /accept/i, /entendido/i, /cerrar/i, /close/i, /no gracias/i];
  for (const label of labels) {
    const locator = page.getByRole('button', { name: label }).first();
    if (await locator.isVisible().catch(() => false)) {
      await locator.click({ timeout: 1500 }).catch(() => null);
    }
  }
}

async function maskSelectors(page, selectors) {
  const uniqueSelectors = [...new Set(selectors.filter(Boolean))];
  if (!uniqueSelectors.length) return;
  await page.addStyleTag({
    content: uniqueSelectors.map((selector) => `${selector}{visibility:hidden!important;}`).join('\n')
  }).catch(() => null);
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 450;
      const delay = 180;
      const timer = setInterval(() => {
        const scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, delay);
    });
  });
}

async function compareImages(baselinePath, currentPath, diffPath) {
  const baseline = PNG.sync.read(await fs.readFile(baselinePath));
  const current = PNG.sync.read(await fs.readFile(currentPath));
  const width = Math.min(baseline.width, current.width);
  const height = Math.min(baseline.height, current.height);
  const baselineCropped = cropPng(baseline, width, height);
  const currentCropped = cropPng(current, width, height);
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(
    baselineCropped.data,
    currentCropped.data,
    diff.data,
    width,
    height,
    { threshold: 0.12, includeAA: false, diffColor: [255, 0, 255], aaColor: [255, 210, 255] }
  );
  await fs.writeFile(diffPath, PNG.sync.write(diff));
  const totalPixels = width * height;
  return { diffPixels, totalPixels, diffPercent: (diffPixels / totalPixels) * 100 };
}

function cropPng(image, width, height) {
  if (image.width === width && image.height === height) return image;
  const cropped = new PNG({ width, height });
  PNG.bitblt(image, cropped, 0, 0, width, height, 0, 0);
  return cropped;
}

async function generateReport(results, meta) {
  const grouped = groupBy(results, 'brand');
  const reportPath = path.join(CONFIG.outputDir, 'index.html');
  const summary = {
    total: results.length,
    changed: results.filter((result) => result.changed).length,
    ok: results.filter((result) => result.status === 'ok').length,
    baseline: results.filter((result) => result.status === 'baseline_created').length,
    errors: results.filter((result) => result.status === 'error').length
  };
  const isGreen = summary.total > 0 && summary.changed === 0 && summary.errors === 0 && summary.baseline === 0;
  const statusText = isGreen
    ? 'Verde: todos los screenshots son iguales a sus baselines anteriores.'
    : summary.errors > 0
      ? 'Revisar: hay URLs con error de captura.'
      : summary.baseline > 0
        ? 'Inicializando: hay baselines nuevas que deben aprobarse.'
        : 'Alerta: se detectaron diferencias visuales sobre el umbral.';

  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Dashboard Monitoreo Visual Automotriz</title>
  <style>${dashboardCss()}</style>
</head>
<body>
  <header class="hero">
    <div>
      <p class="eyebrow">Andes Motor · Visual Intelligence</p>
      <h1>Dashboard de Monitoreo Visual</h1>
      <p class="muted">Comparación automática contra baseline maestra. Última ejecución: ${escapeHtml(meta.finishedAt.toLocaleString('es-CL'))}</p>
    </div>
    <div class="scorecard ${isGreen ? 'green' : 'attention'}">
      <span>${isGreen ? '●' : summary.changed}</span>
      <small>${escapeHtml(statusText)}</small>
    </div>
  </header>

  <section class="actions">
    <button id="run-monitor" type="button">Ejecutar monitoreo manual</button>
    <span id="run-status" class="muted">El botón dispara GitHub Actions y actualiza esta URL pública al terminar el deploy.</span>
  </section>

  <section class="kpis">
    ${kpi('Páginas', summary.total)}
    ${kpi('OK', summary.ok)}
    ${kpi('Cambios', summary.changed)}
    ${kpi('Baselines nuevas', summary.baseline)}
    ${kpi('Errores', summary.errors)}
  </section>

  <main class="brands">
    ${Object.entries(grouped).map(([brand, brandResults], index) => brandSection(brand, brandResults, index === 0)).join('\n')}
  </main>

  <script>
    document.querySelectorAll('[data-brand-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('[data-brand-tab]').forEach((tab) => tab.classList.remove('active'));
        document.querySelectorAll('[data-brand-panel]').forEach((panel) => panel.hidden = true);
        button.classList.add('active');
        document.querySelector(button.dataset.brandTab).hidden = false;
      });
    });

    const runButton = document.querySelector('#run-monitor');
    const runStatus = document.querySelector('#run-status');
    runButton?.addEventListener('click', async () => {
      runButton.disabled = true;
      runStatus.textContent = 'Iniciando monitoreo...';
      try {
        const response = await fetch('/.netlify/functions/trigger-monitor', { method: 'POST' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'No se pudo iniciar el monitoreo.');
        runStatus.textContent = payload.message || 'Monitoreo iniciado. Refresca en unos minutos.';
      } catch (error) {
        runStatus.textContent = error.message;
        runButton.disabled = false;
      }
    });
  </script>
</body>
</html>`;

  await fs.writeFile(reportPath, html);
  return reportPath;
}

function brandSection(brand, results, isActive) {
  const id = `brand-${makeSlug(brand)}`;
  return `<section class="brand">
    <button class="brand-tab ${isActive ? 'active' : ''}" data-brand-tab="#${id}">${escapeHtml(brand)} <span>${results.length}</span></button>
    <div class="brand-panel" id="${id}" data-brand-panel ${isActive ? '' : 'hidden'}>
      ${results.map(resultCard).join('\n')}
    </div>
  </section>`;
}

function resultCard(result) {
  const badge = result.status === 'changed' ? 'danger' : result.status === 'error' ? 'error' : result.status === 'baseline_created' ? 'info' : 'success';
  return `<article class="card ${badge}">
    <div class="card-head">
      <div>
        <h2>${escapeHtml(result.name)}</h2>
        <p>${escapeHtml(result.category)} · ${escapeHtml(result.viewport)} · <a href="${escapeHtml(result.url)}" target="_blank" rel="noreferrer">Ver sitio</a></p>
      </div>
      <strong>${result.status === 'error' ? 'ERROR' : `${(result.diffPercent || 0).toFixed(3)}%`}</strong>
    </div>
    ${result.error ? `<p class="error-text">${escapeHtml(result.error)}</p>` : `<div class="comparison">
      ${imageBlock('Antes', result.baselineImage)}
      ${imageBlock('Después', result.currentImage)}
      ${imageBlock('Diff', result.diffImage)}
    </div>`}
  </article>`;
}

function imageBlock(label, src) {
  return `<figure><figcaption>${label}</figcaption><img loading="lazy" src="${escapeHtml(src)}" alt="${label}" /></figure>`;
}

function kpi(label, value) {
  return `<div class="kpi"><span>${value}</span><small>${label}</small></div>`;
}

function dashboardCss() {
  return `:root{color-scheme:dark;--bg:#08111f;--panel:#101c31;--panel2:#14233d;--text:#eef5ff;--muted:#94a3b8;--line:#243654;--ok:#31d0aa;--danger:#ff4fd8;--warn:#f7c948;--err:#ff5c7a}*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,Segoe UI,sans-serif;background:radial-gradient(circle at top left,#183865 0,#08111f 42%,#050914 100%);color:var(--text)}a{color:#7dd3fc}.hero{display:flex;justify-content:space-between;gap:24px;align-items:center;padding:42px;position:sticky;top:0;z-index:2;background:linear-gradient(180deg,rgba(8,17,31,.96),rgba(8,17,31,.74));backdrop-filter:blur(16px);border-bottom:1px solid var(--line)}.eyebrow{letter-spacing:.18em;text-transform:uppercase;color:#7dd3fc;font-size:12px;font-weight:800}h1{font-size:clamp(30px,5vw,58px);line-height:1;margin:0 0 12px}.muted{color:var(--muted)}.scorecard,.kpi{background:linear-gradient(145deg,var(--panel),var(--panel2));border:1px solid var(--line);border-radius:24px;padding:22px;box-shadow:0 18px 60px rgba(0,0,0,.25)}.scorecard.green{border-color:rgba(49,208,170,.8);box-shadow:0 0 0 1px rgba(49,208,170,.35),0 18px 60px rgba(49,208,170,.12)}.scorecard.attention{border-color:rgba(247,201,72,.7)}.scorecard.green span{color:var(--ok);text-shadow:0 0 22px rgba(49,208,170,.75)}.scorecard span,.kpi span{display:block;font-size:42px;font-weight:900}.scorecard small,.kpi small{color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.actions{display:flex;align-items:center;gap:14px;padding:24px 42px 0}.actions button{border:0;border-radius:999px;background:linear-gradient(135deg,#31d0aa,#7dd3fc);color:#04111f;cursor:pointer;font-weight:900;padding:14px 20px;box-shadow:0 16px 40px rgba(49,208,170,.18)}.actions button:disabled{cursor:not-allowed;filter:grayscale(.7);opacity:.75}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:16px;padding:26px 42px}.brands{padding:0 42px 42px}.brand{display:inline}.brand-tab{border:1px solid var(--line);background:#0d1830;color:var(--text);padding:12px 16px;border-radius:999px;margin:0 8px 14px 0;cursor:pointer;font-weight:800}.brand-tab.active{background:#e9f5ff;color:#07101f}.brand-tab span{opacity:.7}.brand-panel{display:grid;gap:22px;margin-top:8px}.card{background:rgba(16,28,49,.82);border:1px solid var(--line);border-left:5px solid var(--ok);border-radius:24px;padding:22px;box-shadow:0 18px 60px rgba(0,0,0,.18)}.card.danger{border-left-color:var(--danger)}.card.info{border-left-color:var(--warn)}.card.error{border-left-color:var(--err)}.card-head{display:flex;justify-content:space-between;gap:16px;align-items:start}.card h2{margin:0 0 6px}.card p{margin:0;color:var(--muted)}.card strong{font-size:28px}.comparison{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:18px}figure{margin:0;background:#07101f;border:1px solid var(--line);border-radius:18px;overflow:hidden}figcaption{padding:10px 12px;color:var(--muted);font-weight:800}img{width:100%;display:block;max-height:520px;object-fit:contain;background:#050914}.error-text{margin-top:12px!important;color:#fecdd3!important}@media(max-width:900px){.hero{position:static;display:block;padding:26px}.actions,.kpis,.brands{padding:18px}.actions{display:block}.actions button{margin-bottom:12px}.comparison{grid-template-columns:1fr}.card-head{display:block}}`;
}

async function notifyDiscord(results, reportPath) {
  if (!CONFIG.discordWebhookUrl) return;
  const changed = results.filter((result) => result.changed);
  if (!changed.length) return;

  const reportUrl = CONFIG.reportBaseUrl ? new URL('index.html', CONFIG.reportBaseUrl.endsWith('/') ? CONFIG.reportBaseUrl : `${CONFIG.reportBaseUrl}/`).toString() : reportPath;

  for (const result of changed.slice(0, 10)) {
    const payload = {
      embeds: [{
        title: `🚗 Cambio Detectado: ${result.brand} - ${result.name}`,
        color: 0xff00cc,
        fields: [
          { name: 'Categoría', value: result.category || 'Sin categoría', inline: true },
          { name: 'Diferencia detectada', value: `${result.diffPercent.toFixed(3)}%`, inline: true },
          { name: 'Ver comparativa', value: reportUrl }
        ],
        timestamp: new Date().toISOString()
      }]
    };

    const response = await fetch(CONFIG.discordWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.warn(`Discord webhook falló (${response.status}): ${await response.text()}`);
    }
  }
}

function groupBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || 'Otros';
    acc[value] ||= [];
    acc[value].push(item);
    return acc;
  }, {});
}

async function exists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

function makeSlug(input) {
  return String(input)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 120);
}

function toReportPath(filePath) {
  return filePath.split(path.sep).join('/').replace(/^reports\//, '');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
