import { withRetry } from './utils/retry.js';

const SENDGRID_URL = 'https://api.sendgrid.com/v3/mail/send';

/**
 * Sends a pipeline failure alert with a one-click retry link.
 * Called by pipeline.js on any step failure after Airtable is marked Error.
 *
 * @param {{ recordId: string, stepName: string, error: Error|string, retryUrl: string }} opts
 */
export async function sendErrorAlert({ recordId, stepName, error, retryUrl }) {
  const message = error instanceof Error ? error.message : String(error);
  await sendEmail({
    subject: `⚠️ GlobeHop Instagram — Error en paso "${stepName}"`,
    html: errorHtml({ recordId, stepName, message, retryUrl }),
  });
}

/**
 * Sends a publish confirmation with the live Instagram permalink.
 * Called by webhook.js after a successful /publish run.
 *
 * @param {{ recordId: string, tipo: string, postUrl: string }} opts
 */
export async function sendPublishConfirmation({ recordId, tipo, postUrl }) {
  await sendEmail({
    subject: `✅ GlobeHop Instagram — Post publicado (${tipo})`,
    html: successHtml({ recordId, tipo, postUrl }),
  });
}

// ─── internal ─────────────────────────────────────────────────────────────────

async function sendEmail({ subject, html }) {
  const from = process.env.ALERT_FROM_EMAIL ?? process.env.ALERT_EMAIL;
  const to   = process.env.ALERT_TO_EMAIL   ?? process.env.ALERT_EMAIL;

  await withRetry(async () => {
    const resp = await fetch(SENDGRID_URL, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${process.env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from:    { email: from, name: 'GlobeHop Automation' },
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      const err  = new Error(`SendGrid ${resp.status}: ${body}`);
      err.status = resp.status;
      throw err;
    }
  });
}

// ─── HTML templates ───────────────────────────────────────────────────────────

function errorHtml({ recordId, stepName, message, retryUrl }) {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#CF202C">⚠️ Error en el pipeline de Instagram</h2>
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
    <tr><td style="padding:8px;color:#666;width:140px">Paso fallido</td>
        <td style="padding:8px;font-weight:bold">${esc(stepName)}</td></tr>
    <tr><td style="padding:8px;color:#666">Record ID</td>
        <td style="padding:8px;font-family:monospace">${esc(recordId)}</td></tr>
    <tr><td style="padding:8px;color:#666;vertical-align:top">Error</td>
        <td style="padding:8px;font-family:monospace;color:#CF202C;word-break:break-all">${esc(message)}</td></tr>
  </table>
  <p style="margin-bottom:24px">El registro fue marcado como <strong>Error</strong> en Airtable. Puedes reintentar el pipeline desde el paso fallido con el botón de abajo.</p>
  <a href="${esc(retryUrl)}"
     style="display:inline-block;background:#44539D;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold">
    🔄 Reintentar pipeline
  </a>
  <p style="margin-top:32px;font-size:12px;color:#999">GlobeHop Instagram Automation · Este mensaje es automático</p>
</body></html>`;
}

function successHtml({ recordId, tipo, postUrl }) {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#67BB97">✅ Post publicado en Instagram</h2>
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
    <tr><td style="padding:8px;color:#666;width:140px">Tipo</td>
        <td style="padding:8px;font-weight:bold">${esc(tipo)}</td></tr>
    <tr><td style="padding:8px;color:#666">Record ID</td>
        <td style="padding:8px;font-family:monospace">${esc(recordId)}</td></tr>
    <tr><td style="padding:8px;color:#666">URL publicado</td>
        <td style="padding:8px"><a href="${esc(postUrl)}">${esc(postUrl)}</a></td></tr>
  </table>
  <a href="${esc(postUrl)}"
     style="display:inline-block;background:#44539D;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold">
    Ver post en Instagram
  </a>
  <p style="margin-top:32px;font-size:12px;color:#999">GlobeHop Instagram Automation · Este mensaje es automático</p>
</body></html>`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
