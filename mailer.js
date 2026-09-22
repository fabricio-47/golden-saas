'use strict';

// Cliente de e-mail via API HTTP da Brevo (antiga Sendinblue), sem depender de
// bibliotecas externas — usa apenas o módulo nativo node:https.
//
// Por quê via API (porta 443) e não SMTP direto (portas 25/465/587)?
// Provedores de hospedagem gratuitos (incluindo o Render, desde set/2025)
// bloqueiam tráfego de saída para portas SMTP em planos gratuitos, para
// evitar abuso/spam. A porta 443 (HTTPS) nunca é bloqueada, então enviar
// e-mail por uma API HTTP é o único jeito confiável de mandar e-mail
// automático a partir de um plano gratuito.
//
// Configuração via variáveis de ambiente (definidas no painel do Render, em
// "Environment"):
//   BREVO_API_KEY   chave de API gerada em app.brevo.com (Configurações > SMTP e API > Chaves de API)
//   EMAIL_FROM      e-mail remetente, precisa estar validado na sua conta Brevo
//   EMAIL_FROM_NAME (opcional) nome do remetente; padrão = "Golden SaaS"

const https = require('node:https');

function config() {
  return {
    apiKey: process.env.BREVO_API_KEY || '',
    from: process.env.EMAIL_FROM || '',
    fromName: process.env.EMAIL_FROM_NAME || 'Golden SaaS',
  };
}

function isConfigured() {
  const c = config();
  return !!(c.apiKey && c.from);
}

async function sendMail({ to, toName, subject, html, text, attachments }) {
  const c = config();
  if (!isConfigured()) {
    throw new Error(
      'Envio de e-mail não configurado. Defina BREVO_API_KEY e EMAIL_FROM nas variáveis de ambiente do Render.'
    );
  }

  // attachments (opcional): [{ name: 'arquivo.zip', content: Buffer }]
  const attachmentPayload =
    attachments && attachments.length
      ? attachments.map((a) => ({ name: a.name, content: a.content.toString('base64') }))
      : undefined;

  const payload = JSON.stringify({
    sender: { email: c.from, name: c.fromName },
    to: [{ email: to, name: toName || undefined }],
    subject,
    htmlContent: html || undefined,
    textContent: text || undefined,
    attachment: attachmentPayload,
  });

  const REQUEST_TIMEOUT_MS = 20000;

  await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.brevo.com',
        path: '/v3/smtp/email',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'api-key': c.apiKey,
          'content-length': Buffer.byteLength(payload),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
            return;
          }
          let detail = body;
          try {
            const parsed = JSON.parse(body);
            detail = parsed.message || body;
          } catch (_e) {
            // corpo não era JSON, usa como veio
          }
          reject(new Error(`Brevo respondeu ${res.statusCode}: ${detail}`));
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Tempo esgotado ao chamar a API da Brevo (limite de ${REQUEST_TIMEOUT_MS / 1000}s).`));
    });
    req.on('error', (err) => {
      reject(err instanceof Error ? err : new Error(String(err)));
    });

    req.write(payload);
    req.end();
  });
}

module.exports = { sendMail, isConfigured };
