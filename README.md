# Monitoreo Visual Automotriz Andes Motor

Sistema de monitoreo visual profesional para marcas automotrices usando Strapi CMS, Playwright, Pixelmatch, Discord Webhook y Netlify.

## Entregables incluidos

- `monitor.js` — captura páginas, aplica masking, compara contra baseline y genera alertas.
- `package.json` — dependencias y scripts.
- `.github/workflows/monitor.yml` — ejecución programada/manual y deploy a Netlify.
- `netlify/functions/trigger-monitor.mjs` — endpoint serverless para disparar el monitoreo manual desde el dashboard público.
- `netlify.toml` — configuración de publicación de `reports/` y funciones Netlify.
- `reports/index.html` — dashboard BI regenerado con botón manual e indicador de estado.
- `docs/STRAPI_SETUP.md` — guía técnica para Content Types y secrets.

## Uso local rápido

```bash
npm install
npx playwright install chromium
USE_SEED_WHEN_NO_STRAPI=true npm run monitor
```

En Windows PowerShell:

```powershell
npm install
npx playwright install chromium
$env:USE_SEED_WHEN_NO_STRAPI="true"; npm run monitor
```

## Variables de entorno

Requeridas en GitHub Actions:

- `STRAPI_API_URL`
- `STRAPI_TOKEN`
- `DISCORD_WEBHOOK_URL`
- `NETLIFY_AUTH_TOKEN`
- `NETLIFY_SITE_ID`

Requeridas en Netlify para el botón manual:

- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_ACTIONS_TOKEN` — PAT fino con permiso para ejecutar GitHub Actions en el repo.

Opcionales:

- `GITHUB_WORKFLOW_ID` default `monitor.yml`
- `GITHUB_REF` default `main`
- `TRIGGER_SECRET` si se quiere proteger el endpoint manual.
- `REPORT_BASE_URL`
- `DIFF_THRESHOLD_PERCENT` default `1`
- `MAX_PAGES`
- `PAGE_TIMEOUT_MS`
- `USE_SEED_WHEN_NO_STRAPI` default `true` localmente; en workflow queda `false`

## Funcionamiento

1. Consulta páginas activas en Strapi con marca anidada.
2. Abre cada URL en Chromium con Playwright.
3. Espera `networkidle`, intenta cerrar popups comunes, aplica `visibility:hidden` a selectores dinámicos y hace auto-scroll lento.
4. Captura screenshot full page.
5. Si no existe baseline, la crea.
6. Si existe, compara con `pixelmatch` y marca cambio si supera `1%`.
7. Genera `reports/index.html` con Antes / Después / Diff, botón manual e indicador visual.
8. El indicador queda verde solo si todas las URLs comparan OK contra baseline previa: `0 cambios`, `0 errores`, `0 baselines nuevas`.
9. Envía alerta a Discord si detecta cambios.
10. GitHub Actions despliega `reports/` y `netlify/functions/` a Netlify.
11. El botón público llama `/.netlify/functions/trigger-monitor`, que dispara `workflow_dispatch` en GitHub Actions.

## Recomendación operativa

Para ambiente profesional, aprueba manualmente las baselines iniciales antes de activar alertas. Un cambio real de diseño debe actualizar la baseline solo después de validarlo internamente.
