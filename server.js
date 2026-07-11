'use strict';

const http = require('node:http');
const { URL } = require('node:url');

const { db } = require('./src/db');
const {
  createSession,
  destroySession,
  getSession,
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
} = require('./src/auth');
const { readBody, parseFormBody, escapeHtml } = require('./src/utils');

const { loginPage } = require('./src/views/login');
const { dashboardPage } = require('./src/views/dashboard');
const { clientesListPage, clienteFormPage, clienteShowPage } = require('./src/views/clientes');
const { bicicletasListPage, bicicletaFormPage, bicicletaShowPage } = require('./src/views/bicicletas');
const { ordensListPage, ordemFormPage, ordemShowPage } = require('./src/views/ordens');

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

// ---------- request handler ----------

const PUBLIC_PATHS = new Set(['/login']);

async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const method = req.method;

    const session = getSession(req);
    const user = session ? { id: session.userId, name: session.name, email: session.email } : null;

    // --- auth gate ---
    if (!PUBLIC_PATHS.has(pathname) && !user) {
      return redirect(res, '/login');
    }

    let body = {};
    if (method === 'POST') {
      const raw = await readBody(req);
      body = parseFormBody(raw);
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
      const found = verifyPassword((email || '').trim().toLowerCase(), password || '');
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

    // ---------------- DASHBOARD ----------------
    if (pathname === '/' && method === 'GET') {
      const counts = {
        aberta: db.prepare("SELECT COUNT(*) c FROM ordens_servico WHERE status='aberta'").get().c,
        em_andamento: db.prepare("SELECT COUNT(*) c FROM ordens_servico WHERE status='em_andamento'").get().c,
        concluida: db.prepare("SELECT COUNT(*) c FROM ordens_servico WHERE status='concluida'").get().c,
        clientes: db.prepare('SELECT COUNT(*) c FROM clientes').get().c,
        bicicletas: db.prepare('SELECT COUNT(*) c FROM bicicletas').get().c,
      };
      const recentOS = db
        .prepare(
          `SELECT os.*, c.nome as cliente_nome, b.marca, b.modelo
           FROM ordens_servico os
           JOIN clientes c ON c.id = os.cliente_id
           JOIN bicicletas b ON b.id = os.bicicleta_id
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
      return send(res, 200, dashboardPage({ user, flash: takeFlash(session.sessionId), counts, recentOS, lowBatteryBikes }));
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

    let m;
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
        bicicletaFormPage({ user, flash: takeFlash(session.sessionId), bicicleta: null, clientes, defaultClienteId: url.searchParams.get('cliente_id'), csrfToken: session.csrfToken })
      );
    }

    if (pathname === '/bicicletas' && method === 'POST') {
      const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
      if (!body.cliente_id || !body.modelo || !body.modelo.trim()) {
        return send(res, 400, bicicletaFormPage({ user, flash: { type: 'error', message: 'Cliente e modelo são obrigatórios.' }, bicicleta: body, clientes, defaultClienteId: body.cliente_id, csrfToken: session.csrfToken }));
      }
      const info = db
        .prepare(
          `INSERT INTO bicicletas (cliente_id, marca, modelo, cor, motor_serial, controladora_serial, bateria_serial, bateria_soh_percent, bateria_ciclos_carga, km_estimado, observacoes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          body.cliente_id, body.marca || '', body.modelo.trim(), body.cor || '',
          body.motor_serial || '', body.controladora_serial || '', body.bateria_serial || '',
          toIntOrNull(body.bateria_soh_percent), toIntOrNull(body.bateria_ciclos_carga), toIntOrNull(body.km_estimado),
          body.observacoes || ''
        );
      setFlash(session.sessionId, 'success', 'Bicicleta cadastrada com sucesso.');
      return redirect(res, `/bicicletas/${info.lastInsertRowid}`);
    }

    if ((m = matchRoute('/bicicletas/:id/editar', pathname)) && method === 'GET') {
      const bicicleta = db.prepare('SELECT * FROM bicicletas WHERE id = ?').get(m.id);
      if (!bicicleta) return notFound(res);
      const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
      return send(res, 200, bicicletaFormPage({ user, flash: takeFlash(session.sessionId), bicicleta, clientes, csrfToken: session.csrfToken }));
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
      if (!body.cliente_id || !body.modelo || !body.modelo.trim()) {
        return send(res, 400, bicicletaFormPage({ user, flash: { type: 'error', message: 'Cliente e modelo são obrigatórios.' }, bicicleta: { ...bicicleta, ...body }, clientes, csrfToken: session.csrfToken }));
      }
      db.prepare(
        `UPDATE bicicletas SET cliente_id=?, marca=?, modelo=?, cor=?, motor_serial=?, controladora_serial=?, bateria_serial=?, bateria_soh_percent=?, bateria_ciclos_carga=?, km_estimado=?, observacoes=? WHERE id=?`
      ).run(
        body.cliente_id, body.marca || '', body.modelo.trim(), body.cor || '',
        body.motor_serial || '', body.controladora_serial || '', body.bateria_serial || '',
        toIntOrNull(body.bateria_soh_percent), toIntOrNull(body.bateria_ciclos_carga), toIntOrNull(body.km_estimado),
        body.observacoes || '', m.id
      );
      setFlash(session.sessionId, 'success', 'Bicicleta atualizada.');
      return redirect(res, `/bicicletas/${m.id}`);
    }

    if ((m = matchRoute('/bicicletas/:id', pathname)) && method === 'GET') {
      const bicicleta = db
        .prepare(`SELECT b.*, c.nome as cliente_nome FROM bicicletas b JOIN clientes c ON c.id = b.cliente_id WHERE b.id = ?`)
        .get(m.id);
      if (!bicicleta) return notFound(res);
      const ordensServico = db.prepare('SELECT * FROM ordens_servico WHERE bicicleta_id = ? ORDER BY created_at DESC').all(m.id);
      return send(res, 200, bicicletaShowPage({ user, flash: takeFlash(session.sessionId), bicicleta, ordensServico, csrfToken: session.csrfToken }));
    }

    // ---------------- ORDENS DE SERVIÇO ----------------
    if (pathname === '/os' && method === 'GET') {
      const statusFilter = url.searchParams.get('status') || '';
      let query = `SELECT os.*, c.nome as cliente_nome, b.marca, b.modelo
                    FROM ordens_servico os
                    JOIN clientes c ON c.id = os.cliente_id
                    JOIN bicicletas b ON b.id = os.bicicleta_id`;
      let ordens;
      if (statusFilter) {
        ordens = db.prepare(query + ' WHERE os.status = ? ORDER BY os.created_at DESC').all(statusFilter);
      } else {
        ordens = db.prepare(query + ' ORDER BY os.created_at DESC').all();
      }
      return send(res, 200, ordensListPage({ user, flash: takeFlash(session.sessionId), ordens, statusFilter }));
    }

    if (pathname === '/os/novo' && method === 'GET') {
      const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
      const bicicletas = db.prepare('SELECT b.*, c.nome as cliente_nome FROM bicicletas b JOIN clientes c ON c.id=b.cliente_id ORDER BY b.created_at DESC').all();
      if (!clientes.length || !bicicletas.length) {
        setFlash(session.sessionId, 'error', 'Cadastre um cliente e uma bicicleta antes de abrir uma O.S.');
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
        return send(res, 400, ordemFormPage({ user, flash: { type: 'error', message: 'Cliente e bicicleta são obrigatórios.' }, os: null, clientes, bicicletas, csrfToken: session.csrfToken }));
      }
      const checklist = parseChecklistFromBody(body);
      const numero = nextOSNumber();
      const info = db
        .prepare(
          `INSERT INTO ordens_servico (numero, cliente_id, bicicleta_id, status, checklist_json, diagnostico, servicos_realizados, valor_estimado)
           VALUES (?, ?, ?, 'aberta', ?, ?, ?, ?)`
        )
        .run(numero, body.cliente_id, body.bicicleta_id, JSON.stringify(checklist), body.diagnostico || '', body.servicos_realizados || '', toFloatOrNull(body.valor_estimado));
      setFlash(session.sessionId, 'success', `Ordem de Serviço ${numero} criada com sucesso.`);
      return redirect(res, `/os/${info.lastInsertRowid}`);
    }

    if ((m = matchRoute('/os/:id/editar', pathname)) && method === 'GET') {
      const os = db.prepare('SELECT * FROM ordens_servico WHERE id = ?').get(m.id);
      if (!os) return notFound(res);
      const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
      const bicicletas = db.prepare('SELECT b.*, c.nome as cliente_nome FROM bicicletas b JOIN clientes c ON c.id=b.cliente_id ORDER BY b.created_at DESC').all();
      return send(res, 200, ordemFormPage({ user, flash: takeFlash(session.sessionId), os, clientes, bicicletas, csrfToken: session.csrfToken }));
    }

    if ((m = matchRoute('/os/:id/excluir', pathname)) && method === 'POST') {
      db.prepare('DELETE FROM ordens_servico WHERE id = ?').run(m.id);
      setFlash(session.sessionId, 'success', 'Ordem de Serviço excluída.');
      return redirect(res, '/os');
    }

    if ((m = matchRoute('/os/:id', pathname)) && method === 'POST') {
      const os = db.prepare('SELECT * FROM ordens_servico WHERE id = ?').get(m.id);
      if (!os) return notFound(res);
      const checklist = parseChecklistFromBody(body);
      const status = ['aberta', 'em_andamento', 'concluida'].includes(body.status) ? body.status : os.status;
      const dataConclusao = status === 'concluida' ? (os.data_conclusao || new Date().toISOString()) : null;
      db.prepare(
        `UPDATE ordens_servico SET cliente_id=?, bicicleta_id=?, status=?, checklist_json=?, diagnostico=?, servicos_realizados=?, valor_estimado=?, data_conclusao=?, updated_at=datetime('now') WHERE id=?`
      ).run(
        body.cliente_id || os.cliente_id, body.bicicleta_id || os.bicicleta_id, status, JSON.stringify(checklist),
        body.diagnostico || '', body.servicos_realizados || '', toFloatOrNull(body.valor_estimado), dataConclusao, m.id
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
      return send(res, 200, ordemShowPage({ user, flash: takeFlash(session.sessionId), os, csrfToken: session.csrfToken }));
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
});
