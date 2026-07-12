'use strict';

const http = require('node:http');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const { db, hashPassword } = require('./src/db');
const {
  createSession,
  destroySession,
  getSession,
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
} = require('./src/auth');
const { readBody, parseFormBody, escapeHtml, formatMoney } = require('./src/utils');
const { readRawBody, getBoundary, parseMultipart } = require('./src/multipart');
const { saveUploadedFile, deleteUploadedFile, resolveUploadPath, mimeForPath, MAX_REQUEST_BYTES } = require('./src/uploads');
const { sendMail, isConfigured: mailConfigured } = require('./src/mailer');
const { ROLES, hasManagementAccess } = require('./src/roles');

const { loginPage } = require('./src/views/login');
const { dashboardPage } = require('./src/views/dashboard');
const { clientesListPage, clienteFormPage, clienteShowPage } = require('./src/views/clientes');
const { bicicletasListPage, bicicletaFormPage, bicicletaShowPage } = require('./src/views/bicicletas');
const {
  ordensListPage,
  ordemFormPage,
  ordemShowPage,
  STATUS_LABELS,
  totalValor,
  formaPagamentoLabel,
} = require('./src/views/ordens');
const { pecasListPage, pecaFormPage } = require('./src/views/estoque');
const { usuariosListPage, usuarioFormPage } = require('./src/views/usuarios');
const { auditoriaPage } = require('./src/views/auditoria');

const PORT = process.env.PORT || 3000;

// ---------- helpers ----------

// Transient flash messages keyed by sessionId (cleared after being read once)
const flashStore = new Map();
function setFlash(sessionId, type, message) {
  if (!sessionId) return;
  flashStore.set(sessionId, { type, message });
}
function takeFlash(sessionId) {
  if (!sessionId) return null;
  const f = flashStore.get(sessionId);
  flashStore.delete(sessionId);
  return f || null;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function notFound(res) {
  send(res, 404, '<h1>404 - Página não encontrada</h1><a href="/">Voltar</a>');
}

function forbidden(res) {
  send(res, 403, '<h1>403 - Você não tem permissão para acessar esta página.</h1><a href="/">Voltar</a>');
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '';
}

function matchRoute(pattern, pathname) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    if (pp.startsWith(':')) {
      params[pp.slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (pp !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

function nextOSNumber() {
  const row = db.prepare('SELECT COUNT(*) as c FROM ordens_servico').get();
  const n = row.c + 1;
  return 'OS-' + String(n).padStart(4, '0');
}

function parseChecklistFromBody(body) {
  const checklist = [];
  let idx = 0;
  while (body['checklist_item_' + idx] !== undefined) {
    checklist.push({
      item: body['checklist_item_' + idx],
      status: body['checklist_status_' + idx] === 'atencao' ? 'atencao' : 'ok',
      observacao: body['checklist_obs_' + idx] || '',
    });
    idx++;
  }
  return checklist;
}

function toIntOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}
function toFloatOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function recomputeValorPecas(osId) {
  const soma = db
    .prepare('SELECT COALESCE(SUM(quantidade * preco_unitario), 0) as total FROM os_pecas WHERE ordem_servico_id = ?')
    .get(osId).total;
  const os = db.prepare('SELECT valor_mao_obra FROM ordens_servico WHERE id = ?').get(osId);
  const valorMaoObra = os ? Number(os.valor_mao_obra) || 0 : 0;
  db.prepare(
    `UPDATE ordens_servico SET valor_pecas = ?, valor_estimado = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(soma, soma + valorMaoObra, osId);
}

function replaceBicicletaMedia(bicicletaId, tipo, file) {
  if (!file || !file.data || file.data.length === 0) return;
  const saved = saveUploadedFile('bicicleta', bicicletaId, file);
  if (!saved) return;
  const existing = db.prepare('SELECT * FROM bicicleta_midias WHERE bicicleta_id = ? AND tipo = ?').get(bicicletaId, tipo);
  if (existing) {
    deleteUploadedFile(existing.caminho_arquivo);
    db.prepare('DELETE FROM bicicleta_midias WHERE id = ?').run(existing.id);
  }
  db.prepare(
    'INSERT INTO bicicleta_midias (bicicleta_id, tipo, tipo_arquivo, nome_arquivo, caminho_arquivo) VALUES (?, ?, ?, ?, ?)'
  ).run(bicicletaId, tipo, saved.tipo_arquivo, saved.nome_arquivo, saved.caminho_arquivo);
}

function buildOsEmailContent(os, clienteNome, tipo) {
  const checklist = os.checklist_json ? JSON.parse(os.checklist_json) : [];
  const checklistHtml = checklist
    .map(
      (c) =>
        `<li>${escapeHtml(c.item)}: <strong>${c.status === 'ok' ? 'OK' : 'Atenção'}</strong>${
          c.observacao ? ' — ' + escapeHtml(c.observacao) : ''
        }</li>`
    )
    .join('');
  const total = totalValor(os);
  const intro =
    tipo === 'finalizado'
      ? `Olá ${escapeHtml(clienteNome)}, seu veículo já está pronto! Segue o resumo do serviço realizado na O.S. ${escapeHtml(os.numero)}.`
      : `Olá ${escapeHtml(clienteNome)}, segue o resumo da Ordem de Serviço ${escapeHtml(os.numero)}.`;
  const subject =
    tipo === 'finalizado'
      ? `Seu veículo está pronto! - O.S. ${os.numero} - Golden SaaS`
      : `Resumo da O.S. ${os.numero} - Golden SaaS`;

  const html = `
    <div style="font-family:Arial,sans-serif;color:#222;max-width:600px;">
      <h2 style="color:#8a6d1f;margin-bottom:4px;">Golden SaaS</h2>
      <p>${intro}</p>
      <p><strong>Veículo:</strong> ${escapeHtml(os.marca || '')} ${escapeHtml(os.modelo)}</p>
      <p><strong>Status:</strong> ${STATUS_LABELS[os.status] || os.status}</p>
      ${os.problema_relatado ? `<p><strong>Problema relatado:</strong> ${escapeHtml(os.problema_relatado)}</p>` : ''}
      <h3 style="margin-bottom:4px;">Checklist de entrada</h3>
      <ul>${checklistHtml || '<li>Nenhum item registrado.</li>'}</ul>
      <h3 style="margin-bottom:4px;">Diagnóstico técnico</h3>
      <p>${os.diagnostico ? escapeHtml(os.diagnostico) : 'Não informado.'}</p>
      <h3 style="margin-bottom:4px;">Serviços realizados</h3>
      <p>${os.servicos_realizados ? escapeHtml(os.servicos_realizados) : 'Não informado.'}</p>
      <h3 style="margin-bottom:4px;">Valores</h3>
      <p>
        Peças: ${formatMoney(os.valor_pecas)}<br>
        Mão de obra: ${formatMoney(os.valor_mao_obra)}<br>
        <strong>Total: ${formatMoney(total)}</strong><br>
        Forma de pagamento: ${formaPagamentoLabel(os)}
      </p>
      <p style="margin-top:24px;color:#888;font-size:12px;">Enviado automaticamente pelo Golden SaaS.</p>
    </div>`;
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { subject, html, text };
}

// ---------- request handler ----------

const PUBLIC_PATHS = new Set(['/login']);

async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const method = req.method;

    const session = getSession(req);
    const user = session ? { id: session.userId, name: session.name, email: session.email, role: session.role } : null;

    // --- auth gate ---
    if (!PUBLIC_PATHS.has(pathname) && !user) {
      return redirect(res, '/login');
    }

    let body = {};
    let files = [];
    if (method === 'POST') {
      const contentType = req.headers['content-type'] || '';
      if (contentType.startsWith('multipart/form-data')) {
        const boundary = getBoundary(contentType);
        if (boundary) {
          let raw;
          try {
            raw = await readRawBody(req, MAX_REQUEST_BYTES);
          } catch (err) {
            if (err.message === 'ARQUIVO_MUITO_GRANDE') {
              return send(res, 413, '<h1>Arquivo(s) muito grande(s)</h1><p>O total enviado passou do limite (80MB). Tente enviar menos arquivos por vez.</p><a href="javascript:history.back()">Voltar</a>');
            }
            throw err;
          }
          const parsed = parseMultipart(raw, boundary);
          body = parsed.fields;
          files = parsed.files;
        }
      } else {
        const raw = await readBody(req);
        body = parseFormBody(raw);
      }
    }

    // CSRF check for all authenticated POSTs
    if (method === 'POST' && user) {
      if (!body.csrf || body.csrf !== session.csrfToken) {
        return send(res, 403, '<h1>403 - Token de segurança inválido. Volte e tente novamente.</h1><a href="/">Voltar</a>');
      }
    }

    // ---------------- PUBLIC ROUTES ----------------
    if (pathname === '/login' && method === 'GET') {
      if (user) return redirect(res, '/');
      return send(res, 200, loginPage({}));
    }

    if (pathname === '/login' && method === 'POST') {
      const { email, password } = body;
      const emailNorm = (email || '').trim().toLowerCase();
      const found = verifyPassword(emailNorm, password || '');
      db.prepare('INSERT INTO login_audit (email_tentativo, user_id, sucesso, ip) VALUES (?, ?, ?, ?)').run(
        emailNorm, found ? found.id : null, found ? 1 : 0, clientIp(req)
      );
      if (!found) {
        return send(res, 200, loginPage({ error: 'E-mail ou senha inválidos.', email }));
      }
      const sessionId = createSession(found);
      setSessionCookie(res, sessionId);
      return redirect(res, '/');
    }

    if (pathname === '/logout' && method === 'POST') {
      if (session) destroySession(session.sessionId);
      clearSessionCookie(res);
      return redirect(res, '/login');
    }

    // ---------------- ARQUIVOS ENVIADOS ----------------
    let m;
    if ((m = matchRoute('/uploads/:folder/:filename', pathname)) && method === 'GET') {
      const fullPath = resolveUploadPath(`${m.folder}/${m.filename}`);
      if (!fullPath || !fs.existsSync(fullPath)) return notFound(res);
      res.writeHead(200, { 'Content-Type': mimeForPath(fullPath) });
      fs.createReadStream(fullPath).pipe(res);
      return;
    }

    // ---------------- DASHBOARD ----------------
    if (pathname === '/' && method === 'GET') {
      const counts = {
        orcamento: db.prepare("SELECT COUNT(*) c FROM ordens_servico WHERE status='orcamento' AND ativo=1").get().c,
        execucao: db.prepare("SELECT COUNT(*) c FROM ordens_servico WHERE status='execucao' AND ativo=1").get().c,
        concluida: db.prepare("SELECT COUNT(*) c FROM ordens_servico WHERE status='concluida' AND ativo=1").get().c,
        clientes: db.prepare('SELECT COUNT(*) c FROM clientes').get().c,
        bicicletas: db.prepare('SELECT COUNT(*) c FROM bicicletas').get().c,
      };
      const recentOS = db
        .prepare(
          `SELECT os.*, c.nome as cliente_nome, b.marca, b.modelo
           FROM ordens_servico os
           JOIN clientes c ON c.id = os.cliente_id
           JOIN bicicletas b ON b.id = os.bicicleta_id
           WHERE os.ativo = 1
           ORDER BY os.created_at DESC LIMIT 8`
        )
        .all();
      const lowBatteryBikes = db
        .prepare(
          `SELECT bi.*, c.nome as cliente_nome
           FROM bicicletas bi JOIN clientes c ON c.id = bi.cliente_id
           WHERE bi.bateria_soh_percent IS NOT NULL AND bi.bateria_soh_percent < 90
           ORDER BY bi.bateria_soh_percent ASC LIMIT 8`
        )
        .all();
      const pecasBaixoEstoque = db
        .prepare('SELECT * FROM pecas WHERE quantidade <= estoque_minimo ORDER BY quantidade ASC LIMIT 10')
        .all();
      return send(res, 200, dashboardPage({ user, flash: takeFlash(session.sessionId), counts, recentOS, lowBatteryBikes, pecasBaixoEstoque }));
    }

    // ---------------- CLIENTES ----------------
    if (pathname === '/clientes' && method === 'GET') {
      const clientes = db
        .prepare(
          `SELECT c.*, (SELECT COUNT(*) FROM bicicletas b WHERE b.cliente_id = c.id) as total_bicicletas
           FROM clientes c ORDER BY c.created_at DESC`
        )
        .all();
      return send(res, 200, clientesListPage({ user, flash: takeFlash(session.sessionId), clientes }));
    }

    if (pathname === '/clientes/novo' && method === 'GET') {
      return send(res, 200, clienteFormPage({ user, flash: takeFlash(session.sessionId), cliente: null, csrfToken: session.csrfToken }));
    }

    if (pathname === '/clientes' && method === 'POST') {
      if (!body.nome || !body.nome.trim()) {
        return send(res, 400, clienteFormPage({ user, flash: { type: 'error', message: 'Nome é obrigatório.' }, cliente: body, csrfToken: session.csrfToken }));
      }
      const info = db
        .prepare('INSERT INTO clientes (nome, telefone, email, endereco, observacoes) VALUES (?, ?, ?, ?, ?)')
        .run(body.nome.trim(), body.telefone || '', body.email || '', body.endereco || '', body.observacoes || '');
      setFlash(session.sessionId, 'success', 'Cliente cadastrado com sucesso.');
      return redirect(res, `/clientes/${info.lastInsertRowid}`);
    }

    if ((m = matchRoute('/clientes/:id/editar', pathname)) && method === 'GET') {
      const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(m.id);
      if (!cliente) return notFound(res);
      return send(res, 200, clienteFormPage({ user, flash: takeFlash(session.sessionId), cliente, csrfToken: session.csrfToken }));
    }

    if ((m = matchRoute('/clientes/:id/excluir', pathname)) && method === 'POST') {
      db.prepare('DELETE FROM clientes WHERE id = ?').run(m.id);
      setFlash(session.sessionId, 'success', 'Cliente excluído.');
      return redirect(res, '/clientes');
    }

    if ((m = matchRoute('/clientes/:id', pathname)) && method === 'POST') {
      const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(m.id);
      if (!cliente) return notFound(res);
      if (!body.nome || !body.nome.trim()) {
        return send(res, 400, clienteFormPage({ user, flash: { type: 'error', message: 'Nome é obrigatório.' }, cliente: { ...cliente, ...body }, csrfToken: session.csrfToken }));
      }
      db.prepare('UPDATE clientes SET nome=?, telefone=?, email=?, endereco=?, observacoes=? WHERE id=?').run(
        body.nome.trim(), body.telefone || '', body.email || '', body.endereco || '', body.observacoes || '', m.id
      );
      setFlash(session.sessionId, 'success', 'Cliente atualizado.');
      return redirect(res, `/clientes/${m.id}`);
    }

    if ((m = matchRoute('/clientes/:id', pathname)) && method === 'GET') {
      const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(m.id);
      if (!cliente) return notFound(res);
      const bicicletas = db.prepare('SELECT * FROM bicicletas WHERE cliente_id = ? ORDER BY created_at DESC').all(m.id);
      const ordensServico = db.prepare('SELECT * FROM ordens_servico WHERE cliente_id = ? ORDER BY created_at DESC').all(m.id);
      return send(res, 200, clienteShowPage({ user, flash: takeFlash(session.sessionId), cliente, bicicletas, ordensServico, csrfToken: session.csrfToken }));
    }

    // ---------------- BICICLETAS ----------------
    if (pathname === '/bicicletas' && method === 'GET') {
      const bicicletas = db
        .prepare(
          `SELECT b.*, c.nome as cliente_nome FROM bicicletas b JOIN clientes c ON c.id = b.cliente_id ORDER BY b.created_at DESC`
        )
        .all();
      return send(res, 200, bicicletasListPage({ user, flash: takeFlash(session.sessionId), bicicletas }));
    }

    if (pathname === '/bicicletas/novo' && method === 'GET') {
      const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
      if (!clientes.length) {
        setFlash(session.sessionId, 'error', 'Cadastre um cliente antes de adicionar uma bicicleta.');
        return redirect(res, '/clientes/novo');
      }
      return send(
        res,
        200,
        bicicletaFormPage({ user, flash: takeFlash(session.sessionId), bicicleta: null, clientes, defaultClienteId: url.searchParams.get('cliente_id'), csrfToken: session.csrfToken, midias: [] })
      );
    }

    if (pathname === '/bicicletas' && method === 'POST') {
      const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
      const tipoVeiculo = body.tipo_veiculo === 'moto' ? 'moto' : 'bicicleta';
      const fotoChassiFile = files.find((f) => f.fieldName === 'foto_chassi' && f.data && f.data.length > 0);
      const fotoBateriaFile = files.find((f) => f.fieldName === 'foto_bateria_serial' && f.data && f.data.length > 0);

      if (!body.cliente_id || !body.modelo || !body.modelo.trim()) {
        return send(res, 400, bicicletaFormPage({ user, flash: { type: 'error', message: 'Cliente e modelo são obrigatórios.' }, bicicleta: { ...body, tipo_veiculo: tipoVeiculo }, clientes, defaultClienteId: body.cliente_id, csrfToken: session.csrfToken, midias: [] }));
      }
      if (tipoVeiculo === 'moto' && (!fotoChassiFile || !fotoBateriaFile)) {
        return send(res, 400, bicicletaFormPage({ user, flash: { type: 'error', message: 'Para motos elétricas é obrigatório anexar a foto do chassi e a foto do número de série da bateria.' }, bicicleta: { ...body, tipo_veiculo: tipoVeiculo }, clientes, defaultClienteId: body.cliente_id, csrfToken: session.csrfToken, midias: [] }));
      }

      const info = db
        .prepare(
          `INSERT INTO bicicletas (cliente_id, tipo_veiculo, marca, modelo, cor, motor_serial, controladora_serial, bateria_serial, bateria_soh_percent, bateria_ciclos_carga, km_estimado, observacoes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          body.cliente_id, tipoVeiculo, body.marca || '', body.modelo.trim(), body.cor || '',
          body.motor_serial || '', body.controladora_serial || '', body.bateria_serial || '',
          toIntOrNull(body.bateria_soh_percent), toIntOrNull(body.bateria_ciclos_carga), toIntOrNull(body.km_estimado),
          body.observacoes || ''
        );
      const newId = info.lastInsertRowid;
      if (fotoChassiFile) replaceBicicletaMedia(newId, 'chassi', fotoChassiFile);
      if (fotoBateriaFile) replaceBicicletaMedia(newId, 'bateria_serial', fotoBateriaFile);

      setFlash(session.sessionId, 'success', 'Bicicleta cadastrada com sucesso.');
      return redirect(res, `/bicicletas/${newId}`);
    }

    if ((m = matchRoute('/bicicletas/:id/editar', pathname)) && method === 'GET') {
      const bicicleta = db.prepare('SELECT * FROM bicicletas WHERE id = ?').get(m.id);
      if (!bicicleta) return notFound(res);
      const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
      const midias = db.prepare('SELECT * FROM bicicleta_midias WHERE bicicleta_id = ?').all(m.id);
      return send(res, 200, bicicletaFormPage({ user, flash: takeFlash(session.sessionId), bicicleta, clientes, csrfToken: session.csrfToken, midias }));
    }

    if ((m = matchRoute('/bicicletas/:id/excluir', pathname)) && method === 'POST') {
      db.prepare('DELETE FROM bicicletas WHERE id = ?').run(m.id);
      setFlash(session.sessionId, 'success', 'Bicicleta excluída.');
      return redirect(res, '/bicicletas');
    }

    if ((m = matchRoute('/bicicletas/:id', pathname)) && method === 'POST') {
      const bicicleta = db.prepare('SELECT * FROM bicicletas WHERE id = ?').get(m.id);
      if (!bicicleta) return notFound(res);
      const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
      const midiasExistentes = db.prepare('SELECT * FROM bicicleta_midias WHERE bicicleta_id = ?').all(m.id);
      const tipoVeiculo = body.tipo_veiculo === 'moto' ? 'moto' : 'bicicleta';
      const fotoChassiFile = files.find((f) => f.fieldName === 'foto_chassi' && f.data && f.data.length > 0);
      const fotoBateriaFile = files.find((f) => f.fieldName === 'foto_bateria_serial' && f.data && f.data.length > 0);
      const jaTemChassi = midiasExistentes.some((mm) => mm.tipo === 'chassi');
      const jaTemBateria = midiasExistentes.some((mm) => mm.tipo === 'bateria_serial');

      if (!body.cliente_id || !body.modelo || !body.modelo.trim()) {
        return send(res, 400, bicicletaFormPage({ user, flash: { type: 'error', message: 'Cliente e modelo são obrigatórios.' }, bicicleta: { ...bicicleta, ...body, tipo_veiculo: tipoVeiculo }, clientes, csrfToken: session.csrfToken, midias: midiasExistentes }));
      }
      if (tipoVeiculo === 'moto' && ((!fotoChassiFile && !jaTemChassi) || (!fotoBateriaFile && !jaTemBateria))) {
        return send(res, 400, bicicletaFormPage({ user, flash: { type: 'error', message: 'Para motos elétricas é obrigatório anexar a foto do chassi e a foto do número de série da bateria.' }, bicicleta: { ...bicicleta, ...body, tipo_veiculo: tipoVeiculo }, clientes, csrfToken: session.csrfToken, midias: midiasExistentes }));
      }

      db.prepare(
        `UPDATE bicicletas SET cliente_id=?, tipo_veiculo=?, marca=?, modelo=?, cor=?, motor_serial=?, controladora_serial=?, bateria_serial=?, bateria_soh_percent=?, bateria_ciclos_carga=?, km_estimado=?, observacoes=? WHERE id=?`
      ).run(
        body.cliente_id, tipoVeiculo, body.marca || '', body.modelo.trim(), body.cor || '',
        body.motor_serial || '', body.controladora_serial || '', body.bateria_serial || '',
        toIntOrNull(body.bateria_soh_percent), toIntOrNull(body.bateria_ciclos_carga), toIntOrNull(body.km_estimado),
        body.observacoes || '', m.id
      );
      if (fotoChassiFile) replaceBicicletaMedia(m.id, 'chassi', fotoChassiFile);
      if (fotoBateriaFile) replaceBicicletaMedia(m.id, 'bateria_serial', fotoBateriaFile);

      setFlash(session.sessionId, 'success', 'Bicicleta atualizada.');
      return redirect(res, `/bicicletas/${m.id}`);
    }

    if ((m = matchRoute('/bicicletas/:id', pathname)) && method === 'GET') {
      const bicicleta = db
        .prepare(`SELECT b.*, c.nome as cliente_nome FROM bicicletas b JOIN clientes c ON c.id = b.cliente_id WHERE b.id = ?`)
        .get(m.id);
      if (!bicicleta) return notFound(res);
      const ordensServico = db.prepare('SELECT * FROM ordens_servico WHERE bicicleta_id = ? ORDER BY created_at DESC').all(m.id);
      const midias = db.prepare('SELECT * FROM bicicleta_midias WHERE bicicleta_id = ?').all(m.id);
      return send(res, 200, bicicletaShowPage({ user, flash: takeFlash(session.sessionId), bicicleta, ordensServico, midias, csrfToken: session.csrfToken }));
    }

    // ---------------- ESTOQUE ----------------
    if (pathname === '/estoque' && method === 'GET') {
      const pecas = db.prepare('SELECT * FROM pecas ORDER BY nome ASC').all();
      return send(res, 200, pecasListPage({ user, flash: takeFlash(session.sessionId), pecas, csrfToken: session.csrfToken }));
    }

    if (pathname === '/estoque/novo' && method === 'GET') {
      return send(res, 200, pecaFormPage({ user, flash: takeFlash(session.sessionId), peca: null, csrfToken: session.csrfToken }));
    }

    if (pathname === '/estoque' && method === 'POST') {
      if (!body.nome || !body.nome.trim()) {
        return send(res, 400, pecaFormPage({ user, flash: { type: 'error', message: 'Nome da peça é obrigatório.' }, peca: body, csrfToken: session.csrfToken }));
      }
      const precoVenda = toFloatOrNull(body.preco_venda) || 0;
      const info = db
        .prepare(
          `INSERT INTO pecas (nome, categoria, numero_serie, quantidade, estoque_minimo, custo_unitario, preco_venda, observacoes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          body.nome.trim(), body.categoria || '', body.numero_serie || '',
          toIntOrNull(body.quantidade) || 0, toIntOrNull(body.estoque_minimo) || 0,
          toFloatOrNull(body.custo_unitario), precoVenda, body.observacoes || ''
        );
      setFlash(session.sessionId, 'success', 'Peça cadastrada no estoque.');
      return redirect(res, `/estoque/${info.lastInsertRowid}/editar`);
    }

    if ((m = matchRoute('/estoque/:id/editar', pathname)) && method === 'GET') {
      const peca = db.prepare('SELECT * FROM pecas WHERE id = ?').get(m.id);
      if (!peca) return notFound(res);
      return send(res, 200, pecaFormPage({ user, flash: takeFlash(session.sessionId), peca, csrfToken: session.csrfToken }));
    }

    if ((m = matchRoute('/estoque/:id/excluir', pathname)) && method === 'POST') {
      db.prepare('DELETE FROM pecas WHERE id = ?').run(m.id);
      setFlash(session.sessionId, 'success', 'Peça excluída do estoque.');
      return redirect(res, '/estoque');
    }

    if ((m = matchRoute('/estoque/:id', pathname)) && method === 'POST') {
      const peca = db.prepare('SELECT * FROM pecas WHERE id = ?').get(m.id);
      if (!peca) return notFound(res);
      if (!body.nome || !body.nome.trim()) {
        return send(res, 400, pecaFormPage({ user, flash: { type: 'error', message: 'Nome da peça é obrigatório.' }, peca: { ...peca, ...body }, csrfToken: session.csrfToken }));
      }
      const precoVenda = toFloatOrNull(body.preco_venda) || 0;
      db.prepare(
        `UPDATE pecas SET nome=?, categoria=?, numero_serie=?, quantidade=?, estoque_minimo=?, custo_unitario=?, preco_venda=?, observacoes=?, updated_at=datetime('now') WHERE id=?`
      ).run(
        body.nome.trim(), body.categoria || '', body.numero_serie || '',
        toIntOrNull(body.quantidade) || 0, toIntOrNull(body.estoque_minimo) || 0,
        toFloatOrNull(body.custo_unitario), precoVenda, body.observacoes || '', m.id
      );
      setFlash(session.sessionId, 'success', 'Peça atualizada.');
      return redirect(res, `/estoque/${m.id}/editar`);
    }

    // ---------------- ORDENS DE SERVIÇO ----------------
    if (pathname === '/os' && method === 'GET') {
      const statusFilter = url.searchParams.get('status') || '';
      const mostrarDesativadas = url.searchParams.get('desativadas') === '1';
      let query = `SELECT os.*, c.nome as cliente_nome, b.marca, b.modelo
                    FROM ordens_servico os
                    JOIN clientes c ON c.id = os.cliente_id
                    JOIN bicicletas b ON b.id = os.bicicleta_id
                    WHERE os.ativo = ?`;
      const params = [mostrarDesativadas ? 0 : 1];
      if (statusFilter) {
        query += ' AND os.status = ?';
        params.push(statusFilter);
      }
      query += ' ORDER BY os.created_at DESC';
      const ordens = db.prepare(query).all(...params);
      return send(res, 200, ordensListPage({ user, flash: takeFlash(session.sessionId), ordens, statusFilter, mostrarDesativadas }));
    }

    if (pathname === '/os/novo' && method === 'GET') {
      const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
      const bicicletas = db.prepare('SELECT b.*, c.nome as cliente_nome FROM bicicletas b JOIN clientes c ON c.id=b.cliente_id ORDER BY b.created_at DESC').all();
      if (!clientes.length || !bicicletas.length) {
        setFlash(session.sessionId, 'error', 'Cadastre um cliente e um veículo antes de abrir uma O.S.');
        return redirect(res, '/clientes');
      }
      const defaultBicicletaId = url.searchParams.get('bicicleta_id');
      let defaultClienteId = url.searchParams.get('cliente_id');
      if (!defaultClienteId && defaultBicicletaId) {
        const b = bicicletas.find((bb) => String(bb.id) === String(defaultBicicletaId));
        if (b) defaultClienteId = b.cliente_id;
      }
      return send(
        res,
        200,
        ordemFormPage({ user, flash: takeFlash(session.sessionId), os: null, clientes, bicicletas, defaultClienteId, defaultBicicletaId, csrfToken: session.csrfToken })
      );
    }

    if (pathname === '/os' && method === 'POST') {
      const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
      const bicicletas = db.prepare('SELECT b.*, c.nome as cliente_nome FROM bicicletas b JOIN clientes c ON c.id=b.cliente_id ORDER BY b.created_at DESC').all();
      if (!body.cliente_id || !body.bicicleta_id) {
        return send(res, 400, ordemFormPage({ user, flash: { type: 'error', message: 'Cliente e veículo são obrigatórios.' }, os: null, clientes, bicicletas, csrfToken: session.csrfToken }));
      }
      const checklist = parseChecklistFromBody(body);
      const numero = nextOSNumber();
      const valorPecas = toFloatOrNull(body.valor_pecas);
      const valorMaoObra = toFloatOrNull(body.valor_mao_obra);
      const formaPagamento = body.forma_pagamento || null;
      const parcelas = formaPagamento === 'credito' ? toIntOrNull(body.parcelas) : null;
      const info = db
        .prepare(
          `INSERT INTO ordens_servico (numero, cliente_id, bicicleta_id, status, checklist_json, problema_relatado, diagnostico, servicos_realizados, valor_pecas, valor_mao_obra, valor_estimado, forma_pagamento, parcelas)
           VALUES (?, ?, ?, 'orcamento', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          numero, body.cliente_id, body.bicicleta_id, JSON.stringify(checklist),
          body.problema_relatado || '', body.diagnostico || '', body.servicos_realizados || '',
          valorPecas, valorMaoObra, (valorPecas || 0) + (valorMaoObra || 0), formaPagamento, parcelas
        );
      setFlash(session.sessionId, 'success', `Ordem de Serviço ${numero} criada com sucesso.`);
      return redirect(res, `/os/${info.lastInsertRowid}`);
    }

    if ((m = matchRoute('/os/:id/editar', pathname)) && method === 'GET') {
      const os = db.prepare('SELECT * FROM ordens_servico WHERE id = ?').get(m.id);
      if (!os) return notFound(res);
      const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
      const bicicletas = db.prepare('SELECT b.*, c.nome as cliente_nome FROM bicicletas b JOIN clientes c ON c.id=b.cliente_id ORDER BY b.created_at DESC').all();
      const temPecasVinculadas = db.prepare('SELECT COUNT(*) c FROM os_pecas WHERE ordem_servico_id = ?').get(m.id).c > 0;
      return send(res, 200, ordemFormPage({ user, flash: takeFlash(session.sessionId), os, clientes, bicicletas, csrfToken: session.csrfToken, temPecasVinculadas }));
    }

    if ((m = matchRoute('/os/:id/desativar', pathname)) && method === 'POST') {
      const os = db.prepare('SELECT * FROM ordens_servico WHERE id = ?').get(m.id);
      if (!os) return notFound(res);
      db.prepare("UPDATE ordens_servico SET ativo = 0, updated_at = datetime('now') WHERE id = ?").run(m.id);
      setFlash(session.sessionId, 'success', 'Ordem de Serviço desativada. O histórico continua salvo e pode ser reativado quando quiser.');
      return redirect(res, `/os/${m.id}`);
    }

    if ((m = matchRoute('/os/:id/reativar', pathname)) && method === 'POST') {
      const os = db.prepare('SELECT * FROM ordens_servico WHERE id = ?').get(m.id);
      if (!os) return notFound(res);
      db.prepare("UPDATE ordens_servico SET ativo = 1, updated_at = datetime('now') WHERE id = ?").run(m.id);
      setFlash(session.sessionId, 'success', 'Ordem de Serviço reativada.');
      return redirect(res, `/os/${m.id}`);
    }

    if ((m = matchRoute('/os/:id/midias', pathname)) && method === 'POST') {
      const os = db.prepare('SELECT * FROM ordens_servico WHERE id = ?').get(m.id);
      if (!os) return notFound(res);
      const categoria = body.categoria === 'servico' ? 'servico' : 'checklist';
      const uploadFiles = files.filter((f) => f.fieldName === 'arquivos' && f.data && f.data.length > 0);
      let count = 0;
      for (const f of uploadFiles) {
        const saved = saveUploadedFile('os', m.id, f);
        if (saved) {
          db.prepare(
            'INSERT INTO os_midias (ordem_servico_id, categoria, tipo_arquivo, nome_arquivo, caminho_arquivo) VALUES (?, ?, ?, ?, ?)'
          ).run(m.id, categoria, saved.tipo_arquivo, saved.nome_arquivo, saved.caminho_arquivo);
          count++;
        }
      }
      setFlash(
        session.sessionId,
        count > 0 ? 'success' : 'error',
        count > 0 ? `${count} arquivo(s) enviado(s) com sucesso.` : 'Nenhum arquivo válido foi enviado (verifique o formato — fotos JPG/PNG/WEBP ou vídeos MP4/MOV/WEBM até 20MB).'
      );
      return redirect(res, `/os/${m.id}`);
    }

    if ((m = matchRoute('/os/:id/midias/:midiaId/excluir', pathname)) && method === 'POST') {
      const midia = db.prepare('SELECT * FROM os_midias WHERE id = ? AND ordem_servico_id = ?').get(m.midiaId, m.id);
      if (midia) {
        deleteUploadedFile(midia.caminho_arquivo);
        db.prepare('DELETE FROM os_midias WHERE id = ?').run(m.midiaId);
        setFlash(session.sessionId, 'success', 'Arquivo removido.');
      }
      return redirect(res, `/os/${m.id}`);
    }

    if ((m = matchRoute('/os/:id/pecas', pathname)) && method === 'POST') {
      const os = db.prepare('SELECT * FROM ordens_servico WHERE id = ?').get(m.id);
      if (!os) return notFound(res);
      const peca = db.prepare('SELECT * FROM pecas WHERE id = ?').get(body.peca_id);
      const quantidade = toIntOrNull(body.quantidade) || 1;
      if (!peca) {
        setFlash(session.sessionId, 'error', 'Peça não encontrada no estoque.');
        return redirect(res, `/os/${m.id}`);
      }
      if (quantidade < 1) {
        setFlash(session.sessionId, 'error', 'Quantidade inválida.');
        return redirect(res, `/os/${m.id}`);
      }
      db.prepare(
        'INSERT INTO os_pecas (ordem_servico_id, peca_id, nome_peca, quantidade, preco_unitario) VALUES (?, ?, ?, ?, ?)'
      ).run(m.id, peca.id, peca.nome, quantidade, peca.preco_venda);
      const novaQuantidade = peca.quantidade - quantidade;
      db.prepare("UPDATE pecas SET quantidade = ?, updated_at = datetime('now') WHERE id = ?").run(novaQuantidade, peca.id);
      recomputeValorPecas(m.id);
      setFlash(
        session.sessionId,
        novaQuantidade <= 0 ? 'error' : 'success',
        novaQuantidade <= 0
          ? `Peça "${peca.nome}" adicionada à O.S. Atenção: o estoque dessa peça ficou zerado ou negativo (${novaQuantidade}).`
          : `Peça "${peca.nome}" adicionada à O.S.`
      );
      return redirect(res, `/os/${m.id}`);
    }

    if ((m = matchRoute('/os/:id/pecas/:itemId/excluir', pathname)) && method === 'POST') {
      const item = db.prepare('SELECT * FROM os_pecas WHERE id = ? AND ordem_servico_id = ?').get(m.itemId, m.id);
      if (item) {
        if (item.peca_id) {
          db.prepare("UPDATE pecas SET quantidade = quantidade + ?, updated_at = datetime('now') WHERE id = ?").run(item.quantidade, item.peca_id);
        }
        db.prepare('DELETE FROM os_pecas WHERE id = ?').run(item.id);
        recomputeValorPecas(m.id);
        setFlash(session.sessionId, 'success', 'Peça removida da O.S. e devolvida ao estoque.');
      }
      return redirect(res, `/os/${m.id}`);
    }

    if ((m = matchRoute('/os/:id/enviar-email', pathname)) && method === 'POST') {
      const os = db
        .prepare(
          `SELECT os.*, c.nome as cliente_nome, c.email as cliente_email, b.marca, b.modelo
           FROM ordens_servico os JOIN clientes c ON c.id = os.cliente_id JOIN bicicletas b ON b.id = os.bicicleta_id
           WHERE os.id = ?`
        )
        .get(m.id);
      if (!os) return notFound(res);
      if (!os.cliente_email) {
        setFlash(session.sessionId, 'error', 'Este cliente não tem e-mail cadastrado. Adicione um e-mail no cadastro do cliente.');
        return redirect(res, `/os/${m.id}`);
      }
      try {
        const content = buildOsEmailContent(os, os.cliente_nome, 'resumo');
        await sendMail({ to: os.cliente_email, toName: os.cliente_nome, subject: content.subject, html: content.html, text: content.text });
        setFlash(session.sessionId, 'success', `E-mail enviado para ${os.cliente_email}.`);
      } catch (err) {
        console.error('[email] Falha ao enviar e-mail (enviar-email):', err);
        setFlash(session.sessionId, 'error', 'Não foi possível enviar o e-mail: ' + (err && err.message ? err.message : 'erro desconhecido, veja os Logs do servidor.'));
      }
      return redirect(res, `/os/${m.id}`);
    }

    if ((m = matchRoute('/os/:id/finalizar', pathname)) && method === 'POST') {
      const os = db
        .prepare(
          `SELECT os.*, c.nome as cliente_nome, c.email as cliente_email, b.marca, b.modelo
           FROM ordens_servico os JOIN clientes c ON c.id = os.cliente_id JOIN bicicletas b ON b.id = os.bicicleta_id
           WHERE os.id = ?`
        )
        .get(m.id);
      if (!os) return notFound(res);
      db.prepare(
        `UPDATE ordens_servico SET status='concluida', data_conclusao=COALESCE(data_conclusao, datetime('now')), updated_at=datetime('now') WHERE id=?`
      ).run(m.id);

      let msg = 'Ordem de Serviço finalizada.';
      let flashType = 'success';
      if (os.cliente_email) {
        try {
          const content = buildOsEmailContent({ ...os, status: 'concluida' }, os.cliente_nome, 'finalizado');
          await sendMail({ to: os.cliente_email, toName: os.cliente_nome, subject: content.subject, html: content.html, text: content.text });
          msg += ` Cliente avisado por e-mail (${os.cliente_email}).`;
        } catch (err) {
          console.error('[email] Falha ao enviar e-mail (finalizar):', err);
          msg += ` Porém não foi possível enviar o e-mail automático: ${err && err.message ? err.message : 'erro desconhecido, veja os Logs do servidor.'}`;
          flashType = 'error';
        }
      } else {
        msg += ' O cliente não tem e-mail cadastrado, então não foi possível avisá-lo automaticamente.';
        flashType = 'error';
      }
      setFlash(session.sessionId, flashType, msg);
      return redirect(res, `/os/${m.id}`);
    }

    if ((m = matchRoute('/os/:id', pathname)) && method === 'POST') {
      const os = db.prepare('SELECT * FROM ordens_servico WHERE id = ?').get(m.id);
      if (!os) return notFound(res);
      const checklist = parseChecklistFromBody(body);
      const status = ['orcamento', 'execucao', 'concluida'].includes(body.status) ? body.status : os.status;
      const dataConclusao = status === 'concluida' ? (os.data_conclusao || new Date().toISOString()) : null;
      const valorPecas = toFloatOrNull(body.valor_pecas);
      const valorMaoObra = toFloatOrNull(body.valor_mao_obra);
      const formaPagamento = body.forma_pagamento || null;
      const parcelas = formaPagamento === 'credito' ? toIntOrNull(body.parcelas) : null;
      db.prepare(
        `UPDATE ordens_servico SET cliente_id=?, bicicleta_id=?, status=?, checklist_json=?, problema_relatado=?, diagnostico=?, servicos_realizados=?, valor_pecas=?, valor_mao_obra=?, valor_estimado=?, forma_pagamento=?, parcelas=?, data_conclusao=?, updated_at=datetime('now') WHERE id=?`
      ).run(
        body.cliente_id || os.cliente_id, body.bicicleta_id || os.bicicleta_id, status, JSON.stringify(checklist),
        body.problema_relatado || '', body.diagnostico || '', body.servicos_realizados || '',
        valorPecas, valorMaoObra, (valorPecas || 0) + (valorMaoObra || 0), formaPagamento, parcelas, dataConclusao, m.id
      );
      setFlash(session.sessionId, 'success', 'Ordem de Serviço atualizada.');
      return redirect(res, `/os/${m.id}`);
    }

    if ((m = matchRoute('/os/:id', pathname)) && method === 'GET') {
      const os = db
        .prepare(
          `SELECT os.*, c.nome as cliente_nome, b.marca, b.modelo FROM ordens_servico os
           JOIN clientes c ON c.id = os.cliente_id JOIN bicicletas b ON b.id = os.bicicleta_id WHERE os.id = ?`
        )
        .get(m.id);
      if (!os) return notFound(res);
      const midiasChecklist = db.prepare("SELECT * FROM os_midias WHERE ordem_servico_id = ? AND categoria = 'checklist' ORDER BY created_at DESC").all(m.id);
      const midiasServico = db.prepare("SELECT * FROM os_midias WHERE ordem_servico_id = ? AND categoria = 'servico' ORDER BY created_at DESC").all(m.id);
      const osPecas = db.prepare('SELECT * FROM os_pecas WHERE ordem_servico_id = ? ORDER BY created_at DESC').all(m.id);
      const pecasDisponiveis = db.prepare('SELECT * FROM pecas ORDER BY nome ASC').all();
      return send(res, 200, ordemShowPage({ user, flash: takeFlash(session.sessionId), os, midiasChecklist, midiasServico, osPecas, pecasDisponiveis, csrfToken: session.csrfToken }));
    }

    // ---------------- USUÁRIOS (Direção e Gerência apenas) ----------------
    if (pathname === '/usuarios' && method === 'GET') {
      if (!hasManagementAccess(user)) return forbidden(res);
      const usuarios = db.prepare('SELECT * FROM users ORDER BY name ASC').all();
      return send(res, 200, usuariosListPage({ user, flash: takeFlash(session.sessionId), usuarios, csrfToken: session.csrfToken }));
    }

    if (pathname === '/usuarios/novo' && method === 'GET') {
      if (!hasManagementAccess(user)) return forbidden(res);
      return send(res, 200, usuarioFormPage({ user, flash: takeFlash(session.sessionId), usuario: null, csrfToken: session.csrfToken }));
    }

    if (pathname === '/usuarios' && method === 'POST') {
      if (!hasManagementAccess(user)) return forbidden(res);
      const nome = (body.name || '').trim();
      const emailNovo = (body.email || '').trim().toLowerCase();
      const role = ROLES.includes(body.role) ? body.role : 'mecanico';
      if (!nome || !emailNovo || !body.password) {
        return send(res, 400, usuarioFormPage({ user, flash: { type: 'error', message: 'Nome, e-mail e senha são obrigatórios.' }, usuario: { ...body, name: nome, email: emailNovo }, csrfToken: session.csrfToken }));
      }
      const existente = db.prepare('SELECT id FROM users WHERE email = ?').get(emailNovo);
      if (existente) {
        return send(res, 400, usuarioFormPage({ user, flash: { type: 'error', message: 'Já existe um usuário com esse e-mail.' }, usuario: { ...body, name: nome, email: emailNovo }, csrfToken: session.csrfToken }));
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(body.password, salt);
      db.prepare('INSERT INTO users (name, email, password_hash, password_salt, role) VALUES (?, ?, ?, ?, ?)').run(nome, emailNovo, hash, salt, role);
      setFlash(session.sessionId, 'success', 'Usuário cadastrado.');
      return redirect(res, '/usuarios');
    }

    if ((m = matchRoute('/usuarios/:id/editar', pathname)) && method === 'GET') {
      if (!hasManagementAccess(user)) return forbidden(res);
      const usuario = db.prepare('SELECT * FROM users WHERE id = ?').get(m.id);
      if (!usuario) return notFound(res);
      return send(res, 200, usuarioFormPage({ user, flash: takeFlash(session.sessionId), usuario, csrfToken: session.csrfToken }));
    }

    if ((m = matchRoute('/usuarios/:id', pathname)) && method === 'POST') {
      if (!hasManagementAccess(user)) return forbidden(res);
      const usuario = db.prepare('SELECT * FROM users WHERE id = ?').get(m.id);
      if (!usuario) return notFound(res);
      const nome = (body.name || '').trim();
      const emailNovo = (body.email || '').trim().toLowerCase();
      const role = ROLES.includes(body.role) ? body.role : usuario.role;
      if (!nome || !emailNovo) {
        return send(res, 400, usuarioFormPage({ user, flash: { type: 'error', message: 'Nome e e-mail são obrigatórios.' }, usuario: { ...usuario, ...body, name: nome, email: emailNovo }, csrfToken: session.csrfToken }));
      }
      const dupEmail = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(emailNovo, m.id);
      if (dupEmail) {
        return send(res, 400, usuarioFormPage({ user, flash: { type: 'error', message: 'Já existe outro usuário com esse e-mail.' }, usuario: { ...usuario, ...body, name: nome, email: emailNovo }, csrfToken: session.csrfToken }));
      }
      if (body.password && body.password.trim()) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = hashPassword(body.password, salt);
        db.prepare('UPDATE users SET name=?, email=?, role=?, password_hash=?, password_salt=? WHERE id=?').run(nome, emailNovo, role, hash, salt, m.id);
      } else {
        db.prepare('UPDATE users SET name=?, email=?, role=? WHERE id=?').run(nome, emailNovo, role, m.id);
      }
      setFlash(session.sessionId, 'success', 'Usuário atualizado.');
      return redirect(res, '/usuarios');
    }

    if ((m = matchRoute('/usuarios/:id/desativar', pathname)) && method === 'POST') {
      if (!hasManagementAccess(user)) return forbidden(res);
      if (String(user.id) === String(m.id)) {
        setFlash(session.sessionId, 'error', 'Você não pode desativar seu próprio usuário.');
        return redirect(res, '/usuarios');
      }
      const alvo = db.prepare('SELECT * FROM users WHERE id = ?').get(m.id);
      if (!alvo) return notFound(res);
      const direcaoAtivos = db.prepare("SELECT COUNT(*) c FROM users WHERE role='direcao' AND ativo=1").get().c;
      if (alvo.role === 'direcao' && direcaoAtivos <= 1) {
        setFlash(session.sessionId, 'error', 'Não é possível desativar o último usuário de Direção ativo.');
        return redirect(res, '/usuarios');
      }
      db.prepare('UPDATE users SET ativo = 0 WHERE id = ?').run(m.id);
      setFlash(session.sessionId, 'success', 'Usuário desativado.');
      return redirect(res, '/usuarios');
    }

    if ((m = matchRoute('/usuarios/:id/ativar', pathname)) && method === 'POST') {
      if (!hasManagementAccess(user)) return forbidden(res);
      db.prepare('UPDATE users SET ativo = 1 WHERE id = ?').run(m.id);
      setFlash(session.sessionId, 'success', 'Usuário reativado.');
      return redirect(res, '/usuarios');
    }

    // ---------------- AUDITORIA DE LOGIN (Direção e Gerência apenas) ----------------
    if (pathname === '/auditoria' && method === 'GET') {
      if (!hasManagementAccess(user)) return forbidden(res);
      const logs = db
        .prepare(
          `SELECT la.*, u.name as user_name FROM login_audit la
           LEFT JOIN users u ON u.id = la.user_id
           ORDER BY la.created_at DESC LIMIT 200`
        )
        .all();
      return send(res, 200, auditoriaPage({ user, flash: takeFlash(session.sessionId), logs }));
    }

    return notFound(res);
  } catch (err) {
    console.error(err);
    send(res, 500, `<h1>Erro interno</h1><pre>${escapeHtml(err.message)}</pre>`);
  }
}

const server = http.createServer(handler);
server.listen(PORT, () => {
  console.log(`Golden SaaS rodando em http://localhost:${PORT}`);
  console.log(mailConfigured() ? '[email] Envio de e-mail configurado.' : '[email] Envio de e-mail NÃO configurado (defina BREVO_API_KEY e EMAIL_FROM nas variáveis de ambiente).');
});
