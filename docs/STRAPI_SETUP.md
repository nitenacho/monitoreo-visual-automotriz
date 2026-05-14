# Guía técnica Strapi CMS

Esta guía define la estructura mínima para que `monitor.js` consuma páginas activas y genere monitoreo visual dinámico.

## 1. Content Type: Brand

Crear un **Collection Type** llamado `Brand` / `Brands`.

Campos recomendados:

- `Name` — Text, required, unique. Ejemplos: `Maxus`, `Foton`, `Kaiyi`.
- `Slug` — UID basado en `Name`, opcional pero recomendado.
- `IsActive` — Boolean, opcional para activar/desactivar marcas completas.

## 2. Content Type: Page

Crear un **Collection Type** llamado `Page` / `Pages`.

Campos requeridos:

- `Name` — Text, required. Ejemplo: `Ficha T60`.
- `URL` — Text o UID/URL, required. Debe contener la URL completa.
- `IsActive` — Boolean, required. El monitor solo procesa páginas con `true`.
- `Brand` — Relation many-to-one hacia `Brand`.
- `Category` — Enumeration o Text. Valores sugeridos: `Home`, `SUV`, `Pickup`, `Cargo`, `Vans`, `Camiones`.
- `IgnoreSelectors` — JSON o Long text. Lista de selectores CSS a ocultar antes de capturar.
- `Viewport` — Enumeration opcional. Valores sugeridos: `Desktop`, `Mobile`, `Tablet`.

Ejemplo de `IgnoreSelectors` como JSON:

```json
[
  ".chat-widget",
  "#cookie-banner",
  ".modal-oferta",
  "iframe[src*='recaptcha']"
]
```

También funciona como texto con un selector por línea.

## 3. Permisos de API

En Strapi:

1. Ir a **Settings → API Tokens**.
2. Crear token con permisos de lectura para `Page` y `Brand`.
3. Guardar el token como secret de GitHub: `STRAPI_TOKEN`.
4. Guardar la URL base de Strapi como secret: `STRAPI_API_URL`, por ejemplo `https://cms.tudominio.cl`.

El script consume:

```txt
GET /api/pages?filters[IsActive][$eq]=true&populate[Brand][fields][0]=Name&pagination[pageSize]=100
```

## 4. Carga inicial sugerida

### Maxus

- Home — `https://www.maxus.cl` — `Home`
- Ficha T60 — `https://www.maxus.cl/camionetas/t60/` — `Pickup`
- Ficha T90 — `https://www.maxus.cl/camionetas/t90/` — `Pickup`
- Ficha D60 — `https://www.maxus.cl/suv/d60/` — `SUV`
- Ficha V80 — `https://www.maxus.cl/vans/v80/` — `Cargo`
- Ficha Deliver 9 — `https://www.maxus.cl/vans/deliver-9/` — `Cargo`

### Kaiyi

- Home — `https://www.kaiyi.cl` — `Home`
- Ficha X3 — `https://www.kaiyi.cl/modelos/x3/` — `SUV`
- Ficha X3 Pro — `https://www.kaiyi.cl/modelos/x3-pro/` — `SUV`

### Soueast

- Home — `https://www.soueast.cl` — `Home`
- Ficha DX3 — `https://www.soueast.cl/modelos/dx3/` — `SUV`
- Ficha DX7 — `https://www.soueast.cl/modelos/dx7/` — `SUV`

### Jetour

- Home — `https://www.jetour.cl` — `Home`
- Ficha X70 — `https://www.jetour.cl/modelos/x70/` — `SUV`
- Ficha X70 Plus — `https://www.jetour.cl/modelos/x70-plus/` — `SUV`
- Ficha Dashing — `https://www.jetour.cl/modelos/dashing/` — `SUV`

### Foton

- Home — `https://www.foton.cl` — `Home`
- Ficha G7 — `https://www.foton.cl/camionetas/g7/` — `Pickup`
- Ficha G9 — `https://www.foton.cl/camionetas/g9/` — `Pickup`
- Ficha TM3 — `https://www.foton.cl/camiones-livianos/tm3/` — `Cargo`
- Ficha eAumark — `https://www.foton.cl/camiones-electricos/eaumark/` — `Cargo`

## 5. Secrets requeridos en GitHub Actions

- `STRAPI_API_URL`
- `STRAPI_TOKEN`
- `DISCORD_WEBHOOK_URL`
- `NETLIFY_AUTH_TOKEN`
- `NETLIFY_SITE_ID`

Opcionales:

- `REPORT_BASE_URL` — URL pública final del reporte si quieres que Discord enlace al dominio definitivo.
- `DIFF_THRESHOLD_PERCENT` — default `1`.
- `MAX_PAGES` — útil para pruebas.

## 6. Flujo recomendado

1. Ejecutar localmente con `USE_SEED_WHEN_NO_STRAPI=true npm run monitor` para validar capturas.
2. Revisar `baselines/` y confirmar que las imágenes maestras sean correctas.
3. Subir a GitHub.
4. Configurar secrets.
5. Ejecutar manualmente el workflow una primera vez.
6. Activar cron y dejar que Netlify publique `reports/`.

## 7. Nota sobre baselines

El workflow usa cache de GitHub Actions para persistir `baselines/`. Para operación crítica, recomiendo versionar las baselines aprobadas o usar almacenamiento persistente externo. El cache es suficiente para MVP, pero no es una fuente de verdad auditable a largo plazo.
