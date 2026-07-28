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
const { readBody, parseFormBody, escapeHtml, formatMoney, formatBytes } = require('./src/utils');
const { readRawBody, getBoundary, parseMultipart } = require('./src/multipart');
const { saveUploadedFile, deleteUploadedFile, resolveUploadPath, mimeForPath, MAX_REQUEST_BYTES } = require('./src/uploads');
const { sendMail, isConfigured: mailConfigured } = require('./src/mailer');
const {
  MODULOS,
  listNiveis,
  getNivelPermissoesMap,
  createNivel,
  renameNivel,
  deleteNivel,
  setPermissoesMatrix,
  userCanAccessModulo,
  hasManagementAccess,
  countUsuariosAtivosComAcesso,
  canSeeAllLojas,
  canSeeLoja,
  canEditLoja,
} = require('./src/roles');

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
const { niveisPage } = require('./src/views/niveis');
const { auditoriaPage } = require('./src/views/auditoria');
const { lojasListPage, lojaFormPage } = require('./src/views/lojas');
const { transferenciasListPage, transferenciaFormPage } = require('./src/views/transferencias');
const { fornecedoresListPage, fornecedorFormPage } = require('./src/views/fornecedores');
const { contasPagarListPage, contaPagarFormPage } = require('./src/views/contasPagar');
const { contasReceberListPage, contaReceberFormPage } = require('./src/views/contasReceber');
const { vendasListPage, vendaFormPage, vendaShowPage } = require('./src/views/vendas');
const { backupPage } = require('./src/views/backup');
const { runAutoBackup, buildFullBackupZip, readState: readBackupState } = require('./src/backup');

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

function getBackupRecipients() {
  // Envia backup para todo mundo com acesso ao módulo "Configurações"
  // (equivalente ao antigo "só Direção", agora generalizado para o novo
  // sistema de níveis de permissão customizáveis).
  return db
    .prepare(
      `SELECT u.email FROM users u
       JOIN nivel_permissoes np ON np.nivel_id = u.nivel_id AND np.modulo = 'configuracoes'
       WHERE u.ativo = 1 AND np.pode_ver = 1 AND u.email IS NOT NULL AND u.email != ''`
    )
    .all()
    .map((r) => r.email);
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

function gerarParcelasAReceber({ formaPagamento, parcelas, total, lojaId, clienteId, ordemServicoId, vendaId, origemLabel }) {
  if (formaPagamento !== 'credito' || !parcelas || parcelas < 1) return;
  if (!total || total <= 0) return;
  const jaExiste = ordemServicoId
    ? db.prepare('SELECT COUNT(*) c FROM contas_receber WHERE ordem_servico_id = ?').get(ordemServicoId).c
    : db.prepare('SELECT COUNT(*) c FROM contas_receber WHERE venda_id = ?').get(vendaId).c;
  if (jaExiste > 0) return;
  const valorParcela = Math.round((total / parcelas) * 100) / 100;
  const somaParcelasAnteriores = Math.round(valorParcela * (parcelas - 1) * 100) / 100;
  const ultimaParcela = Math.round((total - somaParcelasAnteriores) * 100) / 100;
  const insert = db.prepare(
    `INSERT INTO contas_receber (descricao, valor, vencimento, loja_id, cliente_id, ordem_servico_id, venda_id, numero_parcela, total_parcelas)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (let n = 1; n <= parcelas; n++) {
    const venc = new Date();
    venc.setDate(venc.getDate() + 30 * n);
    const vencStr = venc.toISOString().slice(0, 10);
    const valor = n === parcelas ? ultimaParcela : valorParcela;
    insert.run(`Parcela ${n}/${parcelas} - ${origemLabel}`, valor, vencStr, lojaId || null, clienteId, ordemServicoId || null, vendaId || null, n, parcelas);
  }
}

function gerarContasReceberDaOS(os, user) {
  gerarParcelasAReceber({
    formaPagamento: os.forma_pagamento,
    parcelas: os.parcelas,
    total: totalValor(os),
    lojaId: user.loja_id,
    clienteId: os.cliente_id,
    ordemServicoId: os.id,
    origemLabel: `O.S. ${os.numero}`,
  });
}

function gerarContasReceberDaVenda(venda, user) {
  gerarParcelasAReceber({
    formaPagamento: venda.forma_pagamento,
    parcelas: venda.parcelas,
    total: venda.valor_total,
    lojaId: venda.loja_id,
    clienteId: venda.cliente_id,
    vendaId: venda.id,
    origemLabel: `Venda ${venda.numero}`,
  });
}

function nextVendaNumber() {
  const row = db.prepare('SELECT COUNT(*) as c FROM vendas').get();
  const n = row.c + 1;
  return 'VD-' + String(n).padStart(4, '0');
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
    const user = session
      ? {
          id: session.userId,
          name: session.name,
          email: session.email,
          role: session.role,
          nivel_id: session.nivel_id,
          loja_id: session.loja_id,
          pode_ver_outras_lojas: session.pode_ver_outras_lojas,
        }
      : null;

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
          `INSERT INTO bicicletas (cliente_id, tipo_veiculo, marca, modelo, cor, motor_serial, controladora_serial, bateria_serial, chassi_numero, bateria_soh_percent, bateria_ciclos_carga, km_estimado, observacoes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          body.cliente_id, tipoVeiculo, body.marca || '', body.modelo.trim(), body.cor || '',
          body.motor_serial || '', body.controladora_serial || '', body.bateria_serial || '', body.chassi_numero || '',
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
        `UPDATE bicicletas SET cliente_id=?, tipo_veiculo=?, marca=?, modelo=?, cor=?, motor_serial=?, controladora_serial=?, bateria_serial=?, chassi_numero=?, bateria_soh_percent=?, bateria_ciclos_carga=?, km_estimado=?, observacoes=? WHERE id=?`
      ).run(
        body.cliente_id, tipoVeiculo, body.marca || '', body.modelo.trim(), body.cor || '',
        body.motor_serial || '', body.controladora_serial || '', body.bateria_serial || '', body.chassi_numero || '',
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
      const todasLojas = db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all();
      const lojasVisiveis = todasLojas.filter((l) => canSeeLoja(user, l.id));
      const lojaFiltroId = url.searchParams.get('loja_id') || '';

      const PECAS_SELECT = 'SELECT p.*, l.nome as loja_nome, f.nome as fornecedor_nome FROM pecas p LEFT JOIN lojas l ON l.id = p.loja_id LEFT JOIN fornecedores f ON f.id = p.fornecedor_id';
      let pecas;
      if (lojaFiltroId) {
        pecas = canSeeLoja(user, lojaFiltroId)
          ? db.prepare(`${PECAS_SELECT} WHERE p.loja_id = ? ORDER BY p.nome ASC`).all(lojaFiltroId)
          : [];
      } else if (canSeeAllLojas(user)) {
        pecas = db.prepare(`${PECAS_SELECT} ORDER BY p.nome ASC`).all();
      } else {
        const idsVisiveis = lojasVisiveis.map((l) => l.id);
        if (idsVisiveis.length) {
          const placeholders = idsVisiveis.map(() => '?').join(',');
          pecas = db.prepare(`${PECAS_SELECT} WHERE p.loja_id IN (${placeholders}) ORDER BY p.nome ASC`).all(...idsVisiveis);
        } else {
          pecas = [];
        }
      }
      pecas.forEach((p) => { p.__podeEditar = canEditLoja(user, p.loja_id); });

      return send(res, 200, pecasListPage({
        user,
        flash: takeFlash(session.sessionId),
        pecas,
        csrfToken: session.csrfToken,
        lojas: lojasVisiveis,
        lojaFiltroId,
        mostrarColunaLoja: lojasVisiveis.length > 1,
      }));
    }

    if (pathname === '/estoque/novo' && method === 'GET') {
      const lojaPropria = user.loja_id ? db.prepare('SELECT * FROM lojas WHERE id = ?').get(user.loja_id) : null;
      const lojas = canSeeAllLojas(user) ? db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all() : [];
      const fornecedores = db.prepare('SELECT * FROM fornecedores WHERE ativo = 1 ORDER BY nome ASC').all();
      return send(res, 200, pecaFormPage({
        user,
        flash: takeFlash(session.sessionId),
        peca: null,
        csrfToken: session.csrfToken,
        lojas,
        lojaFixaNome: canSeeAllLojas(user) ? null : (lojaPropria ? lojaPropria.nome : null),
        fornecedores,
      }));
    }

    if (pathname === '/estoque' && method === 'POST') {
      const lojaPropria = user.loja_id ? db.prepare('SELECT * FROM lojas WHERE id = ?').get(user.loja_id) : null;
      const lojas = canSeeAllLojas(user) ? db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all() : [];
      const fornecedores = db.prepare('SELECT * FROM fornecedores WHERE ativo = 1 ORDER BY nome ASC').all();
      const lojaFixaNome = canSeeAllLojas(user) ? null : (lojaPropria ? lojaPropria.nome : null);
      const lojaIdEscolhida = canSeeAllLojas(user) ? toIntOrNull(body.loja_id) : user.loja_id;
      const fornecedorId = toIntOrNull(body.fornecedor_id);

      if (!body.nome || !body.nome.trim() || !lojaIdEscolhida) {
        return send(res, 400, pecaFormPage({ user, flash: { type: 'error', message: 'Nome da peça e loja são obrigatórios.' }, peca: body, csrfToken: session.csrfToken, lojas, lojaFixaNome, fornecedores }));
      }
      const precoVenda = toFloatOrNull(body.preco_venda) || 0;
      const info = db
        .prepare(
          `INSERT INTO pecas (nome, categoria, numero_serie, quantidade, estoque_minimo, custo_unitario, preco_venda, observacoes, loja_id, fornecedor_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          body.nome.trim(), body.categoria || '', body.numero_serie || '',
          toIntOrNull(body.quantidade) || 0, toIntOrNull(body.estoque_minimo) || 0,
          toFloatOrNull(body.custo_unitario), precoVenda, body.observacoes || '', lojaIdEscolhida, fornecedorId
        );
      setFlash(session.sessionId, 'success', 'Peça cadastrada no estoque.');
      return redirect(res, `/estoque/${info.lastInsertRowid}/editar`);
    }

    if ((m = matchRoute('/estoque/:id/editar', pathname)) && method === 'GET') {
      const peca = db.prepare('SELECT * FROM pecas WHERE id = ?').get(m.id);
      if (!peca) return notFound(res);
      if (!canEditLoja(user, peca.loja_id)) return forbidden(res);
      const lojaPropria = user.loja_id ? db.prepare('SELECT * FROM lojas WHERE id = ?').get(user.loja_id) : null;
      const lojas = canSeeAllLojas(user) ? db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all() : [];
      const fornecedores = db.prepare('SELECT * FROM fornecedores WHERE ativo = 1 ORDER BY nome ASC').all();
      return send(res, 200, pecaFormPage({
        user,
        flash: takeFlash(session.sessionId),
        peca,
        csrfToken: session.csrfToken,
        lojas,
        lojaFixaNome: canSeeAllLojas(user) ? null : (lojaPropria ? lojaPropria.nome : null),
        fornecedores,
      }));
    }

    if ((m = matchRoute('/estoque/:id/excluir', pathname)) && method === 'POST') {
      const peca = db.prepare('SELECT * FROM pecas WHERE id = ?').get(m.id);
      if (!peca) return notFound(res);
      if (!canEditLoja(user, peca.loja_id)) return forbidden(res);
      db.prepare('DELETE FROM pecas WHERE id = ?').run(m.id);
      setFlash(session.sessionId, 'success', 'Peça excluída do estoque.');
      return redirect(res, '/estoque');
    }

    if ((m = matchRoute('/estoque/:id', pathname)) && method === 'POST') {
      const peca = db.prepare('SELECT * FROM pecas WHERE id = ?').get(m.id);
      if (!peca) return notFound(res);
      if (!canEditLoja(user, peca.loja_id)) return forbidden(res);
      const lojaPropria = user.loja_id ? db.prepare('SELECT * FROM lojas WHERE id = ?').get(user.loja_id) : null;
      const lojas = canSeeAllLojas(user) ? db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all() : [];
      const fornecedores = db.prepare('SELECT * FROM fornecedores WHERE ativo = 1 ORDER BY nome ASC').all();
      const lojaFixaNome = canSeeAllLojas(user) ? null : (lojaPropria ? lojaPropria.nome : null);
      const lojaIdEscolhida = canSeeAllLojas(user) ? (toIntOrNull(body.loja_id) || peca.loja_id) : peca.loja_id;
      const fornecedorId = toIntOrNull(body.fornecedor_id);

      if (!body.nome || !body.nome.trim()) {
        return send(res, 400, pecaFormPage({ user, flash: { type: 'error', message: 'Nome da peça é obrigatório.' }, peca: { ...peca, ...body }, csrfToken: session.csrfToken, lojas, lojaFixaNome, fornecedores }));
      }
      const precoVenda = toFloatOrNull(body.preco_venda) || 0;
      db.prepare(
        `UPDATE pecas SET nome=?, categoria=?, numero_serie=?, quantidade=?, estoque_minimo=?, custo_unitario=?, preco_venda=?, observacoes=?, loja_id=?, fornecedor_id=?, updated_at=datetime('now') WHERE id=?`
      ).run(
        body.nome.trim(), body.categoria || '', body.numero_serie || '',
        toIntOrNull(body.quantidade) || 0, toIntOrNull(body.estoque_minimo) || 0,
        toFloatOrNull(body.custo_unitario), precoVenda, body.observacoes || '', lojaIdEscolhida, fornecedorId, m.id
      );
      setFlash(session.sessionId, 'success', 'Peça atualizada.');
      return redirect(res, `/estoque/${m.id}/editar`);
    }

    // ---------------- LOJAS (Direção e Gerência apenas) ----------------
    if (pathname === '/lojas' && method === 'GET') {
      if (!hasManagementAccess(user)) return forbidden(res);
      const lojas = db.prepare('SELECT * FROM lojas ORDER BY nome ASC').all();
      return send(res, 200, lojasListPage({ user, flash: takeFlash(session.sessionId), lojas }));
    }

    if (pathname === '/lojas/novo' && method === 'GET') {
      if (!hasManagementAccess(user)) return forbidden(res);
      return send(res, 200, lojaFormPage({ user, flash: takeFlash(session.sessionId), loja: null, csrfToken: session.csrfToken }));
    }

    if (pathname === '/lojas' && method === 'POST') {
      if (!hasManagementAccess(user)) return forbidden(res);
      if (!body.nome || !body.nome.trim()) {
        return send(res, 400, lojaFormPage({ user, flash: { type: 'error', message: 'Nome da loja é obrigatório.' }, loja: body, csrfToken: session.csrfToken }));
      }
      const info = db
        .prepare('INSERT INTO lojas (nome, endereco, telefone) VALUES (?, ?, ?)')
        .run(body.nome.trim(), body.endereco || '', body.telefone || '');
      setFlash(session.sessionId, 'success', 'Loja cadastrada.');
      return redirect(res, '/lojas');
    }

    if ((m = matchRoute('/lojas/:id/editar', pathname)) && method === 'GET') {
      if (!hasManagementAccess(user)) return forbidden(res);
      const loja = db.prepare('SELECT * FROM lojas WHERE id = ?').get(m.id);
      if (!loja) return notFound(res);
      return send(res, 200, lojaFormPage({ user, flash: takeFlash(session.sessionId), loja, csrfToken: session.csrfToken }));
    }

    if ((m = matchRoute('/lojas/:id', pathname)) && method === 'POST') {
      if (!hasManagementAccess(user)) return forbidden(res);
      const loja = db.prepare('SELECT * FROM lojas WHERE id = ?').get(m.id);
      if (!loja) return notFound(res);
      if (!body.nome || !body.nome.trim()) {
        return send(res, 400, lojaFormPage({ user, flash: { type: 'error', message: 'Nome da loja é obrigatório.' }, loja: { ...loja, ...body }, csrfToken: session.csrfToken }));
      }
      const ativo = body.ativo === '0' ? 0 : 1;
      if (ativo === 0 && loja.ativo === 1) {
        const lojasAtivas = db.prepare('SELECT COUNT(*) c FROM lojas WHERE ativo = 1').get().c;
        if (lojasAtivas <= 1) {
          return send(res, 400, lojaFormPage({ user, flash: { type: 'error', message: 'Não é possível desativar a última loja ativa do sistema — sem nenhuma loja ativa, ninguém consegue cadastrar peças, vendas ou lançamentos financeiros. Cadastre outra loja antes de desativar esta.' }, loja: { ...loja, ...body }, csrfToken: session.csrfToken }));
        }
      }
      db.prepare('UPDATE lojas SET nome=?, endereco=?, telefone=?, ativo=? WHERE id=?').run(
        body.nome.trim(), body.endereco || '', body.telefone || '', ativo, m.id
      );
      setFlash(session.sessionId, 'success', 'Loja atualizada.');
      return redirect(res, '/lojas');
    }

    // ---------------- TRANSFERÊNCIAS ENTRE LOJAS ----------------
    if (pathname === '/transferencias' && method === 'GET') {
      const transferencias = db
        .prepare(
          `SELECT t.*, lo.nome as loja_origem_nome, ld.nome as loja_destino_nome, u.name as solicitante_nome
           FROM transferencias t
           JOIN lojas lo ON lo.id = t.loja_origem_id
           JOIN lojas ld ON ld.id = t.loja_destino_id
           LEFT JOIN users u ON u.id = t.solicitado_por
           ORDER BY t.created_at DESC`
        )
        .all();
      return send(res, 200, transferenciasListPage({ user, flash: takeFlash(session.sessionId), transferencias, csrfToken: session.csrfToken }));
    }

    if (pathname === '/transferencias/novo' && method === 'GET') {
      const pecaId = url.searchParams.get('peca_id');
      const peca = db.prepare('SELECT * FROM pecas WHERE id = ?').get(pecaId);
      if (!peca) {
        setFlash(session.sessionId, 'error', 'Peça não encontrada.');
        return redirect(res, '/estoque');
      }
      if (!canSeeLoja(user, peca.loja_id)) return forbidden(res);
      const lojasDestino = db.prepare('SELECT * FROM lojas WHERE ativo = 1 AND id != ? ORDER BY nome ASC').all(peca.loja_id);
      return send(res, 200, transferenciaFormPage({ user, flash: takeFlash(session.sessionId), peca, lojasDestino, csrfToken: session.csrfToken }));
    }

    if (pathname === '/transferencias' && method === 'POST') {
      const peca = db.prepare('SELECT * FROM pecas WHERE id = ?').get(body.peca_id);
      if (!peca) {
        setFlash(session.sessionId, 'error', 'Peça não encontrada.');
        return redirect(res, '/estoque');
      }
      if (!canSeeLoja(user, peca.loja_id)) return forbidden(res);
      const quantidade = toIntOrNull(body.quantidade) || 0;
      const lojaDestinoId = toIntOrNull(body.loja_destino_id);
      const lojaDestino = lojaDestinoId ? db.prepare('SELECT * FROM lojas WHERE id = ? AND ativo = 1').get(lojaDestinoId) : null;
      if (quantidade < 1 || quantidade > peca.quantidade) {
        setFlash(session.sessionId, 'error', 'Quantidade inválida para transferência.');
        return redirect(res, `/transferencias/novo?peca_id=${peca.id}`);
      }
      if (!lojaDestino || String(lojaDestino.id) === String(peca.loja_id)) {
        setFlash(session.sessionId, 'error', 'Selecione uma loja destino válida.');
        return redirect(res, `/transferencias/novo?peca_id=${peca.id}`);
      }
      db.prepare(
        `INSERT INTO transferencias (peca_origem_id, nome_peca, categoria, custo_unitario, preco_venda, quantidade, loja_origem_id, loja_destino_id, observacoes, solicitado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        peca.id, peca.nome, peca.categoria, peca.custo_unitario, peca.preco_venda, quantidade,
        peca.loja_id, lojaDestino.id, body.observacoes || '', user.id
      );
      setFlash(session.sessionId, 'success', `Transferência de "${peca.nome}" solicitada. Aguardando aprovação da Direção/Gerência.`);
      return redirect(res, '/transferencias');
    }

    if ((m = matchRoute('/transferencias/:id/aprovar', pathname)) && method === 'POST') {
      if (!hasManagementAccess(user)) return forbidden(res);
      const t = db.prepare('SELECT * FROM transferencias WHERE id = ?').get(m.id);
      if (!t) return notFound(res);
      if (t.status !== 'pendente_aprovacao') {
        setFlash(session.sessionId, 'error', 'Esta transferência já foi processada.');
        return redirect(res, '/transferencias');
      }
      const pecaOrigem = t.peca_origem_id ? db.prepare('SELECT * FROM pecas WHERE id = ?').get(t.peca_origem_id) : null;
      if (!pecaOrigem || pecaOrigem.quantidade < t.quantidade) {
        setFlash(session.sessionId, 'error', 'Estoque insuficiente na loja de origem para aprovar esta transferência.');
        return redirect(res, '/transferencias');
      }
      db.prepare("UPDATE pecas SET quantidade = quantidade - ?, updated_at = datetime('now') WHERE id = ?").run(t.quantidade, pecaOrigem.id);
      db.prepare("UPDATE transferencias SET status = 'em_transito', aprovado_por = ?, aprovado_at = datetime('now') WHERE id = ?").run(user.id, t.id);
      setFlash(session.sessionId, 'success', 'Transferência aprovada. Estoque de origem já foi debitado — aguardando confirmação de recebimento na loja destino.');
      return redirect(res, '/transferencias');
    }

    if ((m = matchRoute('/transferencias/:id/recusar', pathname)) && method === 'POST') {
      if (!hasManagementAccess(user)) return forbidden(res);
      const t = db.prepare('SELECT * FROM transferencias WHERE id = ?').get(m.id);
      if (!t) return notFound(res);
      if (t.status !== 'pendente_aprovacao') {
        setFlash(session.sessionId, 'error', 'Esta transferência já foi processada.');
        return redirect(res, '/transferencias');
      }
      db.prepare("UPDATE transferencias SET status = 'recusada' WHERE id = ?").run(t.id);
      setFlash(session.sessionId, 'success', 'Transferência recusada.');
      return redirect(res, '/transferencias');
    }

    if ((m = matchRoute('/transferencias/:id/confirmar-recebimento', pathname)) && method === 'POST') {
      const t = db.prepare('SELECT * FROM transferencias WHERE id = ?').get(m.id);
      if (!t) return notFound(res);
      const podeConfirmar = hasManagementAccess(user) || String(user.loja_id) === String(t.loja_destino_id);
      if (!podeConfirmar) return forbidden(res);
      if (t.status !== 'em_transito') {
        setFlash(session.sessionId, 'error', 'Esta transferência não está aguardando recebimento.');
        return redirect(res, '/transferencias');
      }
      let pecaDestino = db.prepare('SELECT * FROM pecas WHERE loja_id = ? AND nome = ?').get(t.loja_destino_id, t.nome_peca);
      if (pecaDestino) {
        db.prepare("UPDATE pecas SET quantidade = quantidade + ?, updated_at = datetime('now') WHERE id = ?").run(t.quantidade, pecaDestino.id);
      } else {
        db.prepare(
          `INSERT INTO pecas (nome, categoria, quantidade, estoque_minimo, custo_unitario, preco_venda, loja_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(t.nome_peca, t.categoria || '', t.quantidade, 1, t.custo_unitario, t.preco_venda || 0, t.loja_destino_id);
      }
      db.prepare("UPDATE transferencias SET status = 'recebida', recebido_por = ?, recebido_at = datetime('now') WHERE id = ?").run(user.id, t.id);
      setFlash(session.sessionId, 'success', `Recebimento confirmado. "${t.nome_peca}" já está no estoque desta loja.`);
      return redirect(res, '/transferencias');
    }

    // ---------------- FORNECEDORES ----------------
    if (pathname === '/fornecedores' && method === 'GET') {
      const fornecedores = db.prepare('SELECT * FROM fornecedores ORDER BY nome ASC').all();
      return send(res, 200, fornecedoresListPage({ user, flash: takeFlash(session.sessionId), fornecedores }));
    }

    if (pathname === '/fornecedores/novo' && method === 'GET') {
      return send(res, 200, fornecedorFormPage({ user, flash: takeFlash(session.sessionId), fornecedor: null, csrfToken: session.csrfToken }));
    }

    if (pathname === '/fornecedores' && method === 'POST') {
      if (!body.nome || !body.nome.trim()) {
        return send(res, 400, fornecedorFormPage({ user, flash: { type: 'error', message: 'Nome do fornecedor é obrigatório.' }, fornecedor: body, csrfToken: session.csrfToken }));
      }
      const info = db
        .prepare('INSERT INTO fornecedores (nome, cnpj_cpf, telefone, email, endereco, observacoes) VALUES (?, ?, ?, ?, ?, ?)')
        .run(body.nome.trim(), body.cnpj_cpf || '', body.telefone || '', body.email || '', body.endereco || '', body.observacoes || '');
      setFlash(session.sessionId, 'success', 'Fornecedor cadastrado.');
      return redirect(res, '/fornecedores');
    }

    if ((m = matchRoute('/fornecedores/:id/editar', pathname)) && method === 'GET') {
      const fornecedor = db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(m.id);
      if (!fornecedor) return notFound(res);
      return send(res, 200, fornecedorFormPage({ user, flash: takeFlash(session.sessionId), fornecedor, csrfToken: session.csrfToken }));
    }

    if ((m = matchRoute('/fornecedores/:id', pathname)) && method === 'POST') {
      const fornecedor = db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(m.id);
      if (!fornecedor) return notFound(res);
      if (!body.nome || !body.nome.trim()) {
        return send(res, 400, fornecedorFormPage({ user, flash: { type: 'error', message: 'Nome do fornecedor é obrigatório.' }, fornecedor: { ...fornecedor, ...body }, csrfToken: session.csrfToken }));
      }
      const ativo = body.ativo === '0' ? 0 : 1;
      db.prepare('UPDATE fornecedores SET nome=?, cnpj_cpf=?, telefone=?, email=?, endereco=?, observacoes=?, ativo=? WHERE id=?').run(
        body.nome.trim(), body.cnpj_cpf || '', body.telefone || '', body.email || '', body.endereco || '', body.observacoes || '', ativo, m.id
      );
      setFlash(session.sessionId, 'success', 'Fornecedor atualizado.');
      return redirect(res, '/fornecedores');
    }

    // ---------------- CONTAS A PAGAR ----------------
    if (pathname === '/contas-pagar' && method === 'GET') {
      const statusFilter = url.searchParams.get('status') || '';
      const lojaFiltroId = url.searchParams.get('loja_id') || '';
      const todasLojas = db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all();
      const lojasVisiveis = todasLojas.filter((l) => canSeeLoja(user, l.id));

      let query = `SELECT c.*, l.nome as loja_nome, f.nome as fornecedor_nome
                   FROM contas_pagar c
                   LEFT JOIN lojas l ON l.id = c.loja_id
                   LEFT JOIN fornecedores f ON f.id = c.fornecedor_id`;
      const params = [];
      if (statusFilter) {
        query += ' WHERE c.status = ?';
        params.push(statusFilter);
      }
      query += ' ORDER BY c.vencimento ASC, c.created_at DESC';
      let contas = db.prepare(query).all(...params);
      contas = contas.filter((c) => canSeeLoja(user, c.loja_id));
      if (lojaFiltroId) contas = contas.filter((c) => String(c.loja_id) === String(lojaFiltroId));
      contas.forEach((c) => { c.__podeEditar = canEditLoja(user, c.loja_id); });

      return send(res, 200, contasPagarListPage({
        user,
        flash: takeFlash(session.sessionId),
        contas,
        csrfToken: session.csrfToken,
        lojas: lojasVisiveis,
        lojaFiltroId,
        mostrarColunaLoja: lojasVisiveis.length > 1,
        statusFilter,
      }));
    }

    if (pathname === '/contas-pagar/novo' && method === 'GET') {
      const lojaPropria = user.loja_id ? db.prepare('SELECT * FROM lojas WHERE id = ?').get(user.loja_id) : null;
      const lojas = canSeeAllLojas(user) ? db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all() : [];
      const fornecedores = db.prepare('SELECT * FROM fornecedores WHERE ativo = 1 ORDER BY nome ASC').all();
      return send(res, 200, contaPagarFormPage({
        user, flash: takeFlash(session.sessionId), conta: null, csrfToken: session.csrfToken,
        lojas, lojaFixaNome: canSeeAllLojas(user) ? null : (lojaPropria ? lojaPropria.nome : null), fornecedores,
      }));
    }

    if (pathname === '/contas-pagar' && method === 'POST') {
      const lojaPropria = user.loja_id ? db.prepare('SELECT * FROM lojas WHERE id = ?').get(user.loja_id) : null;
      const lojas = canSeeAllLojas(user) ? db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all() : [];
      const fornecedores = db.prepare('SELECT * FROM fornecedores WHERE ativo = 1 ORDER BY nome ASC').all();
      const lojaFixaNome = canSeeAllLojas(user) ? null : (lojaPropria ? lojaPropria.nome : null);
      const lojaIdEscolhida = canSeeAllLojas(user) ? toIntOrNull(body.loja_id) : user.loja_id;
      if (!body.descricao || !body.descricao.trim() || !body.valor) {
        return send(res, 400, contaPagarFormPage({ user, flash: { type: 'error', message: 'Descrição e valor são obrigatórios.' }, conta: body, csrfToken: session.csrfToken, lojas, lojaFixaNome, fornecedores }));
      }
      db.prepare(
        `INSERT INTO contas_pagar (descricao, valor, vencimento, forma_pagamento, loja_id, fornecedor_id, observacoes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        body.descricao.trim(), toFloatOrNull(body.valor) || 0, body.vencimento || null, body.forma_pagamento || '',
        lojaIdEscolhida, toIntOrNull(body.fornecedor_id), body.observacoes || ''
      );
      setFlash(session.sessionId, 'success', 'Conta a pagar cadastrada.');
      return redirect(res, '/contas-pagar');
    }

    if ((m = matchRoute('/contas-pagar/:id/editar', pathname)) && method === 'GET') {
      const conta = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(m.id);
      if (!conta) return notFound(res);
      if (!canEditLoja(user, conta.loja_id)) return forbidden(res);
      const lojaPropria = user.loja_id ? db.prepare('SELECT * FROM lojas WHERE id = ?').get(user.loja_id) : null;
      const lojas = canSeeAllLojas(user) ? db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all() : [];
      const fornecedores = db.prepare('SELECT * FROM fornecedores WHERE ativo = 1 ORDER BY nome ASC').all();
      return send(res, 200, contaPagarFormPage({
        user, flash: takeFlash(session.sessionId), conta, csrfToken: session.csrfToken,
        lojas, lojaFixaNome: canSeeAllLojas(user) ? null : (lojaPropria ? lojaPropria.nome : null), fornecedores,
      }));
    }

    if ((m = matchRoute('/contas-pagar/:id', pathname)) && method === 'POST') {
      const conta = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(m.id);
      if (!conta) return notFound(res);
      if (!canEditLoja(user, conta.loja_id)) return forbidden(res);
      const lojaPropria = user.loja_id ? db.prepare('SELECT * FROM lojas WHERE id = ?').get(user.loja_id) : null;
      const lojas = canSeeAllLojas(user) ? db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all() : [];
      const fornecedores = db.prepare('SELECT * FROM fornecedores WHERE ativo = 1 ORDER BY nome ASC').all();
      const lojaFixaNome = canSeeAllLojas(user) ? null : (lojaPropria ? lojaPropria.nome : null);
      const lojaIdEscolhida = canSeeAllLojas(user) ? toIntOrNull(body.loja_id) : conta.loja_id;
      if (!body.descricao || !body.descricao.trim() || !body.valor) {
        return send(res, 400, contaPagarFormPage({ user, flash: { type: 'error', message: 'Descrição e valor são obrigatórios.' }, conta: { ...conta, ...body }, csrfToken: session.csrfToken, lojas, lojaFixaNome, fornecedores }));
      }
      db.prepare(
        `UPDATE contas_pagar SET descricao=?, valor=?, vencimento=?, forma_pagamento=?, loja_id=?, fornecedor_id=?, observacoes=?, updated_at=datetime('now') WHERE id=?`
      ).run(
        body.descricao.trim(), toFloatOrNull(body.valor) || 0, body.vencimento || null, body.forma_pagamento || '',
        lojaIdEscolhida, toIntOrNull(body.fornecedor_id), body.observacoes || '', m.id
      );
      setFlash(session.sessionId, 'success', 'Conta a pagar atualizada.');
      return redirect(res, `/contas-pagar/${m.id}/editar`);
    }

    if ((m = matchRoute('/contas-pagar/:id/marcar-pago', pathname)) && method === 'POST') {
      const conta = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(m.id);
      if (!conta) return notFound(res);
      if (!canEditLoja(user, conta.loja_id)) return forbidden(res);
      db.prepare("UPDATE contas_pagar SET status='pago', pago_em=datetime('now'), updated_at=datetime('now') WHERE id=?").run(m.id);
      setFlash(session.sessionId, 'success', 'Conta marcada como paga.');
      return redirect(res, '/contas-pagar');
    }

    if ((m = matchRoute('/contas-pagar/:id/reabrir', pathname)) && method === 'POST') {
      const conta = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(m.id);
      if (!conta) return notFound(res);
      if (!canEditLoja(user, conta.loja_id)) return forbidden(res);
      db.prepare("UPDATE contas_pagar SET status='pendente', pago_em=NULL, updated_at=datetime('now') WHERE id=?").run(m.id);
      setFlash(session.sessionId, 'success', 'Conta reaberta como pendente.');
      return redirect(res, '/contas-pagar');
    }

    if ((m = matchRoute('/contas-pagar/:id/excluir', pathname)) && method === 'POST') {
      const conta = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(m.id);
      if (!conta) return notFound(res);
      if (!canEditLoja(user, conta.loja_id)) return forbidden(res);
      db.prepare('DELETE FROM contas_pagar WHERE id = ?').run(m.id);
      setFlash(session.sessionId, 'success', 'Conta a pagar excluída.');
      return redirect(res, '/contas-pagar');
    }

    // ---------------- CONTAS A RECEBER ----------------
    if (pathname === '/contas-receber' && method === 'GET') {
      const statusFilter = url.searchParams.get('status') || '';
      const lojaFiltroId = url.searchParams.get('loja_id') || '';
      const todasLojas = db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all();
      const lojasVisiveis = todasLojas.filter((l) => canSeeLoja(user, l.id));

      let query = `SELECT c.*, l.nome as loja_nome, cl.nome as cliente_nome, os.numero as os_numero, v.numero as venda_numero
                   FROM contas_receber c
                   LEFT JOIN lojas l ON l.id = c.loja_id
                   LEFT JOIN clientes cl ON cl.id = c.cliente_id
                   LEFT JOIN ordens_servico os ON os.id = c.ordem_servico_id
                   LEFT JOIN vendas v ON v.id = c.venda_id`;
      const params = [];
      if (statusFilter) {
        query += ' WHERE c.status = ?';
        params.push(statusFilter);
      }
      query += ' ORDER BY c.vencimento ASC, c.created_at DESC';
      let contas = db.prepare(query).all(...params);
      contas = contas.filter((c) => canSeeLoja(user, c.loja_id));
      if (lojaFiltroId) contas = contas.filter((c) => String(c.loja_id) === String(lojaFiltroId));
      contas.forEach((c) => { c.__podeEditar = canEditLoja(user, c.loja_id); });

      return send(res, 200, contasReceberListPage({
        user,
        flash: takeFlash(session.sessionId),
        contas,
        csrfToken: session.csrfToken,
        lojas: lojasVisiveis,
        lojaFiltroId,
        mostrarColunaLoja: lojasVisiveis.length > 1,
        statusFilter,
      }));
    }

    if (pathname === '/contas-receber/novo' && method === 'GET') {
      const lojaPropria = user.loja_id ? db.prepare('SELECT * FROM lojas WHERE id = ?').get(user.loja_id) : null;
      const lojas = canSeeAllLojas(user) ? db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all() : [];
      const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
      return send(res, 200, contaReceberFormPage({
        user, flash: takeFlash(session.sessionId), conta: null, csrfToken: session.csrfToken,
        lojas, lojaFixaNome: canSeeAllLojas(user) ? null : (lojaPropria ? lojaPropria.nome : null), clientes,
      }));
    }

    if (pathname === '/contas-receber' && method === 'POST') {
      const lojaPropria = user.loja_id ? db.prepare('SELECT * FROM lojas WHERE id = ?').get(user.loja_id) : null;
      const lojas = canSeeAllLojas(user) ? db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all() : [];
      const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
      const lojaFixaNome = canSeeAllLojas(user) ? null : (lojaPropria ? lojaPropria.nome : null);
      const lojaIdEscolhida = canSeeAllLojas(user) ? toIntOrNull(body.loja_id) : user.loja_id;
      if (!body.descricao || !body.descricao.trim() || !body.valor) {
        return send(res, 400, contaReceberFormPage({ user, flash: { type: 'error', message: 'Descrição e valor são obrigatórios.' }, conta: body, csrfToken: session.csrfToken, lojas, lojaFixaNome, clientes }));
      }
      db.prepare(
        `INSERT INTO contas_receber (descricao, valor, vencimento, loja_id, cliente_id, observacoes)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        body.descricao.trim(), toFloatOrNull(body.valor) || 0, body.vencimento || null,
        lojaIdEscolhida, toIntOrNull(body.cliente_id), body.observacoes || ''
      );
      setFlash(session.sessionId, 'success', 'Conta a receber cadastrada.');
      return redirect(res, '/contas-receber');
    }

    if ((m = matchRoute('/contas-receber/:id/editar', pathname)) && method === 'GET') {
      const conta = db.prepare('SELECT c.*, os.numero as os_numero, v.numero as venda_numero FROM contas_receber c LEFT JOIN ordens_servico os ON os.id = c.ordem_servico_id LEFT JOIN vendas v ON v.id = c.venda_id WHERE c.id = ?').get(m.id);
      if (!conta) return notFound(res);
      if (!canEditLoja(user, conta.loja_id)) return forbidden(res);
      const lojaPropria = user.loja_id ? db.prepare('SELECT * FROM lojas WHERE id = ?').get(user.loja_id) : null;
      const lojas = canSeeAllLojas(user) ? db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all() : [];
      const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
      return send(res, 200, contaReceberFormPage({
        user, flash: takeFlash(session.sessionId), conta, csrfToken: session.csrfToken,
        lojas, lojaFixaNome: canSeeAllLojas(user) ? null : (lojaPropria ? lojaPropria.nome : null), clientes,
      }));
    }

    if ((m = matchRoute('/contas-receber/:id', pathname)) && method === 'POST') {
      const conta = db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(m.id);
      if (!conta) return notFound(res);
      if (!canEditLoja(user, conta.loja_id)) return forbidden(res);
      const lojaPropria = user.loja_id ? db.prepare('SELECT * FROM lojas WHERE id = ?').get(user.loja_id) : null;
      const lojas = canSeeAllLojas(user) ? db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all() : [];
      const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
      const lojaFixaNome = canSeeAllLojas(user) ? null : (lojaPropria ? lojaPropria.nome : null);
      const lojaIdEscolhida = canSeeAllLojas(user) ? toIntOrNull(body.loja_id) : conta.loja_id;
      if (!body.descricao || !body.descricao.trim() || !body.valor) {
        return send(res, 400, contaReceberFormPage({ user, flash: { type: 'error', message: 'Descrição e valor são obrigatórios.' }, conta: { ...conta, ...body }, csrfToken: session.csrfToken, lojas, lojaFixaNome, clientes }));
      }
      db.prepare(
        `UPDATE contas_receber SET descricao=?, valor=?, vencimento=?, loja_id=?, cliente_id=?, observacoes=?, updated_at=datetime('now') WHERE id=?`
      ).run(
        body.descricao.trim(), toFloatOrNull(body.valor) || 0, body.vencimento || null,
        lojaIdEscolhida, toIntOrNull(body.cliente_id), body.observacoes || '', m.id
      );
      setFlash(session.sessionId, 'success', 'Conta a receber atualizada.');
      return redirect(res, `/contas-receber/${m.id}/editar`);
    }

    if ((m = matchRoute('/contas-receber/:id/marcar-recebido', pathname)) && method === 'POST') {
      const conta = db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(m.id);
      if (!conta) return notFound(res);
      if (!canEditLoja(user, conta.loja_id)) return forbidden(res);
      db.prepare("UPDATE contas_receber SET status='recebido', recebido_em=datetime('now'), updated_at=datetime('now') WHERE id=?").run(m.id);
      setFlash(session.sessionId, 'success', 'Conta marcada como recebida.');
      return redirect(res, '/contas-receber');
    }

    if ((m = matchRoute('/contas-receber/:id/reabrir', pathname)) && method === 'POST') {
      const conta = db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(m.id);
      if (!conta) return notFound(res);
      if (!canEditLoja(user, conta.loja_id)) return forbidden(res);
      db.prepare("UPDATE contas_receber SET status='pendente', recebido_em=NULL, updated_at=datetime('now') WHERE id=?").run(m.id);
      setFlash(session.sessionId, 'success', 'Conta reaberta como pendente.');
      return redirect(res, '/contas-receber');
    }

    if ((m = matchRoute('/contas-receber/:id/excluir', pathname)) && method === 'POST') {
      const conta = db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(m.id);
      if (!conta) return notFound(res);
      if (!canEditLoja(user, conta.loja_id)) return forbidden(res);
      db.prepare('DELETE FROM contas_receber WHERE id = ?').run(m.id);
      setFlash(session.sessionId, 'success', 'Conta a receber excluída.');
      return redirect(res, '/contas-receber');
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

      try {
        gerarContasReceberDaOS(os, user);
      } catch (err) {
        console.error('[contas-receber] Falha ao gerar parcelas a partir da O.S.:', err);
      }

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
      const pecasDisponiveis = canSeeAllLojas(user)
        ? db.prepare('SELECT * FROM pecas ORDER BY nome ASC').all()
        : db.prepare('SELECT * FROM pecas WHERE loja_id = ? ORDER BY nome ASC').all(user.loja_id);
      return send(res, 200, ordemShowPage({ user, flash: takeFlash(session.sessionId), os, midiasChecklist, midiasServico, osPecas, pecasDisponiveis, csrfToken: session.csrfToken }));
    }

    // ---------------- VENDA DIRETO ----------------
    if (pathname === '/vendas' && method === 'GET') {
      const lojaFiltroId = url.searchParams.get('loja_id') || '';
      const todasLojas = db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all();
      const lojasVisiveis = todasLojas.filter((l) => canSeeLoja(user, l.id));

      let vendas = db
        .prepare(
          `SELECT v.*, l.nome as loja_nome, c.nome as cliente_nome
           FROM vendas v
           LEFT JOIN lojas l ON l.id = v.loja_id
           JOIN clientes c ON c.id = v.cliente_id
           ORDER BY v.created_at DESC`
        )
        .all();
      vendas = vendas.filter((v) => canSeeLoja(user, v.loja_id));
      if (lojaFiltroId) vendas = vendas.filter((v) => String(v.loja_id) === String(lojaFiltroId));

      return send(res, 200, vendasListPage({
        user,
        flash: takeFlash(session.sessionId),
        vendas,
        lojas: lojasVisiveis,
        lojaFiltroId,
        mostrarColunaLoja: lojasVisiveis.length > 1,
      }));
    }

    if (pathname === '/vendas/novo' && method === 'GET') {
      const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
      if (!clientes.length) {
        setFlash(session.sessionId, 'error', 'Cadastre um cliente antes de registrar uma venda.');
        return redirect(res, '/clientes/novo');
      }
      const lojaPropria = user.loja_id ? db.prepare('SELECT * FROM lojas WHERE id = ?').get(user.loja_id) : null;
      const lojas = canSeeAllLojas(user) ? db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all() : [];
      return send(res, 200, vendaFormPage({
        user, flash: takeFlash(session.sessionId), clientes, csrfToken: session.csrfToken,
        lojas, lojaFixaNome: canSeeAllLojas(user) ? null : (lojaPropria ? lojaPropria.nome : null),
      }));
    }

    if (pathname === '/vendas' && method === 'POST') {
      const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
      const lojaPropria = user.loja_id ? db.prepare('SELECT * FROM lojas WHERE id = ?').get(user.loja_id) : null;
      const lojas = canSeeAllLojas(user) ? db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all() : [];
      const lojaFixaNome = canSeeAllLojas(user) ? null : (lojaPropria ? lojaPropria.nome : null);
      const lojaIdEscolhida = canSeeAllLojas(user) ? toIntOrNull(body.loja_id) : user.loja_id;

      if (!body.cliente_id) {
        return send(res, 400, vendaFormPage({ user, flash: { type: 'error', message: 'Selecione um cliente.' }, clientes, csrfToken: session.csrfToken, lojas, lojaFixaNome }));
      }
      const formaPagamento = body.forma_pagamento || null;
      const parcelas = formaPagamento === 'credito' ? toIntOrNull(body.parcelas) : null;
      const numero = nextVendaNumber();
      const info = db
        .prepare(
          `INSERT INTO vendas (numero, cliente_id, loja_id, status, valor_total, forma_pagamento, parcelas, observacoes, vendedor_id)
           VALUES (?, ?, ?, 'aberta', 0, ?, ?, ?, ?)`
        )
        .run(numero, body.cliente_id, lojaIdEscolhida, formaPagamento, parcelas, body.observacoes || '', user.id);
      setFlash(session.sessionId, 'success', `Venda ${numero} criada. Agora adicione os itens vendidos.`);
      return redirect(res, `/vendas/${info.lastInsertRowid}`);
    }

    if ((m = matchRoute('/vendas/:id', pathname)) && method === 'GET') {
      const venda = db
        .prepare(
          `SELECT v.*, c.nome as cliente_nome, l.nome as loja_nome FROM vendas v
           JOIN clientes c ON c.id = v.cliente_id LEFT JOIN lojas l ON l.id = v.loja_id WHERE v.id = ?`
        )
        .get(m.id);
      if (!venda) return notFound(res);
      if (!canSeeLoja(user, venda.loja_id)) return forbidden(res);
      const itens = db.prepare('SELECT * FROM venda_itens WHERE venda_id = ? ORDER BY created_at DESC').all(m.id);
      const pecasDisponiveis = venda.loja_id
        ? db.prepare('SELECT * FROM pecas WHERE loja_id = ? ORDER BY nome ASC').all(venda.loja_id)
        : canSeeAllLojas(user)
        ? db.prepare('SELECT * FROM pecas ORDER BY nome ASC').all()
        : db.prepare('SELECT * FROM pecas WHERE loja_id = ? ORDER BY nome ASC').all(user.loja_id);
      return send(res, 200, vendaShowPage({ user, flash: takeFlash(session.sessionId), venda, itens, pecasDisponiveis, csrfToken: session.csrfToken }));
    }

    if ((m = matchRoute('/vendas/:id/itens', pathname)) && method === 'POST') {
      const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(m.id);
      if (!venda) return notFound(res);
      if (!canEditLoja(user, venda.loja_id)) return forbidden(res);
      if (venda.status !== 'aberta') {
        setFlash(session.sessionId, 'error', 'Esta venda já foi finalizada e não pode mais ser alterada.');
        return redirect(res, `/vendas/${m.id}`);
      }

      if (body.produto_id === 'veiculo') {
        const marca = (body.veiculo_marca || '').trim();
        const modelo = (body.veiculo_modelo || '').trim();
        const precoVenda = toFloatOrNull(body.veiculo_preco_venda);
        const tipoVeiculo = body.tipo_veiculo === 'moto' ? 'moto' : 'bicicleta';
        if (!modelo || !precoVenda) {
          setFlash(session.sessionId, 'error', 'Informe pelo menos o modelo e o preço de venda do veículo.');
          return redirect(res, `/vendas/${m.id}`);
        }
        const infoBici = db
          .prepare(
            `INSERT INTO bicicletas (cliente_id, tipo_veiculo, marca, modelo, bateria_serial, chassi_numero, observacoes)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            venda.cliente_id, tipoVeiculo, marca, modelo,
            body.veiculo_bateria_serial || '', body.veiculo_chassi_numero || '',
            `Cadastrado automaticamente pela Venda Direto ${venda.numero}.`
          );
        const bicicletaId = infoBici.lastInsertRowid;
        const fotoChassiFile = files.find((f) => f.fieldName === 'veiculo_foto_chassi' && f.data && f.data.length > 0);
        const fotoBateriaFile = files.find((f) => f.fieldName === 'veiculo_foto_bateria' && f.data && f.data.length > 0);
        if (fotoChassiFile) replaceBicicletaMedia(bicicletaId, 'chassi', fotoChassiFile);
        if (fotoBateriaFile) replaceBicicletaMedia(bicicletaId, 'bateria_serial', fotoBateriaFile);

        db.prepare(
          'INSERT INTO venda_itens (venda_id, bicicleta_id, nome_peca, quantidade, preco_unitario) VALUES (?, ?, ?, 1, ?)'
        ).run(m.id, bicicletaId, `${marca} ${modelo}`.trim(), precoVenda);
        const novoTotalVeiculo = db.prepare('SELECT COALESCE(SUM(quantidade * preco_unitario), 0) as total FROM venda_itens WHERE venda_id = ?').get(m.id).total;
        db.prepare('UPDATE vendas SET valor_total = ? WHERE id = ?').run(novoTotalVeiculo, m.id);
        setFlash(session.sessionId, 'success', `Veículo "${`${marca} ${modelo}`.trim()}" adicionado à venda e cadastrado em Bicicletas.`);
        return redirect(res, `/vendas/${m.id}`);
      }

      if (!body.produto_id) {
        setFlash(session.sessionId, 'error', 'Selecione um produto pra adicionar.');
        return redirect(res, `/vendas/${m.id}`);
      }
      const peca = db.prepare('SELECT * FROM pecas WHERE id = ?').get(body.produto_id);
      const quantidade = toIntOrNull(body.quantidade) || 1;
      if (!peca) {
        setFlash(session.sessionId, 'error', 'Peça não encontrada no estoque.');
        return redirect(res, `/vendas/${m.id}`);
      }
      if (quantidade < 1) {
        setFlash(session.sessionId, 'error', 'Quantidade inválida.');
        return redirect(res, `/vendas/${m.id}`);
      }
      db.prepare(
        'INSERT INTO venda_itens (venda_id, peca_id, nome_peca, quantidade, preco_unitario) VALUES (?, ?, ?, ?, ?)'
      ).run(m.id, peca.id, peca.nome, quantidade, peca.preco_venda);
      const novaQuantidade = peca.quantidade - quantidade;
      db.prepare("UPDATE pecas SET quantidade = ?, updated_at = datetime('now') WHERE id = ?").run(novaQuantidade, peca.id);
      const novoTotal = db.prepare('SELECT COALESCE(SUM(quantidade * preco_unitario), 0) as total FROM venda_itens WHERE venda_id = ?').get(m.id).total;
      db.prepare('UPDATE vendas SET valor_total = ? WHERE id = ?').run(novoTotal, m.id);
      setFlash(
        session.sessionId,
        novaQuantidade <= 0 ? 'error' : 'success',
        novaQuantidade <= 0
          ? `Peça "${peca.nome}" adicionada à venda. Atenção: o estoque dessa peça ficou zerado ou negativo (${novaQuantidade}).`
          : `Peça "${peca.nome}" adicionada à venda.`
      );
      return redirect(res, `/vendas/${m.id}`);
    }

    if ((m = matchRoute('/vendas/:id/itens/:itemId/excluir', pathname)) && method === 'POST') {
      const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(m.id);
      if (!venda) return notFound(res);
      if (!canEditLoja(user, venda.loja_id)) return forbidden(res);
      if (venda.status !== 'aberta') {
        setFlash(session.sessionId, 'error', 'Esta venda já foi finalizada e não pode mais ser alterada.');
        return redirect(res, `/vendas/${m.id}`);
      }
      const item = db.prepare('SELECT * FROM venda_itens WHERE id = ? AND venda_id = ?').get(m.itemId, m.id);
      if (item) {
        if (item.peca_id) {
          db.prepare("UPDATE pecas SET quantidade = quantidade + ?, updated_at = datetime('now') WHERE id = ?").run(item.quantidade, item.peca_id);
        }
        db.prepare('DELETE FROM venda_itens WHERE id = ?').run(item.id);
        const novoTotal = db.prepare('SELECT COALESCE(SUM(quantidade * preco_unitario), 0) as total FROM venda_itens WHERE venda_id = ?').get(m.id).total;
        db.prepare('UPDATE vendas SET valor_total = ? WHERE id = ?').run(novoTotal, m.id);
        if (item.bicicleta_id) {
          setFlash(session.sessionId, 'success', 'Item removido da venda. O veículo cadastrado permanece no cadastro do cliente (módulo Bicicletas).');
          return redirect(res, `/vendas/${m.id}`);
        }
        setFlash(session.sessionId, 'success', 'Item removido da venda e devolvido ao estoque.');
      }
      return redirect(res, `/vendas/${m.id}`);
    }

    if ((m = matchRoute('/vendas/:id/finalizar', pathname)) && method === 'POST') {
      const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(m.id);
      if (!venda) return notFound(res);
      if (!canEditLoja(user, venda.loja_id)) return forbidden(res);
      if (venda.status === 'concluida') {
        setFlash(session.sessionId, 'error', 'Esta venda já está finalizada.');
        return redirect(res, `/vendas/${m.id}`);
      }
      const itemCount = db.prepare('SELECT COUNT(*) c FROM venda_itens WHERE venda_id = ?').get(m.id).c;
      if (itemCount === 0) {
        setFlash(session.sessionId, 'error', 'Adicione pelo menos um item antes de finalizar a venda.');
        return redirect(res, `/vendas/${m.id}`);
      }
      db.prepare("UPDATE vendas SET status='concluida', finalizada_at=datetime('now') WHERE id = ?").run(m.id);
      const vendaAtualizada = db.prepare('SELECT * FROM vendas WHERE id = ?').get(m.id);
      try {
        gerarContasReceberDaVenda(vendaAtualizada, user);
      } catch (err) {
        console.error('[contas-receber] Falha ao gerar parcelas a partir da Venda:', err);
      }
      setFlash(session.sessionId, 'success', 'Venda finalizada com sucesso.');
      return redirect(res, `/vendas/${m.id}`);
    }

    // ---------------- USUÁRIOS (Direção e Gerência apenas) ----------------
    if (pathname === '/usuarios' && method === 'GET') {
      if (!hasManagementAccess(user)) return forbidden(res);
      const usuarios = db
        .prepare(
          `SELECT u.*, l.nome as loja_nome, np.nome as nivel_nome
           FROM users u
           LEFT JOIN lojas l ON l.id = u.loja_id
           LEFT JOIN niveis_permissao np ON np.id = u.nivel_id
           ORDER BY u.name ASC`
        )
        .all();
      return send(res, 200, usuariosListPage({ user, flash: takeFlash(session.sessionId), usuarios, csrfToken: session.csrfToken }));
    }

    if (pathname === '/usuarios/novo' && method === 'GET') {
      if (!hasManagementAccess(user)) return forbidden(res);
      const lojas = db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all();
      const niveis = listNiveis();
      return send(res, 200, usuarioFormPage({ user, flash: takeFlash(session.sessionId), usuario: null, csrfToken: session.csrfToken, lojas, niveis }));
    }

    if (pathname === '/usuarios' && method === 'POST') {
      if (!hasManagementAccess(user)) return forbidden(res);
      const lojas = db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all();
      const niveis = listNiveis();
      const nome = (body.name || '').trim();
      const emailNovo = (body.email || '').trim().toLowerCase();
      const nivelId = toIntOrNull(body.nivel_id);
      const nivelValido = nivelId && niveis.some((n) => n.id === nivelId);
      const lojaId = toIntOrNull(body.loja_id);
      const podeVerOutrasLojas = body.pode_ver_outras_lojas ? 1 : 0;
      if (!nome || !emailNovo || !body.password || !nivelValido) {
        return send(res, 400, usuarioFormPage({ user, flash: { type: 'error', message: 'Nome, e-mail, senha e nível de acesso são obrigatórios.' }, usuario: { ...body, name: nome, email: emailNovo }, csrfToken: session.csrfToken, lojas, niveis }));
      }
      const existente = db.prepare('SELECT id FROM users WHERE email = ?').get(emailNovo);
      if (existente) {
        return send(res, 400, usuarioFormPage({ user, flash: { type: 'error', message: 'Já existe um usuário com esse e-mail.' }, usuario: { ...body, name: nome, email: emailNovo }, csrfToken: session.csrfToken, lojas, niveis }));
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(body.password, salt);
      db.prepare('INSERT INTO users (name, email, password_hash, password_salt, nivel_id, loja_id, pode_ver_outras_lojas) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        nome, emailNovo, hash, salt, nivelId, lojaId, podeVerOutrasLojas
      );
      setFlash(session.sessionId, 'success', 'Usuário cadastrado.');
      return redirect(res, '/usuarios');
    }

    if ((m = matchRoute('/usuarios/:id/editar', pathname)) && method === 'GET') {
      if (!hasManagementAccess(user)) return forbidden(res);
      const usuario = db.prepare('SELECT * FROM users WHERE id = ?').get(m.id);
      if (!usuario) return notFound(res);
      const lojas = db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all();
      const niveis = listNiveis();
      return send(res, 200, usuarioFormPage({ user, flash: takeFlash(session.sessionId), usuario, csrfToken: session.csrfToken, lojas, niveis }));
    }

    if ((m = matchRoute('/usuarios/:id', pathname)) && method === 'POST') {
      if (!hasManagementAccess(user)) return forbidden(res);
      const usuario = db.prepare('SELECT * FROM users WHERE id = ?').get(m.id);
      if (!usuario) return notFound(res);
      const lojas = db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all();
      const niveis = listNiveis();
      const nome = (body.name || '').trim();
      const emailNovo = (body.email || '').trim().toLowerCase();
      const nivelIdBody = toIntOrNull(body.nivel_id);
      const nivelId = nivelIdBody && niveis.some((n) => n.id === nivelIdBody) ? nivelIdBody : usuario.nivel_id;
      const lojaId = toIntOrNull(body.loja_id);
      const podeVerOutrasLojas = body.pode_ver_outras_lojas ? 1 : 0;
      if (!nome || !emailNovo) {
        return send(res, 400, usuarioFormPage({ user, flash: { type: 'error', message: 'Nome e e-mail são obrigatórios.' }, usuario: { ...usuario, ...body, name: nome, email: emailNovo }, csrfToken: session.csrfToken, lojas, niveis }));
      }
      const dupEmail = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(emailNovo, m.id);
      if (dupEmail) {
        return send(res, 400, usuarioFormPage({ user, flash: { type: 'error', message: 'Já existe outro usuário com esse e-mail.' }, usuario: { ...usuario, ...body, name: nome, email: emailNovo }, csrfToken: session.csrfToken, lojas, niveis }));
      }
      if (body.password && body.password.trim()) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = hashPassword(body.password, salt);
        db.prepare('UPDATE users SET name=?, email=?, nivel_id=?, loja_id=?, pode_ver_outras_lojas=?, password_hash=?, password_salt=? WHERE id=?').run(
          nome, emailNovo, nivelId, lojaId, podeVerOutrasLojas, hash, salt, m.id
        );
      } else {
        db.prepare('UPDATE users SET name=?, email=?, nivel_id=?, loja_id=?, pode_ver_outras_lojas=? WHERE id=?').run(
          nome, emailNovo, nivelId, lojaId, podeVerOutrasLojas, m.id
        );
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
      const configAtivos = countUsuariosAtivosComAcesso('configuracoes');
      if (userCanAccessModulo(alvo, 'configuracoes') && configAtivos <= 1) {
        setFlash(session.sessionId, 'error', 'Não é possível desativar o último usuário com acesso a Configurações.');
        return redirect(res, '/usuarios');
      }
      db.prepare('UPDATE users SET ativo = 0 WHERE id = ?').run(m.id);
      setFlash(session.sessionId, 'success', 'Usuário desativado.');
      return redirect(res, '/usuarios');
    }

    // ---------------- NÍVEIS DE PERMISSÃO (Configurações) ----------------
    if (pathname === '/niveis' && method === 'GET') {
      if (!hasManagementAccess(user)) return forbidden(res);
      const niveis = listNiveis();
      const permissoesPorNivel = {};
      for (const n of niveis) permissoesPorNivel[n.id] = getNivelPermissoesMap(n.id);
      return send(res, 200, niveisPage({ user, flash: takeFlash(session.sessionId), niveis, permissoesPorNivel, csrfToken: session.csrfToken }));
    }

    if (pathname === '/niveis' && method === 'POST') {
      if (!hasManagementAccess(user)) return forbidden(res);
      try {
        createNivel(body.nome);
        setFlash(session.sessionId, 'success', 'Nível criado. Agora marque o que ele pode ver na tabela abaixo.');
      } catch (err) {
        setFlash(session.sessionId, 'error', err.message);
      }
      return redirect(res, '/niveis');
    }

    if ((m = matchRoute('/niveis/:id/renomear', pathname)) && method === 'POST') {
      if (!hasManagementAccess(user)) return forbidden(res);
      try {
        renameNivel(toIntOrNull(m.id), body.nome);
        setFlash(session.sessionId, 'success', 'Nível renomeado.');
      } catch (err) {
        setFlash(session.sessionId, 'error', err.message);
      }
      return redirect(res, '/niveis');
    }

    if ((m = matchRoute('/niveis/:id/excluir', pathname)) && method === 'POST') {
      if (!hasManagementAccess(user)) return forbidden(res);
      try {
        deleteNivel(toIntOrNull(m.id));
        setFlash(session.sessionId, 'success', 'Nível excluído.');
      } catch (err) {
        setFlash(session.sessionId, 'error', err.message);
      }
      return redirect(res, '/niveis');
    }

    if (pathname === '/niveis/permissoes' && method === 'POST') {
      if (!hasManagementAccess(user)) return forbidden(res);
      const niveis = listNiveis();
      const matriz = {};
      for (const n of niveis) {
        matriz[n.id] = {};
        for (const modulo of MODULOS.map((mod) => mod.key)) {
          matriz[n.id][modulo] = body[`perm_${n.id}_${modulo}`] ? 1 : 0;
        }
      }
      // trava de segurança: não deixa salvar uma configuração que tiraria o
      // acesso a "Configurações" de TODOS os usuários ativos — sem isso,
      // ninguém mais conseguiria entrar aqui de novo para corrigir o erro.
      const usuariosAtivos = db.prepare('SELECT nivel_id FROM users WHERE ativo = 1').all();
      const sobraAlguemComConfig = usuariosAtivos.some((u) => matriz[u.nivel_id] && matriz[u.nivel_id].configuracoes);
      if (!sobraAlguemComConfig) {
        setFlash(session.sessionId, 'error', 'Não salvo: isso deixaria o sistema sem nenhum usuário ativo com acesso a Configurações, e ninguém mais conseguiria corrigir depois.');
        return redirect(res, '/niveis');
      }
      setPermissoesMatrix(matriz);
      setFlash(session.sessionId, 'success', 'Permissões salvas.');
      return redirect(res, '/niveis');
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

    // ---------------- BACKUP (Direção e Gerência apenas) ----------------
    if (pathname === '/backup' && method === 'GET') {
      if (!hasManagementAccess(user)) return forbidden(res);
      return send(res, 200, backupPage({
        user,
        flash: takeFlash(session.sessionId),
        csrfToken: session.csrfToken,
        state: readBackupState(),
        emailIsConfigured: mailConfigured(),
        recipients: getBackupRecipients(),
      }));
    }

    if (pathname === '/backup/executar' && method === 'POST') {
      if (!hasManagementAccess(user)) return forbidden(res);
      try {
        const result = await runAutoBackup(db, { recipients: getBackupRecipients() });
        setFlash(
          session.sessionId,
          result.emailError ? 'error' : 'success',
          result.emailed
            ? `Backup feito com sucesso (${formatBytes(result.sizeBytes)}) e enviado por e-mail.`
            : result.emailError
            ? `Backup salvo no servidor (${formatBytes(result.sizeBytes)}), mas o envio por e-mail falhou: ${result.emailError}`
            : `Backup salvo no servidor (${formatBytes(result.sizeBytes)}). E-mail não configurado ou sem destinatários — veja os avisos acima.`
        );
      } catch (err) {
        console.error('[backup] Falha ao executar backup manual:', err);
        setFlash(session.sessionId, 'error', 'Falha ao fazer backup: ' + (err && err.message ? err.message : 'erro desconhecido, veja os Logs do servidor.'));
      }
      return redirect(res, '/backup');
    }

    if (pathname === '/backup/baixar' && method === 'GET') {
      if (!hasManagementAccess(user)) return forbidden(res);
      try {
        const zip = await buildFullBackupZip(db);
        const filename = `golden-saas-backup-completo-${new Date().toISOString().slice(0, 10)}.zip`;
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': zip.length,
        });
        res.end(zip);
        return;
      } catch (err) {
        console.error('[backup] Falha ao gerar backup completo:', err);
        setFlash(session.sessionId, 'error', 'Falha ao gerar o backup completo: ' + (err && err.message ? err.message : 'erro desconhecido, veja os Logs do servidor.'));
        return redirect(res, '/backup');
      }
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

// ---------------- BACKUP AUTOMÁTICO DIÁRIO ----------------
// Roda dentro do próprio processo: a cada hora, confere se já rodou hoje;
// se não rodou, dispara o backup. Como o servidor fica sempre ligado (plano
// Starter+ do Render, sem "soneca"), isso garante 1 backup por dia sem
// precisar de nenhum serviço externo de agendamento (ex: cron job).
async function maybeRunDailyBackup() {
  try {
    const state = readBackupState();
    const today = new Date().toISOString().slice(0, 10);
    if (state.lastAutoBackupDate === today) return;
    const result = await runAutoBackup(db, { recipients: getBackupRecipients() });
    console.log(`[backup] Backup automático diário concluído (${result.sizeBytes} bytes, e-mail: ${result.emailed ? 'enviado' : result.emailError || 'não configurado'}).`);
  } catch (err) {
    console.error('[backup] Falha no backup automático diário:', err);
  }
}
setTimeout(maybeRunDailyBackup, 30 * 1000);
setInterval(maybeRunDailyBackup, 60 * 60 * 1000);
