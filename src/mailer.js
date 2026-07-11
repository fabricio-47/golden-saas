'use strict';

// Cliente SMTP mínimo, escrito à mão (sem nodemailer/dependências externas),
// usando apenas os módulos nativos node:net e node:tls.
//
// Configuração via variáveis de ambiente (definidas no painel do Render, em
// "Environment"):
//   SMTP_HOST      ex: smtp.gmail.com
//   SMTP_PORT      ex: 465 (TLS direto) ou 587 (STARTTLS)
//   SMTP_USER      ex: suaoficina@gmail.com
//   SMTP_PASS      senha de aplicativo (não é a senha normal da conta)
//   SMTP_FROM      (opcional) e-mail que aparece como remetente; padrão = SMTP_USER
//   SMTP_FROM_NAME (opcional) nome do remetente; padrão = "Golden SaaS"

const net = require('node:net');
const tls = require('node:tls');

function config() {
  return {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    fromName: process.env.SMTP_FROM_NAME || 'Golden SaaS',
  };
}

function isConfigured() {
  const c = config();
  return !!(c.host && c.user && c.pass && c.from);
}

function encodeHeader(str) {
  if (/^[\x00-\x7F]*$/.test(str)) return str; // só ASCII, não precisa codificar
  return `=?UTF-8?B?${Buffer.from(str, 'utf8').toString('base64')}?=`;
}

function readResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n').filter(Boolean);
      const last = lines[lines.length - 1];
      if (last && /^\d{3} /.test(last)) {
        cleanup();
        resolve(buffer);
      }
    };
    const onError = (err) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const onClose = () => {
      cleanup();
      reject(new Error('A conexão com o servidor de e-mail foi encerrada antes de responder (verifique host/porta/firewall).'));
    };
    const cleanup = () => {
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
    };
    socket.on('data', onData);
    socket.on('error', onError);
    socket.once('close', onClose);
  });
}

function sendCommand(socket, command) {
  return new Promise((resolve, reject) => {
    readResponse(socket).then(resolve, reject);
    socket.write(command + '\r\n');
  });
}

function checkCode(response, expected) {
  const code = parseInt(response.slice(0, 3), 10);
  if (code !== expected) {
    throw new Error(`SMTP: esperado ${expected}, recebido: ${response.trim()}`);
  }
}

async function sendMail({ to, toName, subject, html, text }) {
  const c = config();
  if (!isConfigured()) {
    throw new Error(
      'Envio de e-mail não configurado. Defina SMTP_HOST, SMTP_USER, SMTP_PASS (e opcionalmente SMTP_PORT, SMTP_FROM) nas variáveis de ambiente do Render.'
    );
  }

  const CONNECT_TIMEOUT_MS = 15000;
  const useImplicitTLS = c.port === 465;
  let socket = await new Promise((resolve, reject) => {
    const sock = useImplicitTLS
      ? tls.connect({ host: c.host, port: c.port, servername: c.host }, () => {
          clearTimeout(timer);
          resolve(sock);
        })
      : net.connect({ host: c.host, port: c.port }, () => {
          clearTimeout(timer);
          resolve(sock);
        });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(
        new Error(
          `Tempo esgotado ao conectar em ${c.host}:${c.port}. O provedor de hospedagem pode estar bloqueando conexões SMTP de saída nessa porta.`
        )
      );
    }, CONNECT_TIMEOUT_MS);
    sock.once('error', (err) => {
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });

  socket.setTimeout(20000, () => socket.destroy());

  try {
    checkCode(await readResponse(socket), 220);
    checkCode(await sendCommand(socket, `EHLO goldensaas.local`), 250);

    if (!useImplicitTLS) {
      checkCode(await sendCommand(socket, 'STARTTLS'), 220);
      socket = await new Promise((resolve, reject) => {
        const secure = tls.connect({ socket, servername: c.host }, () => resolve(secure));
        secure.once('error', (err) => reject(err instanceof Error ? err : new Error(String(err))));
      });
      socket.setTimeout(20000, () => socket.destroy());
      checkCode(await sendCommand(socket, `EHLO goldensaas.local`), 250);
    }

    checkCode(await sendCommand(socket, 'AUTH LOGIN'), 334);
    checkCode(await sendCommand(socket, Buffer.from(c.user).toString('base64')), 334);
    checkCode(await sendCommand(socket, Buffer.from(c.pass).toString('base64')), 235);

    checkCode(await sendCommand(socket, `MAIL FROM:<${c.from}>`), 250);
    checkCode(await sendCommand(socket, `RCPT TO:<${to}>`), 250);
    checkCode(await sendCommand(socket, 'DATA'), 354);

    const boundary = `----golden-saas-${Date.now()}`;
    const fromHeader = `${encodeHeader(c.fromName)} <${c.from}>`;
    const toHeader = toName ? `${encodeHeader(toName)} <${to}>` : to;
    const messageLines = [
      `From: ${fromHeader}`,
      `To: ${toHeader}`,
      `Subject: ${encodeHeader(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      text || '',
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      html || '',
      '',
      `--${boundary}--`,
      '.',
    ];
    // escapa linhas que começam com "." (regra do protocolo SMTP)
    const body = messageLines
      .map((line) => (line.startsWith('.') && line !== '.' ? '.' + line : line))
      .join('\r\n');

    checkCode(await sendCommand(socket, body), 250);
    await sendCommand(socket, 'QUIT').catch(() => {});
  } finally {
    socket.destroy();
  }
}

module.exports = { sendMail, isConfigured };
