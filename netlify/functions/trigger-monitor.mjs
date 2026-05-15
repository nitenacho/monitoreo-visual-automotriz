const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  },
  body: JSON.stringify(body)
});

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Método no permitido. Usa POST.' });
  }

  const requiredSecret = process.env.TRIGGER_SECRET;
  if (requiredSecret) {
    const providedSecret = event.headers['x-trigger-secret'] || event.queryStringParameters?.secret;
    if (providedSecret !== requiredSecret) {
      return json(401, { ok: false, error: 'No autorizado.' });
    }
  }

  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const workflowId = process.env.GITHUB_WORKFLOW_ID || 'monitor.yml';
  const ref = process.env.GITHUB_REF || 'main';
  const token = process.env.GITHUB_ACTIONS_TOKEN;

  const missing = Object.entries({ GITHUB_OWNER: owner, GITHUB_REPO: repo, GITHUB_ACTIONS_TOKEN: token })
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    return json(500, { ok: false, error: `Faltan variables: ${missing.join(', ')}` });
  }

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'andes-visual-monitor-netlify-trigger',
      'x-github-api-version': '2022-11-28'
    },
    body: JSON.stringify({ ref })
  });

  if (!response.ok) {
    const detail = await response.text();
    return json(response.status, { ok: false, error: 'GitHub no pudo iniciar el workflow.', detail });
  }

  return json(202, {
    ok: true,
    message: 'Monitoreo iniciado. El dashboard se actualizara cuando termine GitHub Actions + deploy Netlify.'
  });
}
