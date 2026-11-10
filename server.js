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
const {
  saveUploadedFile,
  saveDocumentFile,
  saveReceiptFile,
  saveBufferAsUpload,
  deleteUploadedFile,
  resolveUploadPath,
  mimeForPath,
  MAX_REQUEST_BYTES,
} = require('./src/uploads');
const { sendMail, isConfigured: mailConfigured } = require('./src/mailer');
const { gerarPdfAssinado } = require('./src/contratosPdf');
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
  ordemPainelPage,
  ordemImprimirPage,
  STATUS_LABELS,
  totalValor,
  formaPagamentoLabel,
} = require('./src/views/ordens');
const { pecasListPage, pecaFormPage, entradaEstoqueFormPage } = require('./src/views/estoque');
const { usuariosListPage, usuarioFormPage } = require('./src/views/usuarios');
const { niveisPage } = require('./src/views/niveis');
const { auditoriaPage } = require('./src/views/auditoria');
const { lojasListPage, lojaFormPage } = require('./src/views/lojas');
const { transferenciasListPage, transferenciaFormPage } = require('./src/views/transferencias');
const { fornecedoresListPage, fornecedorFormPage } = require('./src/views/fornecedores');
const { funcionariosListPage, funcionarioFormPage } = require('./src/views/funcionarios');
const { financeiroResumoPage } = require('./src/views/financeiro');
const { orcamentosListPage, orcamentoFormPage, orcamentoShowPage } = require('./src/views/orcamentos');
const { relatoriosPage } = require('./src/views/relatorios');
const { contasPagarListPage, contaPagarFormPage } = require('./src/views/contasPagar');
const { contasReceberListPage, contaReceberFormPage } = require('./src/views/contasReceber');
const { vendasListPage, vendaFormPage, vendaShowPage } = require('./src/views/vendas');
const { consultaPrecoPage } = require('./src/views/consultaPreco');
const { tiposServicoListPage, tipoServicoFormPage } = require('./src/views/servicos');
const {
  contratosListPage,
  contratoFormPage,
  contratoShowPage,
  contratoAssinarPage,
  contratoJaProcessadoPage,
  contratoAssinadoPage,
} = require('./src/views/contratos');
const { backupPage } = require('./src/views/backup');
const { runAutoBackup, buildFullBackupZip, readState: readBackupState } = require('./src/backup');
const { configFiscalPage } = require('./src/views/configuracoesFiscais');
const focus = require('./src/focus');

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

// ---------------- Integração fiscal (NF-e / Focus NFe) ----------------
function getConfigFiscal() {
  return (
    db.prepare('SELECT * FROM config_fiscal WHERE id = 1').get() || {
      ambiente: 'homologacao',
      regime_tributario: 1,
      origem_padrao: 0,
      unidade_padrao: 'UN',
    }
  );
}
const { focusCreds, buildNfePayload } = require('./src/nfePayload');
// Mapeia a resposta da Focus para as colunas nfe_* da venda.
function applyNfeResponse(vendaId, ambiente, data) {
  if (!data) return;
  const status = data.status || null;
  const chave = data.chave_nfe || null;
  const numero = data.numero != null ? String(data.numero) : null;
  const serie = data.serie != null ? String(data.serie) : null;
  // Guarda o CAMINHO relativo (não a URL completa): o download passa pelo nosso
  // proxy, que anexa o token da Focus. Link direto no navegador daria 401.
  const danfe = data.caminho_danfe || null;
  const xml = data.caminho_xml_nota_fiscal || null;
  let msg = data.mensagem_sefaz || null;
  if (!msg && Array.isArray(data.erros)) {
    msg = data.erros.map((e) => (e && e.mensagem ? e.mensagem : JSON.stringify(e))).join(' | ');
  }
  if (!msg && data.mensagem) msg = data.mensagem;
  db.prepare(
    `UPDATE vendas SET
       nfe_status = ?,
       nfe_chave = COALESCE(?, nfe_chave),
       nfe_numero = COALESCE(?, nfe_numero),
       nfe_serie = COALESCE(?, nfe_serie),
       nfe_danfe_url = COALESCE(?, nfe_danfe_url),
       nfe_xml_url = COALESCE(?, nfe_xml_url),
       nfe_mensagem = ?,
       nfe_ambiente = ?
     WHERE id = ?`
  ).run(status, chave, numero, serie, danfe, xml, msg, ambiente, vendaId);
}

// Baixa o DANFE (PDF) ou o XML da Focus usando o token, e serve ao navegador.
async function servirArquivoNfe(res, vendaId, tipo, user) {
  const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(vendaId);
  if (!venda) return notFound(res);
  if (!canSeeLoja(user, venda.loja_id)) return forbidden(res);
  const caminho = tipo === 'xml' ? venda.nfe_xml_url : venda.nfe_danfe_url;
  if (!caminho) return notFound(res);
  const config = getConfigFiscal();
  const ambiente = venda.nfe_ambiente || 'homologacao';
  const token = ambiente === 'producao' ? config.focus_token_producao : config.focus_token_homologacao;
  try {
    const r = await focus.baixarArquivo({ ambiente, token }, caminho);
    if (r.status !== 200) {
      return send(res, 502, `<h1>Não foi possível baixar o arquivo</h1><p>A Focus respondeu HTTP ${r.status}.</p><p><a href="/vendas/${vendaId}">Voltar</a></p>`);
    }
    const isXml = tipo === 'xml';
    res.writeHead(200, {
      'Content-Type': r.contentType || (isXml ? 'application/xml' : 'application/pdf'),
      'Content-Disposition': `inline; filename="nfe-${venda.numero}.${isXml ? 'xml' : 'pdf'}"`,
    });
    res.end(r.buffer);
  } catch (err) {
    console.error('[nfe] Falha ao baixar arquivo da Focus:', err);
    return send(res, 502, `<h1>Falha ao baixar</h1><pre>${escapeHtml(err.message)}</pre><p><a href="/vendas/${vendaId}">Voltar</a></p>`);
  }
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

function novoContratoToken() {
  return crypto.randomBytes(24).toString('hex');
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function decodePngDataUrl(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith('data:image/png;base64,')) return null;
  const base64 = dataUrl.slice('data:image/png;base64,'.length);
  try {
    return Buffer.from(base64, 'base64');
  } catch (_e) {
    return null;
  }
}

function baseUrlFromReq(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${req.headers.host}`;
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

const PRIORIDADES_OS = ['baixa', 'normal', 'alta', 'urgente'];

// Confere se o id de técnico informado corresponde a um funcionário existente;
// devolve o id (número) ou null, evitando gravar um FK inválido na O.S.
function validTecnicoId(raw) {
  const id = parseInt(raw, 10);
  if (!id || isNaN(id)) return null;
  const f = db.prepare('SELECT id FROM funcionarios WHERE id = ?').get(id);
  return f ? id : null;
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

// Lê os pares cor_nome / cor_quantidade do form de peça (Estoque) e devolve
// só as linhas com nome preenchido, já normalizadas. parseFormBody devolve
// string quando só veio um valor, ou array quando vieram vários com o
// mesmo name — por isso normalizamos tudo pra array primeiro.
function parseCoresFromBody(body) {
  const nomes = body.cor_nome === undefined ? [] : (Array.isArray(body.cor_nome) ? body.cor_nome : [body.cor_nome]);
  const quantidades = body.cor_quantidade === undefined ? [] : (Array.isArray(body.cor_quantidade) ? body.cor_quantidade : [body.cor_quantidade]);
  const cores = [];
  for (let i = 0; i < nomes.length; i++) {
    const cor = (nomes[i] || '').trim();
    if (!cor) continue;
    cores.push({ cor, quantidade: toIntOrNull(quantidades[i]) || 0 });
  }
  return cores;
}

function salvarCoresPeca(pecaId, cores) {
  db.prepare('DELETE FROM peca_cores WHERE peca_id = ?').run(pecaId);
  if (!cores.length) return;
  const ins = db.prepare('INSERT INTO peca_cores (peca_id, cor, quantidade) VALUES (?, ?, ?)');
  for (const c of cores) ins.run(pecaId, c.cor, c.quantidade);
}

function recomputeValorPecas(osId) {
  const soma = db
    .prepare('SELECT COALESCE(SUM(quantidade * preco_unitario), 0) as total FROM os_pecas WHERE ordem_servico_id = ?')
    .get(osId).total;
  const os = db.prepare('SELECT valor_mao_obra, desconto FROM ordens_servico WHERE id = ?').get(osId);
  const valorMaoObra = os ? Number(os.valor_mao_obra) || 0 : 0;
  const desconto = os ? Number(os.desconto) || 0 : 0;
  db.prepare(
    `UPDATE ordens_servico SET valor_pecas = ?, valor_estimado = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(soma, Math.max(0, soma + valorMaoObra - desconto), osId);
}

function recomputeValorMaoObra(osId) {
  const soma = db
    .prepare('SELECT COALESCE(SUM(valor), 0) as total FROM os_servicos WHERE ordem_servico_id = ?')
    .get(osId).total;
  const os = db.prepare('SELECT valor_pecas, desconto FROM ordens_servico WHERE id = ?').get(osId);
  const valorPecas = os ? Number(os.valor_pecas) || 0 : 0;
  const desconto = os ? Number(os.desconto) || 0 : 0;
  db.prepare(
    `UPDATE ordens_servico SET valor_mao_obra = ?, valor_estimado = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(soma, Math.max(0, soma + valorPecas - desconto), osId);
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

function nextOrcamentoNumber() {
  const row = db.prepare('SELECT COUNT(*) as c FROM orcamentos').get();
  return 'ORC-' + String(row.c + 1).padStart(4, '0');
}

function recomputeOrcamentoTotal(orcamentoId) {
  const total = db
    .prepare('SELECT COALESCE(SUM(quantidade * preco_unitario), 0) as t FROM orcamento_itens WHERE orcamento_id = ?')
    .get(orcamentoId).t;
  db.prepare("UPDATE orcamentos SET valor_total = ?, updated_at = datetime('now') WHERE id = ?").run(total, orcamentoId);
}

// Período de um relatório: usa os parâmetros de/ate ou, por padrão, do 1º dia
// do mês corrente até hoje (horário de São Paulo).
function relatorioPeriodo(url) {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const de = url.searchParams.get('de') || hoje.slice(0, 8) + '01';
  const ate = url.searchParams.get('ate') || hoje;
  return { de, ate };
}

// Busca os dados dos relatórios no período, respeitando a visibilidade de loja.
function queryRelatorios(user, de, ate) {
  const osRows = db
    .prepare(
      `SELECT os.*, c.nome as cliente_nome, b.marca, b.modelo, f.nome as tecnico_nome
       FROM ordens_servico os
       JOIN clientes c ON c.id = os.cliente_id
       JOIN bicicletas b ON b.id = os.bicicleta_id
       LEFT JOIN funcionarios f ON f.id = os.tecnico_id
       WHERE os.ativo = 1 AND date(os.data_entrada) BETWEEN ? AND ?
       ORDER BY os.data_entrada ASC, os.id ASC`
    )
    .all(de, ate)
    .map((o) => ({ ...o, valor: (Number(o.valor_pecas) || 0) + (Number(o.valor_mao_obra) || 0) }));
  const vendas = db
    .prepare(
      `SELECT v.*, c.nome as cliente_nome FROM vendas v JOIN clientes c ON c.id = v.cliente_id
       WHERE date(v.created_at) BETWEEN ? AND ? ORDER BY v.created_at ASC, v.id ASC`
    )
    .all(de, ate)
    .filter((v) => canSeeLoja(user, v.loja_id));
  const receb = db
    .prepare(
      `SELECT cr.*, c.nome as cliente_nome FROM contas_receber cr LEFT JOIN clientes c ON c.id = cr.cliente_id
       WHERE cr.status = 'recebido' AND cr.recebido_em IS NOT NULL AND date(cr.recebido_em) BETWEEN ? AND ?
       ORDER BY cr.recebido_em ASC`
    )
    .all(de, ate)
    .filter((r) => canSeeLoja(user, r.loja_id));
  const pagam = db
    .prepare(
      `SELECT cp.*, f.nome as fornecedor_nome FROM contas_pagar cp LEFT JOIN fornecedores f ON f.id = cp.fornecedor_id
       WHERE cp.status = 'pago' AND cp.pago_em IS NOT NULL AND date(cp.pago_em) BETWEEN ? AND ?
       ORDER BY cp.pago_em ASC`
    )
    .all(de, ate)
    .filter((p) => canSeeLoja(user, p.loja_id));
  return { osRows, vendas, receb, pagam };
}

// Monta e envia um CSV (delimitador ';' e BOM, pra abrir com acento no Excel pt-BR).
function sendCsv(res, filename, headers, rows) {
  const esc = (v) => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
  const linhas = [headers.map(esc).join(';'), ...rows.map((r) => r.map(esc).join(';'))];
  const body = '﻿' + linhas.join('\r\n');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
  res.end(body);
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

// Salva/troca/remove a foto de um produto (peça). Uma foto por produto.
function salvarFotoPeca(pecaId, files, body) {
  const peca = db.prepare('SELECT foto_caminho FROM pecas WHERE id = ?').get(pecaId);
  const fotoAtual = peca ? peca.foto_caminho : null;
  if (body && body.remover_foto === '1' && fotoAtual) {
    deleteUploadedFile(fotoAtual);
    db.prepare('UPDATE pecas SET foto_caminho = NULL WHERE id = ?').run(pecaId);
  }
  const fotoFile = (files || []).find((f) => f.fieldName === 'foto' && f.data && f.data.length > 0);
  if (fotoFile) {
    const saved = saveUploadedFile('peca', pecaId, fotoFile);
    if (saved) {
      if (fotoAtual) deleteUploadedFile(fotoAtual);
      db.prepare('UPDATE pecas SET foto_caminho = ? WHERE id = ?').run(saved.caminho_arquivo, pecaId);
    }
  }
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
        Produtos: ${formatMoney(os.valor_pecas)}<br>
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

const PUBLIC_PATHS = new Set(['/login', '/manifest.webmanifest', '/sw.js', '/icon-192.png', '/icon-512.png']);
const pwa = require('./src/assets/pwa');

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
    // /contratos/assinar/... é a página pública que o CLIENTE abre pelo link
    // (e-mail/WhatsApp), sem estar logado no sistema.
    const isContratoPublico = pathname.startsWith('/contratos/assinar/');
    if (!PUBLIC_PATHS.has(pathname) && !isContratoPublico && !user) {
      return redirect(res, '/login');
    }

    // --- module gate ---
    // Cada nível de permissão liga/desliga o acesso a cada módulo (tela
    // "Níveis de permissão"). Antes, esse checkbox só era respeitado pelas
    // rotas de Configurações (Lojas/Usuários/Níveis/Auditoria/Backup/
    // Fornecedores/Tipos de Serviço); as demais telas eram acessíveis via
    // URL direta independente do que estivesse marcado. Este bloco fecha
    // essa brecha mapeando cada prefixo de rota pro módulo correspondente
    // e checando userCanAccessModulo antes de despachar pra rota.
    const PREFIXO_MODULO = [
      ['/clientes', 'clientes'],
      ['/bicicletas', 'bicicletas'],
      ['/os', 'os'],
      ['/servicos', 'os'],
      ['/orcamentos', 'vendas'],
      ['/consulta-preco', 'vendas'],
      ['/vendas', 'vendas'],
      ['/transferencias', 'estoque'],
      ['/estoque', 'estoque'],
      ['/fornecedores', 'estoque'],
      ['/contas-pagar', 'financeiro'],
      ['/contas-receber', 'financeiro'],
      ['/financeiro', 'financeiro'],
    ];
    if (user && !isContratoPublico) {
      if (pathname === '/' && !userCanAccessModulo(user, 'painel')) {
        return forbidden(res);
      }
      for (const [prefixo, modulo] of PREFIXO_MODULO) {
        if (pathname.startsWith(prefixo) && !userCanAccessModulo(user, modulo)) {
          return forbidden(res);
        }
      }
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

    // ---------------- PWA (app instalável) ----------------
    if (pathname === '/manifest.webmanifest' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
      res.end(pwa.MANIFEST);
      return;
    }
    if (pathname === '/sw.js' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(pwa.SERVICE_WORKER);
      return;
    }
    if (pathname === '/icon-192.png' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' });
      res.end(pwa.ICON_192);
      return;
    }
    if (pathname === '/icon-512.png' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' });
      res.end(pwa.ICON_512);
      return;
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
        .prepare(
          `INSERT INTO clientes
             (nome, telefone, email, endereco, observacoes,
              cpf_cnpj, ie, cep, logradouro, numero, complemento, bairro, municipio, codigo_municipio, uf)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          body.nome.trim(), body.telefone || '', body.email || '', body.endereco || '', body.observacoes || '',
          (body.cpf_cnpj || '').trim() || null, (body.ie || '').trim() || null, (body.cep || '').trim() || null,
          (body.logradouro || '').trim() || null, (body.numero || '').trim() || null, (body.complemento || '').trim() || null,
          (body.bairro || '').trim() || null, (body.municipio || '').trim() || null, (body.codigo_municipio || '').trim() || null,
          (body.uf || '').trim().toUpperCase() || null
        );
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
      db.prepare(
        `UPDATE clientes SET
           nome=?, telefone=?, email=?, endereco=?, observacoes=?,
           cpf_cnpj=?, ie=?, cep=?, logradouro=?, numero=?, complemento=?, bairro=?, municipio=?, codigo_municipio=?, uf=?
         WHERE id=?`
      ).run(
        body.nome.trim(), body.telefone || '', body.email || '', body.endereco || '', body.observacoes || '',
        (body.cpf_cnpj || '').trim() || null, (body.ie || '').trim() || null, (body.cep || '').trim() || null,
        (body.logradouro || '').trim() || null, (body.numero || '').trim() || null, (body.complemento || '').trim() || null,
        (body.bairro || '').trim() || null, (body.municipio || '').trim() || null, (body.codigo_municipio || '').trim() || null,
        (body.uf || '').trim().toUpperCase() || null, m.id
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
        setFlash(session.sessionId, 'error', 'Cadastre um cliente antes de adicionar um veículo.');
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

      setFlash(session.sessionId, 'success', 'Veículo cadastrado com sucesso.');
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
      setFlash(session.sessionId, 'success', 'Veículo excluído.');
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

      setFlash(session.sessionId, 'success', 'Veículo atualizado.');
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
      const getCoresPeca = db.prepare('SELECT id, cor, quantidade FROM peca_cores WHERE peca_id = ? ORDER BY cor ASC');
      pecas.forEach((p) => {
        p.__podeEditar = canEditLoja(user, p.loja_id);
        p.cores = getCoresPeca.all(p.id);
      });

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
        cores: [],
      }));
    }

    if (pathname === '/estoque' && method === 'POST') {
      const lojaPropria = user.loja_id ? db.prepare('SELECT * FROM lojas WHERE id = ?').get(user.loja_id) : null;
      const lojas = canSeeAllLojas(user) ? db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all() : [];
      const fornecedores = db.prepare('SELECT * FROM fornecedores WHERE ativo = 1 ORDER BY nome ASC').all();
      const lojaFixaNome = canSeeAllLojas(user) ? null : (lojaPropria ? lojaPropria.nome : null);
      const lojaIdEscolhida = canSeeAllLojas(user) ? toIntOrNull(body.loja_id) : user.loja_id;
      const fornecedorId = toIntOrNull(body.fornecedor_id);
      const cores = parseCoresFromBody(body);

      if (!body.nome || !body.nome.trim() || !lojaIdEscolhida) {
        return send(res, 400, pecaFormPage({ user, flash: { type: 'error', message: 'Nome do produto e loja são obrigatórios.' }, peca: body, csrfToken: session.csrfToken, lojas, lojaFixaNome, fornecedores, cores }));
      }
      const precoVenda = toFloatOrNull(body.preco_venda) || 0;
      const quantidadeTotal = cores.length ? cores.reduce((sum, c) => sum + c.quantidade, 0) : (toIntOrNull(body.quantidade) || 0);
      const origemPeca = body.origem_mercadoria === '' || body.origem_mercadoria == null ? null : Number(body.origem_mercadoria);
      const info = db
        .prepare(
          `INSERT INTO pecas (nome, categoria, numero_serie, quantidade, estoque_minimo, custo_unitario, preco_venda, observacoes, loja_id, fornecedor_id,
                              ncm, cfop, csosn, origem_mercadoria, unidade_comercial)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          body.nome.trim(), body.categoria || '', body.numero_serie || '',
          quantidadeTotal, toIntOrNull(body.estoque_minimo) || 0,
          toFloatOrNull(body.custo_unitario), precoVenda, body.observacoes || '', lojaIdEscolhida, fornecedorId,
          (body.ncm || '').trim() || null, (body.cfop || '').trim() || null, (body.csosn || '').trim() || null,
          origemPeca, (body.unidade_comercial || '').trim() || null
        );
      salvarCoresPeca(info.lastInsertRowid, cores);
      salvarFotoPeca(info.lastInsertRowid, files, body);
      setFlash(session.sessionId, 'success', 'Produto cadastrado no estoque.');
      return redirect(res, `/estoque/${info.lastInsertRowid}/editar`);
    }

    if (pathname === '/estoque/entrada' && method === 'GET') {
      const lojaPropria = user.loja_id ? db.prepare('SELECT * FROM lojas WHERE id = ?').get(user.loja_id) : null;
      const lojas = canSeeAllLojas(user) ? db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all() : [];
      const fornecedores = db.prepare('SELECT * FROM fornecedores WHERE ativo = 1 ORDER BY nome ASC').all();
      const todasLojas = db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all();
      const lojasVisiveis = todasLojas.filter((l) => canSeeLoja(user, l.id));
      const lojaIdsVisiveis = lojasVisiveis.map((l) => l.id);
      let pecas = [];
      if (lojaIdsVisiveis.length) {
        const placeholders = lojaIdsVisiveis.map(() => '?').join(',');
        pecas = db
          .prepare(`SELECT p.*, l.nome as loja_nome FROM pecas p LEFT JOIN lojas l ON l.id = p.loja_id WHERE p.loja_id IN (${placeholders}) ORDER BY p.nome ASC`)
          .all(...lojaIdsVisiveis);
      }
      const pecaSelecionadaId = toIntOrNull(url.searchParams.get('peca_id'));
      return send(res, 200, entradaEstoqueFormPage({
        user, flash: takeFlash(session.sessionId), pecas, csrfToken: session.csrfToken,
        lojas, lojaFixaNome: canSeeAllLojas(user) ? null : (lojaPropria ? lojaPropria.nome : null),
        fornecedores, pecaSelecionadaId,
      }));
    }

    if (pathname === '/estoque/entrada' && method === 'POST') {
      const lojaPropria = user.loja_id ? db.prepare('SELECT * FROM lojas WHERE id = ?').get(user.loja_id) : null;
      const lojas = canSeeAllLojas(user) ? db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all() : [];
      const fornecedores = db.prepare('SELECT * FROM fornecedores WHERE ativo = 1 ORDER BY nome ASC').all();
      const lojaFixaNome = canSeeAllLojas(user) ? null : (lojaPropria ? lojaPropria.nome : null);
      const lojaIdEscolhida = canSeeAllLojas(user) ? toIntOrNull(body.loja_id) : user.loja_id;
      const todasLojas2 = db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all();
      const pecasParaForm = todasLojas2.filter((l) => canSeeLoja(user, l.id)).length
        ? db.prepare('SELECT p.*, l.nome as loja_nome FROM pecas p LEFT JOIN lojas l ON l.id = p.loja_id ORDER BY p.nome ASC').all()
        : [];

      const rerenderComErro = (mensagem) =>
        send(res, 400, entradaEstoqueFormPage({
          user, flash: { type: 'error', message: mensagem }, pecas: pecasParaForm, csrfToken: session.csrfToken,
          lojas, lojaFixaNome, fornecedores, pecaSelecionadaId: body.produto_id,
        }));

      if (!lojaIdEscolhida) return rerenderComErro('Selecione a loja.');
      const quantidadeEntrada = toIntOrNull(body.quantidade) || 0;
      if (quantidadeEntrada <= 0) return rerenderComErro('Informe a quantidade que está chegando (maior que zero).');

      const pecaId = toIntOrNull(body.produto_id);
      const custoUnitario = toFloatOrNull(body.custo_unitario);
      const fornecedorId = toIntOrNull(body.fornecedor_id);
      let peca;

      if (pecaId) {
        peca = db.prepare('SELECT * FROM pecas WHERE id = ?').get(pecaId);
        if (!peca) return rerenderComErro('Produto não encontrado.');
        if (!canEditLoja(user, peca.loja_id)) return forbidden(res);
        db.prepare(
          `UPDATE pecas SET quantidade = quantidade + ?, custo_unitario = COALESCE(?, custo_unitario), fornecedor_id = COALESCE(?, fornecedor_id), updated_at = datetime('now') WHERE id = ?`
        ).run(quantidadeEntrada, custoUnitario, fornecedorId, peca.id);
        peca = db.prepare('SELECT * FROM pecas WHERE id = ?').get(pecaId);
      } else {
        if (!body.nome || !body.nome.trim()) return rerenderComErro('Informe o nome do produto novo.');
        const precoVenda = toFloatOrNull(body.preco_venda) || 0;
        const info = db
          .prepare(
            `INSERT INTO pecas (nome, categoria, quantidade, estoque_minimo, custo_unitario, preco_venda, loja_id, fornecedor_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            body.nome.trim(), body.categoria || '', quantidadeEntrada, toIntOrNull(body.estoque_minimo) || 0,
            custoUnitario, precoVenda, lojaIdEscolhida, fornecedorId
          );
        peca = db.prepare('SELECT * FROM pecas WHERE id = ?').get(info.lastInsertRowid);
      }

      const valorTotal = quantidadeEntrada * (custoUnitario || 0);
      let contaPagarId = null;
      if (valorTotal > 0) {
        const infoConta = db
          .prepare(
            `INSERT INTO contas_pagar (descricao, valor, vencimento, forma_pagamento, loja_id, fornecedor_id, observacoes)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            `Entrada de estoque: ${peca.nome} (${quantidadeEntrada} un)`, valorTotal, body.vencimento || null,
            body.forma_pagamento || '', lojaIdEscolhida, fornecedorId, body.observacoes || ''
          );
        contaPagarId = infoConta.lastInsertRowid;
      }

      db.prepare(
        `INSERT INTO entradas_estoque (peca_id, nome_produto, quantidade, custo_unitario, valor_total, loja_id, fornecedor_id, conta_pagar_id, observacoes, criado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        peca.id, peca.nome, quantidadeEntrada, custoUnitario, valorTotal, lojaIdEscolhida, fornecedorId,
        contaPagarId, body.observacoes || '', user.id
      );

      setFlash(
        session.sessionId, 'success',
        contaPagarId
          ? `Entrada registrada: +${quantidadeEntrada} un. de "${peca.nome}". Lançamento de ${formatMoney(valorTotal)} criado em Contas a Pagar.`
          : `Entrada registrada: +${quantidadeEntrada} un. de "${peca.nome}". Nenhum custo informado, nenhum lançamento financeiro foi criado.`
      );
      return redirect(res, '/estoque');
    }

    if ((m = matchRoute('/estoque/:id/editar', pathname)) && method === 'GET') {
      const peca = db.prepare('SELECT * FROM pecas WHERE id = ?').get(m.id);
      if (!peca) return notFound(res);
      if (!canEditLoja(user, peca.loja_id)) return forbidden(res);
      const lojaPropria = user.loja_id ? db.prepare('SELECT * FROM lojas WHERE id = ?').get(user.loja_id) : null;
      const lojas = canSeeAllLojas(user) ? db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all() : [];
      const fornecedores = db.prepare('SELECT * FROM fornecedores WHERE ativo = 1 ORDER BY nome ASC').all();
      const cores = db.prepare('SELECT id, cor, quantidade FROM peca_cores WHERE peca_id = ? ORDER BY cor ASC').all(peca.id);
      return send(res, 200, pecaFormPage({
        user,
        flash: takeFlash(session.sessionId),
        peca,
        csrfToken: session.csrfToken,
        lojas,
        lojaFixaNome: canSeeAllLojas(user) ? null : (lojaPropria ? lojaPropria.nome : null),
        fornecedores,
        cores,
      }));
    }

    if ((m = matchRoute('/estoque/:id/excluir', pathname)) && method === 'POST') {
      const peca = db.prepare('SELECT * FROM pecas WHERE id = ?').get(m.id);
      if (!peca) return notFound(res);
      if (!canEditLoja(user, peca.loja_id)) return forbidden(res);
      db.prepare('DELETE FROM pecas WHERE id = ?').run(m.id);
      setFlash(session.sessionId, 'success', 'Produto excluído do estoque.');
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
      const cores = parseCoresFromBody(body);

      if (!body.nome || !body.nome.trim()) {
        return send(res, 400, pecaFormPage({ user, flash: { type: 'error', message: 'Nome do produto é obrigatório.' }, peca: { ...peca, ...body }, csrfToken: session.csrfToken, lojas, lojaFixaNome, fornecedores, cores }));
      }
      const precoVenda = toFloatOrNull(body.preco_venda) || 0;
      const quantidadeTotal = cores.length ? cores.reduce((sum, c) => sum + c.quantidade, 0) : (toIntOrNull(body.quantidade) || 0);
      const origemPecaUp = body.origem_mercadoria === '' || body.origem_mercadoria == null ? null : Number(body.origem_mercadoria);
      db.prepare(
        `UPDATE pecas SET nome=?, categoria=?, numero_serie=?, quantidade=?, estoque_minimo=?, custo_unitario=?, preco_venda=?, observacoes=?, loja_id=?, fornecedor_id=?,
           ncm=?, cfop=?, csosn=?, origem_mercadoria=?, unidade_comercial=?, updated_at=datetime('now') WHERE id=?`
      ).run(
        body.nome.trim(), body.categoria || '', body.numero_serie || '',
        quantidadeTotal, toIntOrNull(body.estoque_minimo) || 0,
        toFloatOrNull(body.custo_unitario), precoVenda, body.observacoes || '', lojaIdEscolhida, fornecedorId,
        (body.ncm || '').trim() || null, (body.cfop || '').trim() || null, (body.csosn || '').trim() || null,
        origemPecaUp, (body.unidade_comercial || '').trim() || null, m.id
      );
      salvarCoresPeca(m.id, cores);
      salvarFotoPeca(m.id, files, body);
      setFlash(session.sessionId, 'success', 'Produto atualizado.');
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
          return send(res, 400, lojaFormPage({ user, flash: { type: 'error', message: 'Não é possível desativar a última loja ativa do sistema — sem nenhuma loja ativa, ninguém consegue cadastrar produtos, vendas ou lançamentos financeiros. Cadastre outra loja antes de desativar esta.' }, loja: { ...loja, ...body }, csrfToken: session.csrfToken }));
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
        setFlash(session.sessionId, 'error', 'Produto não encontrado.');
        return redirect(res, '/estoque');
      }
      if (!canSeeLoja(user, peca.loja_id)) return forbidden(res);
      const lojasDestino = db.prepare('SELECT * FROM lojas WHERE ativo = 1 AND id != ? ORDER BY nome ASC').all(peca.loja_id);
      return send(res, 200, transferenciaFormPage({ user, flash: takeFlash(session.sessionId), peca, lojasDestino, csrfToken: session.csrfToken }));
    }

    if (pathname === '/transferencias' && method === 'POST') {
      const peca = db.prepare('SELECT * FROM pecas WHERE id = ?').get(body.peca_id);
      if (!peca) {
        setFlash(session.sessionId, 'error', 'Produto não encontrado.');
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

    // ---------------- FUNCIONÁRIOS ----------------
    if (pathname === '/funcionarios' && method === 'GET') {
      const funcionarios = db.prepare('SELECT * FROM funcionarios ORDER BY ativo DESC, nome ASC').all();
      return send(res, 200, funcionariosListPage({ user, flash: takeFlash(session.sessionId), funcionarios }));
    }

    if (pathname === '/funcionarios/novo' && method === 'GET') {
      return send(res, 200, funcionarioFormPage({ user, flash: takeFlash(session.sessionId), funcionario: null, csrfToken: session.csrfToken }));
    }

    if (pathname === '/funcionarios' && method === 'POST') {
      if (!body.nome || !body.nome.trim()) {
        return send(res, 400, funcionarioFormPage({ user, flash: { type: 'error', message: 'Nome do funcionário é obrigatório.' }, funcionario: body, csrfToken: session.csrfToken }));
      }
      db.prepare('INSERT INTO funcionarios (nome, funcao, telefone, observacoes) VALUES (?, ?, ?, ?)').run(
        body.nome.trim(), body.funcao || '', body.telefone || '', body.observacoes || ''
      );
      setFlash(session.sessionId, 'success', 'Funcionário cadastrado.');
      return redirect(res, '/funcionarios');
    }

    if ((m = matchRoute('/funcionarios/:id/editar', pathname)) && method === 'GET') {
      const funcionario = db.prepare('SELECT * FROM funcionarios WHERE id = ?').get(m.id);
      if (!funcionario) return notFound(res);
      return send(res, 200, funcionarioFormPage({ user, flash: takeFlash(session.sessionId), funcionario, csrfToken: session.csrfToken }));
    }

    if ((m = matchRoute('/funcionarios/:id', pathname)) && method === 'POST') {
      const funcionario = db.prepare('SELECT * FROM funcionarios WHERE id = ?').get(m.id);
      if (!funcionario) return notFound(res);
      if (!body.nome || !body.nome.trim()) {
        return send(res, 400, funcionarioFormPage({ user, flash: { type: 'error', message: 'Nome do funcionário é obrigatório.' }, funcionario: { ...funcionario, ...body }, csrfToken: session.csrfToken }));
      }
      const ativo = body.ativo === '0' ? 0 : 1;
      db.prepare('UPDATE funcionarios SET nome=?, funcao=?, telefone=?, observacoes=?, ativo=? WHERE id=?').run(
        body.nome.trim(), body.funcao || '', body.telefone || '', body.observacoes || '', ativo, m.id
      );
      setFlash(session.sessionId, 'success', 'Funcionário atualizado.');
      return redirect(res, '/funcionarios');
    }

    // ---------------- ORÇAMENTOS ----------------
    if (pathname === '/orcamentos' && method === 'GET') {
      const statusFilter = url.searchParams.get('status') || '';
      let q = `SELECT o.*, c.nome as cliente_nome, b.marca, b.modelo
               FROM orcamentos o JOIN clientes c ON c.id = o.cliente_id
               LEFT JOIN bicicletas b ON b.id = o.bicicleta_id`;
      const params = [];
      if (statusFilter) { q += ' WHERE o.status = ?'; params.push(statusFilter); }
      q += ' ORDER BY o.created_at DESC';
      const orcamentos = db.prepare(q).all(...params);
      return send(res, 200, orcamentosListPage({ user, flash: takeFlash(session.sessionId), orcamentos, statusFilter }));
    }

    if (pathname === '/orcamentos/novo' && method === 'GET') {
      const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
      if (!clientes.length) {
        setFlash(session.sessionId, 'error', 'Cadastre um cliente antes de criar um orçamento.');
        return redirect(res, '/clientes');
      }
      const bicicletas = db.prepare('SELECT b.*, c.nome as cliente_nome FROM bicicletas b JOIN clientes c ON c.id=b.cliente_id ORDER BY b.created_at DESC').all();
      return send(res, 200, orcamentoFormPage({ user, flash: takeFlash(session.sessionId), clientes, bicicletas, csrfToken: session.csrfToken, defaultClienteId: url.searchParams.get('cliente_id') }));
    }

    if (pathname === '/orcamentos' && method === 'POST') {
      if (!body.cliente_id) {
        const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
        const bicicletas = db.prepare('SELECT b.*, c.nome as cliente_nome FROM bicicletas b JOIN clientes c ON c.id=b.cliente_id ORDER BY b.created_at DESC').all();
        return send(res, 400, orcamentoFormPage({ user, flash: { type: 'error', message: 'Selecione o cliente.' }, clientes, bicicletas, csrfToken: session.csrfToken }));
      }
      const numero = nextOrcamentoNumber();
      const bicicletaId = body.bicicleta_id ? toIntOrNull(body.bicicleta_id) : null;
      const info = db
        .prepare('INSERT INTO orcamentos (numero, cliente_id, bicicleta_id, validade, observacoes) VALUES (?, ?, ?, ?, ?)')
        .run(numero, body.cliente_id, bicicletaId, body.validade || null, body.observacoes || '');
      setFlash(session.sessionId, 'success', `Orçamento ${numero} criado. Adicione os itens abaixo.`);
      return redirect(res, `/orcamentos/${info.lastInsertRowid}`);
    }

    if ((m = matchRoute('/orcamentos/:id/itens/:itemId/excluir', pathname)) && method === 'POST') {
      const o = db.prepare('SELECT status FROM orcamentos WHERE id = ?').get(m.id);
      if (o && o.status === 'aberto') {
        db.prepare('DELETE FROM orcamento_itens WHERE id = ? AND orcamento_id = ?').run(m.itemId, m.id);
        recomputeOrcamentoTotal(m.id);
        setFlash(session.sessionId, 'success', 'Item removido.');
      }
      return redirect(res, `/orcamentos/${m.id}`);
    }

    if ((m = matchRoute('/orcamentos/:id/itens', pathname)) && method === 'POST') {
      const o = db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(m.id);
      if (!o) return notFound(res);
      if (o.status !== 'aberto') {
        setFlash(session.sessionId, 'error', 'Só é possível editar itens de um orçamento aberto.');
        return redirect(res, `/orcamentos/${m.id}`);
      }
      const nome = (body.nome || '').trim();
      const preco = toFloatOrNull(body.preco_unitario);
      const qtd = toIntOrNull(body.quantidade) || 1;
      const tipo = body.tipo === 'produto' ? 'produto' : 'servico';
      if (!nome) {
        setFlash(session.sessionId, 'error', 'Informe a descrição do item.');
        return redirect(res, `/orcamentos/${m.id}`);
      }
      if (preco === null || preco < 0 || qtd < 1) {
        setFlash(session.sessionId, 'error', 'Quantidade ou valor inválido.');
        return redirect(res, `/orcamentos/${m.id}`);
      }
      db.prepare('INSERT INTO orcamento_itens (orcamento_id, tipo, nome, quantidade, preco_unitario) VALUES (?, ?, ?, ?, ?)').run(m.id, tipo, nome, qtd, preco);
      recomputeOrcamentoTotal(m.id);
      setFlash(session.sessionId, 'success', 'Item adicionado ao orçamento.');
      return redirect(res, `/orcamentos/${m.id}`);
    }

    if ((m = matchRoute('/orcamentos/:id/aprovar', pathname)) && method === 'POST') {
      const o = db.prepare('SELECT status FROM orcamentos WHERE id = ?').get(m.id);
      if (!o) return notFound(res);
      if (o.status === 'aberto') {
        db.prepare("UPDATE orcamentos SET status='aprovado', updated_at=datetime('now') WHERE id=?").run(m.id);
        setFlash(session.sessionId, 'success', 'Orçamento aprovado. Agora você pode convertê-lo em O.S.');
      }
      return redirect(res, `/orcamentos/${m.id}`);
    }

    if ((m = matchRoute('/orcamentos/:id/recusar', pathname)) && method === 'POST') {
      const o = db.prepare('SELECT status FROM orcamentos WHERE id = ?').get(m.id);
      if (!o) return notFound(res);
      if (o.status === 'aberto') {
        db.prepare("UPDATE orcamentos SET status='recusado', updated_at=datetime('now') WHERE id=?").run(m.id);
        setFlash(session.sessionId, 'success', 'Orçamento marcado como recusado.');
      }
      return redirect(res, `/orcamentos/${m.id}`);
    }

    if ((m = matchRoute('/orcamentos/:id/reabrir', pathname)) && method === 'POST') {
      const o = db.prepare('SELECT status FROM orcamentos WHERE id = ?').get(m.id);
      if (!o) return notFound(res);
      if (o.status === 'recusado') {
        db.prepare("UPDATE orcamentos SET status='aberto', updated_at=datetime('now') WHERE id=?").run(m.id);
        setFlash(session.sessionId, 'success', 'Orçamento reaberto.');
      }
      return redirect(res, `/orcamentos/${m.id}`);
    }

    if ((m = matchRoute('/orcamentos/:id/converter', pathname)) && method === 'POST') {
      const o = db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(m.id);
      if (!o) return notFound(res);
      if (o.status !== 'aprovado') {
        setFlash(session.sessionId, 'error', 'Só é possível converter um orçamento aprovado.');
        return redirect(res, `/orcamentos/${m.id}`);
      }
      if (o.convertido_os_id) {
        setFlash(session.sessionId, 'error', 'Este orçamento já foi convertido em O.S.');
        return redirect(res, `/orcamentos/${m.id}`);
      }
      if (!o.bicicleta_id) {
        setFlash(session.sessionId, 'error', 'Defina um veículo no orçamento antes de converter em O.S. (a O.S. exige um veículo).');
        return redirect(res, `/orcamentos/${m.id}`);
      }
      const itens = db.prepare('SELECT * FROM orcamento_itens WHERE orcamento_id = ?').all(m.id);
      const servicos = itens.filter((i) => i.tipo === 'servico');
      const produtos = itens.filter((i) => i.tipo === 'produto');
      const valorPecas = produtos.reduce((s, i) => s + i.quantidade * i.preco_unitario, 0);
      // resumo dos produtos pro diagnóstico, já que a conversão NÃO mexe no estoque
      const resumoProd = produtos.length
        ? `Produtos previstos (orçamento ${o.numero}) — retire do estoque ao usar:\n` +
          produtos.map((p) => `- ${p.nome} x${p.quantidade} = ${(p.quantidade * p.preco_unitario).toFixed(2)}`).join('\n')
        : '';
      const diagnostico = [o.observacoes || '', resumoProd].filter(Boolean).join('\n\n');
      const numero = nextOSNumber();
      const info = db
        .prepare(
          `INSERT INTO ordens_servico (numero, cliente_id, bicicleta_id, status, checklist_json, problema_relatado, diagnostico, servicos_realizados, valor_pecas, valor_mao_obra, valor_estimado)
           VALUES (?, ?, ?, 'orcamento', ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(numero, o.cliente_id, o.bicicleta_id, JSON.stringify([]), '', diagnostico, '', valorPecas, 0, valorPecas);
      const osId = info.lastInsertRowid;
      const insS = db.prepare('INSERT INTO os_servicos (ordem_servico_id, tipo_servico_id, nome_servico, valor) VALUES (?, ?, ?, ?)');
      for (const s of servicos) insS.run(osId, s.tipo_servico_id || null, s.nome, s.quantidade * s.preco_unitario);
      recomputeValorMaoObra(osId);
      db.prepare("UPDATE orcamentos SET status='convertido', convertido_os_id=?, updated_at=datetime('now') WHERE id=?").run(osId, m.id);
      setFlash(session.sessionId, 'success', `Orçamento ${o.numero} convertido na Ordem de Serviço ${numero}.`);
      return redirect(res, `/os/${osId}`);
    }

    if ((m = matchRoute('/orcamentos/:id', pathname)) && method === 'GET') {
      const orcamento = db
        .prepare(
          `SELECT o.*, c.nome as cliente_nome, b.marca, b.modelo FROM orcamentos o
           JOIN clientes c ON c.id = o.cliente_id LEFT JOIN bicicletas b ON b.id = o.bicicleta_id WHERE o.id = ?`
        )
        .get(m.id);
      if (!orcamento) return notFound(res);
      const itens = db.prepare('SELECT * FROM orcamento_itens WHERE orcamento_id = ? ORDER BY created_at ASC').all(m.id);
      const pecasDisponiveis = canSeeAllLojas(user)
        ? db.prepare('SELECT * FROM pecas ORDER BY nome ASC').all()
        : db.prepare('SELECT * FROM pecas WHERE loja_id = ? ORDER BY nome ASC').all(user.loja_id);
      const servicosDisponiveis = db.prepare('SELECT * FROM tipos_servico WHERE ativo = 1 ORDER BY nome ASC').all();
      return send(res, 200, orcamentoShowPage({ user, flash: takeFlash(session.sessionId), orcamento, itens, pecasDisponiveis, servicosDisponiveis, csrfToken: session.csrfToken }));
    }

    // ---------------- RELATÓRIOS ----------------
    if (pathname === '/relatorios' && method === 'GET') {
      if (!hasManagementAccess(user)) return forbidden(res);
      const { de, ate } = relatorioPeriodo(url);
      const { osRows, vendas, receb, pagam } = queryRelatorios(user, de, ate);
      const osTotal = osRows.reduce((s, o) => s + o.valor, 0);
      const vendasTotal = vendas.reduce((s, v) => s + (Number(v.valor_total) || 0), 0);
      const recebido = receb.reduce((s, r) => s + (Number(r.valor) || 0), 0);
      const pago = pagam.reduce((s, p) => s + (Number(p.valor) || 0), 0);
      return send(res, 200, relatoriosPage({
        user,
        flash: takeFlash(session.sessionId),
        de,
        ate,
        osList: osRows,
        osTotal,
        vendasList: vendas,
        vendasTotal,
        recebido,
        pago,
        resultado: recebido - pago,
      }));
    }

    if (pathname === '/relatorios/export' && method === 'GET') {
      if (!hasManagementAccess(user)) return forbidden(res);
      const { de, ate } = relatorioPeriodo(url);
      const tipo = url.searchParams.get('tipo');
      const money = (v) => (Number(v) || 0).toFixed(2).replace('.', ',');
      const dataBR = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '');
      const { osRows, vendas, receb, pagam } = queryRelatorios(user, de, ate);
      if (tipo === 'os') {
        return sendCsv(
          res,
          `os_${de}_a_${ate}.csv`,
          ['Número', 'Entrada', 'Cliente', 'Veículo', 'Técnico', 'Status', 'Produtos (R$)', 'Mão de obra (R$)', 'Valor total (R$)'],
          osRows.map((o) => [
            o.numero, dataBR(o.data_entrada), o.cliente_nome, `${o.marca || ''} ${o.modelo || ''}`.trim(),
            o.tecnico_nome || '', STATUS_LABELS[o.status] || o.status, money(o.valor_pecas), money(o.valor_mao_obra), money(o.valor),
          ])
        );
      }
      if (tipo === 'vendas') {
        return sendCsv(
          res,
          `vendas_${de}_a_${ate}.csv`,
          ['Número', 'Data', 'Cliente', 'Status', 'Forma de pagamento', 'Valor total (R$)'],
          vendas.map((v) => [v.numero, dataBR(v.created_at), v.cliente_nome, v.status, v.forma_pagamento || '', money(v.valor_total)])
        );
      }
      if (tipo === 'recebimentos') {
        return sendCsv(
          res,
          `recebimentos_${de}_a_${ate}.csv`,
          ['Recebido em', 'Descrição', 'Cliente', 'Valor (R$)'],
          receb.map((r) => [dataBR(r.recebido_em), r.descricao, r.cliente_nome || '', money(r.valor)])
        );
      }
      if (tipo === 'pagamentos') {
        return sendCsv(
          res,
          `pagamentos_${de}_a_${ate}.csv`,
          ['Pago em', 'Descrição', 'Fornecedor', 'Valor (R$)'],
          pagam.map((p) => [dataBR(p.pago_em), p.descricao, p.fornecedor_nome || '', money(p.valor)])
        );
      }
      return redirect(res, '/relatorios');
    }

    // ---------------- TIPOS DE SERVIÇO ----------------
    if (pathname === '/servicos' && method === 'GET') {
      const servicos = db.prepare('SELECT * FROM tipos_servico ORDER BY nome ASC').all();
      return send(res, 200, tiposServicoListPage({ user, flash: takeFlash(session.sessionId), servicos }));
    }

    if (pathname === '/servicos/novo' && method === 'GET') {
      return send(res, 200, tipoServicoFormPage({ user, flash: takeFlash(session.sessionId), servico: null, csrfToken: session.csrfToken }));
    }

    if (pathname === '/servicos' && method === 'POST') {
      const valor = toFloatOrNull(body.valor);
      if (!body.nome || !body.nome.trim() || valor === null) {
        return send(res, 400, tipoServicoFormPage({ user, flash: { type: 'error', message: 'Nome e valor são obrigatórios.' }, servico: body, csrfToken: session.csrfToken }));
      }
      db.prepare('INSERT INTO tipos_servico (nome, categoria, valor) VALUES (?, ?, ?)').run(body.nome.trim(), body.categoria || '', valor);
      setFlash(session.sessionId, 'success', 'Tipo de serviço cadastrado.');
      return redirect(res, '/servicos');
    }

    if ((m = matchRoute('/servicos/:id/editar', pathname)) && method === 'GET') {
      const servico = db.prepare('SELECT * FROM tipos_servico WHERE id = ?').get(m.id);
      if (!servico) return notFound(res);
      return send(res, 200, tipoServicoFormPage({ user, flash: takeFlash(session.sessionId), servico, csrfToken: session.csrfToken }));
    }

    if ((m = matchRoute('/servicos/:id', pathname)) && method === 'POST') {
      const servico = db.prepare('SELECT * FROM tipos_servico WHERE id = ?').get(m.id);
      if (!servico) return notFound(res);
      const valor = toFloatOrNull(body.valor);
      if (!body.nome || !body.nome.trim() || valor === null) {
        return send(res, 400, tipoServicoFormPage({ user, flash: { type: 'error', message: 'Nome e valor são obrigatórios.' }, servico: { ...servico, ...body }, csrfToken: session.csrfToken }));
      }
      const ativo = body.ativo === '0' ? 0 : 1;
      db.prepare('UPDATE tipos_servico SET nome=?, categoria=?, valor=?, ativo=? WHERE id=?').run(
        body.nome.trim(), body.categoria || '', valor, ativo, m.id
      );
      setFlash(session.sessionId, 'success', 'Tipo de serviço atualizado.');
      return redirect(res, '/servicos');
    }

    // ---------------- CONTRATOS (assinatura online) ----------------
    // Rotas públicas (o cliente abre pelo link, sem estar logado) vêm primeiro.
    if ((m = matchRoute('/contratos/assinar/:token/arquivo', pathname)) && method === 'GET') {
      const contrato = db.prepare('SELECT * FROM contratos WHERE token = ?').get(m.token);
      if (!contrato) return notFound(res);
      const tipo = url.searchParams.get('tipo');
      const caminho = tipo === 'original' ? contrato.arquivo_original : contrato.arquivo_assinado || contrato.arquivo_original;
      const fullPath = resolveUploadPath(caminho);
      if (!fullPath || !fs.existsSync(fullPath)) return notFound(res);
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="contrato.pdf"' });
      fs.createReadStream(fullPath).pipe(res);
      return;
    }

    if ((m = matchRoute('/contratos/assinar/:token', pathname)) && method === 'GET') {
      const contrato = db.prepare('SELECT * FROM contratos WHERE token = ?').get(m.token);
      if (!contrato) return notFound(res);
      if (contrato.status !== 'pendente') return send(res, 200, contratoJaProcessadoPage({ status: contrato.status }));
      const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(contrato.cliente_id);
      return send(res, 200, contratoAssinarPage({ contrato, cliente }));
    }

    if ((m = matchRoute('/contratos/assinar/:token', pathname)) && method === 'POST') {
      const contrato = db.prepare('SELECT * FROM contratos WHERE token = ?').get(m.token);
      if (!contrato) return notFound(res);
      if (contrato.status !== 'pendente') return send(res, 200, contratoJaProcessadoPage({ status: contrato.status }));
      const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(contrato.cliente_id);

      const nome = (body.nome || '').trim();
      const documento = (body.documento || '').trim();
      const assinaturaBuffer = decodePngDataUrl(body.assinatura_png);
      if (!nome || !documento || !assinaturaBuffer) {
        return send(res, 400, contratoAssinarPage({
          contrato, cliente, error: 'Preencha nome, documento e desenhe a assinatura antes de confirmar.',
        }));
      }

      const assinadoEm = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const ip = clientIp(req);
      const userAgent = req.headers['user-agent'] || '';

      db.prepare(
        `UPDATE contratos SET status='assinado', assinante_nome=?, assinante_documento=?, assinante_ip=?, assinante_user_agent=?, assinado_em=? WHERE id=?`
      ).run(nome, documento, ip, userAgent, assinadoEm, contrato.id);
      const contratoAtualizado = db.prepare('SELECT * FROM contratos WHERE id = ?').get(contrato.id);

      try {
        const originalPath = resolveUploadPath(contrato.arquivo_original);
        const originalBuffer = fs.readFileSync(originalPath);
        const pdfAssinadoBuffer = await gerarPdfAssinado({
          originalBuffer,
          contrato: contratoAtualizado,
          clienteNome: cliente.nome,
          assinaturaPngBuffer: assinaturaBuffer,
        });
        const caminhoAssinado = saveBufferAsUpload('contrato', contrato.id, pdfAssinadoBuffer, 'contrato-assinado.pdf');
        db.prepare('UPDATE contratos SET arquivo_assinado = ? WHERE id = ?').run(caminhoAssinado, contrato.id);
      } catch (err) {
        console.error('[contratos] Falha ao gerar PDF assinado (o aceite já foi registrado no banco):', err);
      }

      if (cliente.email && mailConfigured()) {
        try {
          await sendMail({
            to: cliente.email,
            toName: cliente.nome,
            subject: `Contrato assinado: ${contrato.titulo} - Golden SaaS`,
            html: `<p>Olá ${escapeHtml(cliente.nome)}, confirmamos o recebimento da sua assinatura no documento "${escapeHtml(contrato.titulo)}" em ${assinadoEm}.</p>`,
            text: `Confirmamos o recebimento da sua assinatura no documento "${contrato.titulo}" em ${assinadoEm}.`,
          });
        } catch (err) {
          console.error('[contratos] Falha ao enviar e-mail de confirmação:', err);
        }
      }

      const contratoFinal = db.prepare('SELECT * FROM contratos WHERE id = ?').get(contrato.id);
      return send(res, 200, contratoAssinadoPage({ contrato: contratoFinal }));
    }

    // Rotas administrativas (dentro do sistema, exigem login).
    if (pathname === '/contratos' && method === 'GET') {
      const contratos = db
        .prepare(
          `SELECT ct.*, c.nome as cliente_nome FROM contratos ct JOIN clientes c ON c.id = ct.cliente_id ORDER BY ct.created_at DESC`
        )
        .all();
      return send(res, 200, contratosListPage({ user, flash: takeFlash(session.sessionId), contratos, baseUrl: baseUrlFromReq(req) }));
    }

    if (pathname === '/contratos/novo' && method === 'GET') {
      const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
      return send(res, 200, contratoFormPage({
        user, flash: takeFlash(session.sessionId), clientes, csrfToken: session.csrfToken,
        clienteFixoId: url.searchParams.get('cliente_id'),
      }));
    }

    if (pathname === '/contratos' && method === 'POST') {
      const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
      const cliente = body.cliente_id ? db.prepare('SELECT * FROM clientes WHERE id = ?').get(body.cliente_id) : null;
      const arquivo = files.find((f) => f.fieldName === 'arquivo');
      if (!cliente || !body.titulo || !body.titulo.trim() || !arquivo || !arquivo.data || !arquivo.data.length) {
        return send(res, 400, contratoFormPage({
          user, flash: { type: 'error', message: 'Selecione o cliente, o título e um arquivo PDF válido.' },
          clientes, csrfToken: session.csrfToken, clienteFixoId: body.cliente_id,
        }));
      }
      const token = novoContratoToken();
      const info = db
        .prepare('INSERT INTO contratos (cliente_id, titulo, token, criado_por) VALUES (?, ?, ?, ?)')
        .run(cliente.id, body.titulo.trim(), token, user.id);
      const contratoId = info.lastInsertRowid;
      const saved = saveDocumentFile('contrato', contratoId, arquivo);
      if (!saved) {
        db.prepare('DELETE FROM contratos WHERE id = ?').run(contratoId);
        return send(res, 400, contratoFormPage({
          user, flash: { type: 'error', message: 'Não foi possível salvar o arquivo. Confira se é um PDF válido (até 20MB).' },
          clientes, csrfToken: session.csrfToken, clienteFixoId: body.cliente_id,
        }));
      }
      const hash = sha256Hex(arquivo.data);
      db.prepare('UPDATE contratos SET arquivo_original = ?, hash_original = ? WHERE id = ?').run(saved.caminho_arquivo, hash, contratoId);
      setFlash(session.sessionId, 'success', 'Contrato cadastrado. Copie o link ou envie por e-mail/WhatsApp na tela do contrato.');
      return redirect(res, `/contratos/${contratoId}`);
    }

    if ((m = matchRoute('/contratos/:id', pathname)) && method === 'GET') {
      const contrato = db.prepare('SELECT * FROM contratos WHERE id = ?').get(m.id);
      if (!contrato) return notFound(res);
      const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(contrato.cliente_id);
      return send(res, 200, contratoShowPage({
        user, flash: takeFlash(session.sessionId), contrato, cliente, csrfToken: session.csrfToken,
        baseUrl: baseUrlFromReq(req), emailIsConfigured: mailConfigured(),
      }));
    }

    if ((m = matchRoute('/contratos/:id/arquivo', pathname)) && method === 'GET') {
      const contrato = db.prepare('SELECT * FROM contratos WHERE id = ?').get(m.id);
      if (!contrato) return notFound(res);
      const tipo = url.searchParams.get('tipo');
      const caminho = tipo === 'original' ? contrato.arquivo_original : contrato.arquivo_assinado || contrato.arquivo_original;
      const fullPath = resolveUploadPath(caminho);
      if (!fullPath || !fs.existsSync(fullPath)) return notFound(res);
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      fs.createReadStream(fullPath).pipe(res);
      return;
    }

    if ((m = matchRoute('/contratos/:id/enviar-email', pathname)) && method === 'POST') {
      const contrato = db.prepare('SELECT * FROM contratos WHERE id = ?').get(m.id);
      if (!contrato) return notFound(res);
      const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(contrato.cliente_id);
      if (!cliente.email) {
        setFlash(session.sessionId, 'error', 'Cliente sem e-mail cadastrado.');
        return redirect(res, `/contratos/${m.id}`);
      }
      const link = `${baseUrlFromReq(req)}/contratos/assinar/${contrato.token}`;
      try {
        await sendMail({
          to: cliente.email,
          toName: cliente.nome,
          subject: `Contrato para assinatura: ${contrato.titulo} - Golden SaaS`,
          html: `<p>Olá ${escapeHtml(cliente.nome)}, segue o link para ler e assinar online o contrato "${escapeHtml(contrato.titulo)}":</p><p><a href="${link}">${link}</a></p>`,
          text: `Segue o link para ler e assinar online o contrato "${contrato.titulo}": ${link}`,
        });
        setFlash(session.sessionId, 'success', `E-mail enviado para ${cliente.email}.`);
      } catch (err) {
        console.error('[contratos] Falha ao enviar e-mail:', err);
        setFlash(session.sessionId, 'error', 'Falha ao enviar e-mail: ' + (err && err.message ? err.message : 'erro desconhecido.'));
      }
      return redirect(res, `/contratos/${m.id}`);
    }

    if ((m = matchRoute('/contratos/:id/cancelar', pathname)) && method === 'POST') {
      const contrato = db.prepare('SELECT * FROM contratos WHERE id = ?').get(m.id);
      if (!contrato) return notFound(res);
      db.prepare("UPDATE contratos SET status = 'cancelado' WHERE id = ?").run(m.id);
      setFlash(session.sessionId, 'success', 'Contrato cancelado.');
      return redirect(res, `/contratos/${m.id}`);
    }

    // ---------------- CONTAS A PAGAR ----------------
    // ---------------- FINANCEIRO (resumo consolidado) ----------------
    if (pathname === '/financeiro' && method === 'GET') {
      const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      const mesAtual = hoje.slice(0, 7);
      // janela dos últimos 6 meses (YYYY-MM, do mais antigo pro mais recente)
      const months = [];
      const base = new Date(hoje + 'T12:00:00');
      for (let i = 5; i >= 0; i--) {
        const d = new Date(base);
        d.setMonth(d.getMonth() - i);
        months.push(d.toISOString().slice(0, 7));
      }
      const mesLabelMap = {
        '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril', '05': 'Maio', '06': 'Junho',
        '07': 'Julho', '08': 'Agosto', '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro',
      };

      // só as contas das lojas que o usuário pode ver
      const receber = db
        .prepare('SELECT cr.*, c.nome as cliente_nome FROM contas_receber cr LEFT JOIN clientes c ON c.id = cr.cliente_id')
        .all()
        .filter((r) => canSeeLoja(user, r.loja_id));
      const pagar = db
        .prepare('SELECT cp.*, f.nome as fornecedor_nome FROM contas_pagar cp LEFT JOIN fornecedores f ON f.id = cp.fornecedor_id')
        .all()
        .filter((p) => canSeeLoja(user, p.loja_id));

      const soma = (arr) => arr.reduce((s, x) => s + (Number(x.valor) || 0), 0);

      const receberPend = receber.filter((r) => r.status !== 'recebido');
      const pagarPend = pagar.filter((p) => p.status !== 'pago');
      const receberVenc = receberPend.filter((r) => r.vencimento && r.vencimento < hoje);
      const pagarVenc = pagarPend.filter((p) => p.vencimento && p.vencimento < hoje);

      const aReceberPendente = soma(receberPend);
      const aPagarPendente = soma(pagarPend);

      const recebidoMes = soma(receber.filter((r) => r.recebido_em && r.recebido_em.slice(0, 7) === mesAtual));
      const pagoMes = soma(pagar.filter((p) => p.pago_em && p.pago_em.slice(0, 7) === mesAtual));

      const fluxo = months.map((ym) => {
        const recebido = soma(receber.filter((r) => r.recebido_em && r.recebido_em.slice(0, 7) === ym));
        const pago = soma(pagar.filter((p) => p.pago_em && p.pago_em.slice(0, 7) === ym));
        const [ano, mes] = ym.split('-');
        return { ym, label: `${mesLabelMap[mes]}/${ano}`, recebido, pago, saldo: recebido - pago };
      });

      // vencidas + vencendo nos próximos 7 dias
      const limite = new Date(base);
      limite.setDate(limite.getDate() + 7);
      const limite7 = limite.toISOString().slice(0, 10);
      const vencimentos = [
        ...receberPend
          .filter((r) => r.vencimento && r.vencimento <= limite7)
          .map((r) => ({ tipo: 'receber', descricao: r.descricao, valor: r.valor, vencimento: r.vencimento, atrasada: r.vencimento < hoje, nome: r.cliente_nome })),
        ...pagarPend
          .filter((p) => p.vencimento && p.vencimento <= limite7)
          .map((p) => ({ tipo: 'pagar', descricao: p.descricao, valor: p.valor, vencimento: p.vencimento, atrasada: p.vencimento < hoje, nome: p.fornecedor_nome })),
      ].sort((a, b) => a.vencimento.localeCompare(b.vencimento));

      return send(res, 200, financeiroResumoPage({
        user,
        flash: takeFlash(session.sessionId),
        aReceberPendente,
        aReceberVencidasValor: soma(receberVenc),
        aReceberVencidasQtd: receberVenc.length,
        aPagarPendente,
        aPagarVencidasValor: soma(pagarVenc),
        aPagarVencidasQtd: pagarVenc.length,
        saldoPrevisto: aReceberPendente - aPagarPendente,
        recebidoMes,
        pagoMes,
        resultadoMes: recebidoMes - pagoMes,
        mesLabel: `${mesLabelMap[mesAtual.slice(5, 7)]}/${mesAtual.slice(0, 4)}`,
        fluxo,
        vencimentos,
      }));
    }

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
      const infoContaPagar = db.prepare(
        `INSERT INTO contas_pagar (descricao, valor, vencimento, forma_pagamento, loja_id, fornecedor_id, observacoes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        body.descricao.trim(), toFloatOrNull(body.valor) || 0, body.vencimento || null, body.forma_pagamento || '',
        lojaIdEscolhida, toIntOrNull(body.fornecedor_id), body.observacoes || ''
      );
      const contaPagarId = infoContaPagar.lastInsertRowid;
      const anexoNovo = files.find((f) => f.fieldName === 'anexo' && f.data && f.data.length > 0);
      if (anexoNovo) {
        const savedAnexo = saveReceiptFile('conta-pagar', contaPagarId, anexoNovo);
        if (savedAnexo) {
          db.prepare('UPDATE contas_pagar SET anexo_caminho = ?, anexo_nome = ? WHERE id = ?').run(savedAnexo.caminho_arquivo, savedAnexo.nome_arquivo, contaPagarId);
        } else {
          setFlash(session.sessionId, 'error', 'Conta a pagar cadastrada, mas o anexo não pôde ser salvo (use PDF, JPG, PNG, WEBP ou HEIC, até 20MB).');
          return redirect(res, `/contas-pagar/${contaPagarId}/editar`);
        }
      }
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
      const anexoSubstituto = files.find((f) => f.fieldName === 'anexo' && f.data && f.data.length > 0);
      if (anexoSubstituto) {
        const savedAnexo = saveReceiptFile('conta-pagar', m.id, anexoSubstituto);
        if (savedAnexo) {
          if (conta.anexo_caminho) deleteUploadedFile(conta.anexo_caminho);
          db.prepare('UPDATE contas_pagar SET anexo_caminho = ?, anexo_nome = ? WHERE id = ?').run(savedAnexo.caminho_arquivo, savedAnexo.nome_arquivo, m.id);
        } else {
          setFlash(session.sessionId, 'error', 'Conta atualizada, mas o novo anexo não pôde ser salvo (use PDF, JPG, PNG, WEBP ou HEIC, até 20MB).');
          return redirect(res, `/contas-pagar/${m.id}/editar`);
        }
      }
      setFlash(session.sessionId, 'success', 'Conta a pagar atualizada.');
      return redirect(res, `/contas-pagar/${m.id}/editar`);
    }

    if ((m = matchRoute('/contas-pagar/:id/remover-anexo', pathname)) && method === 'POST') {
      const conta = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(m.id);
      if (!conta) return notFound(res);
      if (!canEditLoja(user, conta.loja_id)) return forbidden(res);
      if (conta.anexo_caminho) {
        deleteUploadedFile(conta.anexo_caminho);
        db.prepare('UPDATE contas_pagar SET anexo_caminho = NULL, anexo_nome = NULL WHERE id = ?').run(m.id);
        setFlash(session.sessionId, 'success', 'Anexo removido.');
      }
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

    if (pathname === '/os/painel' && method === 'GET') {
      const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      const amanha = (() => {
        const d = new Date(hoje + 'T12:00:00');
        d.setDate(d.getDate() + 1);
        return d.toLocaleDateString('en-CA');
      })();
      const abertas = db
        .prepare(
          `SELECT os.*, c.nome as cliente_nome, b.marca, b.modelo
           FROM ordens_servico os
           JOIN clientes c ON c.id = os.cliente_id
           JOIN bicicletas b ON b.id = os.bicicleta_id
           WHERE os.ativo = 1 AND os.status != 'concluida'
           ORDER BY os.created_at DESC`
        )
        .all();
      const fatur = db
        .prepare(
          `SELECT strftime('%Y-%m', data_entrada) as ym, COALESCE(SUM(valor_estimado), 0) as total, COUNT(*) as n
           FROM ordens_servico WHERE ativo = 1 GROUP BY ym ORDER BY ym DESC LIMIT 6`
        )
        .all();
      const faturTecnico = db
        .prepare(
          `SELECT COALESCE(f.nome, 'Sem técnico') as tecnico, COUNT(*) as n, COALESCE(SUM(os.valor_estimado), 0) as total
           FROM ordens_servico os LEFT JOIN funcionarios f ON f.id = os.tecnico_id
           WHERE os.ativo = 1 GROUP BY os.tecnico_id ORDER BY total DESC`
        )
        .all();
      return send(res, 200, ordemPainelPage({ user, flash: takeFlash(session.sessionId), abertas, fatur, faturTecnico, hoje, amanha }));
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
      const funcionarios = db.prepare('SELECT * FROM funcionarios WHERE ativo = 1 ORDER BY nome ASC').all();
      return send(
        res,
        200,
        ordemFormPage({ user, flash: takeFlash(session.sessionId), os: null, clientes, bicicletas, defaultClienteId, defaultBicicletaId, csrfToken: session.csrfToken, funcionarios })
      );
    }

    if (pathname === '/os' && method === 'POST') {
      const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
      const bicicletas = db.prepare('SELECT b.*, c.nome as cliente_nome FROM bicicletas b JOIN clientes c ON c.id=b.cliente_id ORDER BY b.created_at DESC').all();
      if (!body.cliente_id || !body.bicicleta_id) {
        const funcionarios = db.prepare('SELECT * FROM funcionarios WHERE ativo = 1 ORDER BY nome ASC').all();
        return send(res, 400, ordemFormPage({ user, flash: { type: 'error', message: 'Cliente e veículo são obrigatórios.' }, os: null, clientes, bicicletas, csrfToken: session.csrfToken, funcionarios }));
      }
      const checklist = parseChecklistFromBody(body);
      const numero = nextOSNumber();
      const valorPecas = toFloatOrNull(body.valor_pecas);
      const valorMaoObra = toFloatOrNull(body.valor_mao_obra);
      const formaPagamento = body.forma_pagamento || null;
      const parcelas = formaPagamento === 'credito' ? toIntOrNull(body.parcelas) : null;
      const prioridade = PRIORIDADES_OS.includes(body.prioridade) ? body.prioridade : 'normal';
      const previsaoEntrega = body.previsao_entrega || null;
      const tecnicoId = validTecnicoId(body.tecnico_id);
      const desconto = toFloatOrNull(body.desconto) || 0;
      const totalEstimado = Math.max(0, (valorPecas || 0) + (valorMaoObra || 0) - desconto);
      const info = db
        .prepare(
          `INSERT INTO ordens_servico (numero, cliente_id, bicicleta_id, status, checklist_json, problema_relatado, diagnostico, servicos_realizados, valor_pecas, valor_mao_obra, desconto, valor_estimado, forma_pagamento, parcelas, prioridade, previsao_entrega, acessorios, termos_garantia, tecnico_id)
           VALUES (?, ?, ?, 'orcamento', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          numero, body.cliente_id, body.bicicleta_id, JSON.stringify(checklist),
          body.problema_relatado || '', body.diagnostico || '', body.servicos_realizados || '',
          valorPecas, valorMaoObra, desconto, totalEstimado, formaPagamento, parcelas,
          prioridade, previsaoEntrega, body.acessorios || '', body.termos_garantia || '', tecnicoId
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
      const temServicosVinculados = db.prepare('SELECT COUNT(*) c FROM os_servicos WHERE ordem_servico_id = ?').get(m.id).c > 0;
      const funcionarios = db.prepare('SELECT * FROM funcionarios WHERE ativo = 1 ORDER BY nome ASC').all();
      return send(res, 200, ordemFormPage({ user, flash: takeFlash(session.sessionId), os, clientes, bicicletas, csrfToken: session.csrfToken, temPecasVinculadas, temServicosVinculados, funcionarios }));
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
        setFlash(session.sessionId, 'error', 'Produto não encontrado no estoque.');
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
          ? `Produto "${peca.nome}" adicionado à O.S. Atenção: o estoque desse produto ficou zerado ou negativo (${novaQuantidade}).`
          : `Produto "${peca.nome}" adicionado à O.S.`
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
        setFlash(session.sessionId, 'success', 'Produto removido da O.S. e devolvido ao estoque.');
      }
      return redirect(res, `/os/${m.id}`);
    }

    if ((m = matchRoute('/os/:id/servicos', pathname)) && method === 'POST') {
      const os = db.prepare('SELECT * FROM ordens_servico WHERE id = ?').get(m.id);
      if (!os) return notFound(res);
      const nomeServico = (body.nome_servico || '').trim();
      const valorServico = toFloatOrNull(body.valor);
      const tipoServicoId = body.tipo_servico_id ? toIntOrNull(body.tipo_servico_id) : null;
      if (!nomeServico) {
        setFlash(session.sessionId, 'error', 'Informe o nome do serviço.');
        return redirect(res, `/os/${m.id}`);
      }
      if (valorServico === null || valorServico < 0) {
        setFlash(session.sessionId, 'error', 'Valor do serviço inválido.');
        return redirect(res, `/os/${m.id}`);
      }
      db.prepare(
        'INSERT INTO os_servicos (ordem_servico_id, tipo_servico_id, nome_servico, valor) VALUES (?, ?, ?, ?)'
      ).run(m.id, tipoServicoId, nomeServico, valorServico);
      recomputeValorMaoObra(m.id);
      setFlash(session.sessionId, 'success', `Serviço "${nomeServico}" adicionado à O.S.`);
      return redirect(res, `/os/${m.id}`);
    }

    if ((m = matchRoute('/os/:id/servicos/:itemId/excluir', pathname)) && method === 'POST') {
      const item = db.prepare('SELECT * FROM os_servicos WHERE id = ? AND ordem_servico_id = ?').get(m.itemId, m.id);
      if (item) {
        db.prepare('DELETE FROM os_servicos WHERE id = ?').run(item.id);
        recomputeValorMaoObra(m.id);
        setFlash(session.sessionId, 'success', 'Serviço removido da O.S.');
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
      const prioridade = PRIORIDADES_OS.includes(body.prioridade) ? body.prioridade : os.prioridade || 'normal';
      const previsaoEntrega = body.previsao_entrega || null;
      const tecnicoId = validTecnicoId(body.tecnico_id);
      const desconto = toFloatOrNull(body.desconto) || 0;
      const totalEstimado = Math.max(0, (valorPecas || 0) + (valorMaoObra || 0) - desconto);
      db.prepare(
        `UPDATE ordens_servico SET cliente_id=?, bicicleta_id=?, status=?, checklist_json=?, problema_relatado=?, diagnostico=?, servicos_realizados=?, valor_pecas=?, valor_mao_obra=?, desconto=?, valor_estimado=?, forma_pagamento=?, parcelas=?, data_conclusao=?, prioridade=?, previsao_entrega=?, acessorios=?, termos_garantia=?, tecnico_id=?, updated_at=datetime('now') WHERE id=?`
      ).run(
        body.cliente_id || os.cliente_id, body.bicicleta_id || os.bicicleta_id, status, JSON.stringify(checklist),
        body.problema_relatado || '', body.diagnostico || '', body.servicos_realizados || '',
        valorPecas, valorMaoObra, desconto, totalEstimado, formaPagamento, parcelas, dataConclusao,
        prioridade, previsaoEntrega, body.acessorios || '', body.termos_garantia || '', tecnicoId, m.id
      );
      setFlash(session.sessionId, 'success', 'Ordem de Serviço atualizada.');
      return redirect(res, `/os/${m.id}`);
    }

    if ((m = matchRoute('/os/:id/imprimir', pathname)) && method === 'GET') {
      const os = db
        .prepare(
          `SELECT os.*, c.nome as cliente_nome, c.telefone as cliente_telefone, c.email as cliente_email,
                  b.marca, b.modelo, b.cor, b.tipo_veiculo, b.motor_serial, b.controladora_serial, b.bateria_serial, b.chassi_numero,
                  f.nome as tecnico_nome
           FROM ordens_servico os
           JOIN clientes c ON c.id = os.cliente_id JOIN bicicletas b ON b.id = os.bicicleta_id
           LEFT JOIN funcionarios f ON f.id = os.tecnico_id WHERE os.id = ?`
        )
        .get(m.id);
      if (!os) return notFound(res);
      const osPecas = db.prepare('SELECT * FROM os_pecas WHERE ordem_servico_id = ? ORDER BY created_at ASC').all(m.id);
      const osServicos = db.prepare('SELECT * FROM os_servicos WHERE ordem_servico_id = ? ORDER BY created_at ASC').all(m.id);
      return send(res, 200, ordemImprimirPage({ os, osPecas, osServicos }));
    }

    if ((m = matchRoute('/os/:id', pathname)) && method === 'GET') {
      const os = db
        .prepare(
          `SELECT os.*, c.nome as cliente_nome, b.marca, b.modelo, f.nome as tecnico_nome FROM ordens_servico os
           JOIN clientes c ON c.id = os.cliente_id JOIN bicicletas b ON b.id = os.bicicleta_id
           LEFT JOIN funcionarios f ON f.id = os.tecnico_id WHERE os.id = ?`
        )
        .get(m.id);
      if (!os) return notFound(res);
      const midiasChecklist = db.prepare("SELECT * FROM os_midias WHERE ordem_servico_id = ? AND categoria = 'checklist' ORDER BY created_at DESC").all(m.id);
      const midiasServico = db.prepare("SELECT * FROM os_midias WHERE ordem_servico_id = ? AND categoria = 'servico' ORDER BY created_at DESC").all(m.id);
      const osPecas = db.prepare('SELECT * FROM os_pecas WHERE ordem_servico_id = ? ORDER BY created_at DESC').all(m.id);
      const pecasDisponiveis = canSeeAllLojas(user)
        ? db.prepare('SELECT * FROM pecas ORDER BY nome ASC').all()
        : db.prepare('SELECT * FROM pecas WHERE loja_id = ? ORDER BY nome ASC').all(user.loja_id);
      const osServicos = db.prepare('SELECT * FROM os_servicos WHERE ordem_servico_id = ? ORDER BY created_at DESC').all(m.id);
      const servicosDisponiveis = db.prepare('SELECT * FROM tipos_servico WHERE ativo = 1 ORDER BY nome ASC').all();
      return send(res, 200, ordemShowPage({ user, flash: takeFlash(session.sessionId), os, midiasChecklist, midiasServico, osPecas, pecasDisponiveis, osServicos, servicosDisponiveis, csrfToken: session.csrfToken }));
    }

    // ---------------- VENDA DIRETO ----------------
    if (pathname === '/consulta-preco' && method === 'GET') {
      const pecas = canSeeAllLojas(user)
        ? db.prepare('SELECT id, nome, preco_venda, foto_caminho FROM pecas ORDER BY nome ASC').all()
        : db.prepare('SELECT id, nome, preco_venda, foto_caminho FROM pecas WHERE loja_id = ? ORDER BY nome ASC').all(user.loja_id);
      return send(res, 200, consultaPrecoPage({ user, flash: takeFlash(session.sessionId), pecas }));
    }

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
      const pecasNovaVenda = canSeeAllLojas(user)
        ? db.prepare('SELECT * FROM pecas ORDER BY nome ASC').all()
        : db.prepare('SELECT * FROM pecas WHERE loja_id = ? ORDER BY nome ASC').all(user.loja_id);
      return send(res, 200, vendaFormPage({
        user, flash: takeFlash(session.sessionId), clientes, csrfToken: session.csrfToken,
        lojas, lojaFixaNome: canSeeAllLojas(user) ? null : (lojaPropria ? lojaPropria.nome : null),
        pecasDisponiveis: pecasNovaVenda,
      }));
    }

    if (pathname === '/vendas' && method === 'POST') {
      const clientes = db.prepare('SELECT * FROM clientes ORDER BY nome ASC').all();
      const lojaPropria = user.loja_id ? db.prepare('SELECT * FROM lojas WHERE id = ?').get(user.loja_id) : null;
      const lojas = canSeeAllLojas(user) ? db.prepare('SELECT * FROM lojas WHERE ativo = 1 ORDER BY nome ASC').all() : [];
      const lojaFixaNome = canSeeAllLojas(user) ? null : (lojaPropria ? lojaPropria.nome : null);
      const lojaIdEscolhida = canSeeAllLojas(user) ? toIntOrNull(body.loja_id) : user.loja_id;
      const pecasNovaVenda = canSeeAllLojas(user)
        ? db.prepare('SELECT * FROM pecas ORDER BY nome ASC').all()
        : db.prepare('SELECT * FROM pecas WHERE loja_id = ? ORDER BY nome ASC').all(user.loja_id);

      if (!body.cliente_id) {
        return send(res, 400, vendaFormPage({ user, flash: { type: 'error', message: 'Selecione um cliente.' }, clientes, csrfToken: session.csrfToken, lojas, lojaFixaNome, pecasDisponiveis: pecasNovaVenda }));
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
      const vendaNovaId = info.lastInsertRowid;

      // Itens adicionados na própria tela (venda em tela única). Preço da peça
      // vem do servidor (não do cliente); item avulso usa o preço informado.
      let itensNovos = [];
      try {
        itensNovos = JSON.parse(body.itens_json || '[]');
      } catch (_e) {
        itensNovos = [];
      }
      let estoqueNegativo = false;
      for (const it of Array.isArray(itensNovos) ? itensNovos : []) {
        const qtd = Math.max(1, parseInt(it.qtd, 10) || 1);
        if (it.peca_id) {
          const peca = db.prepare('SELECT * FROM pecas WHERE id = ?').get(it.peca_id);
          if (!peca) continue;
          db.prepare('INSERT INTO venda_itens (venda_id, peca_id, nome_peca, quantidade, preco_unitario) VALUES (?, ?, ?, ?, ?)')
            .run(vendaNovaId, peca.id, peca.nome, qtd, peca.preco_venda);
          const nova = peca.quantidade - qtd;
          db.prepare("UPDATE pecas SET quantidade = ?, updated_at = datetime('now') WHERE id = ?").run(nova, peca.id);
          if (nova < 0) estoqueNegativo = true;
        } else if (it.nome && String(it.nome).trim()) {
          const preco = Number(it.preco) || 0;
          db.prepare('INSERT INTO venda_itens (venda_id, nome_peca, quantidade, preco_unitario) VALUES (?, ?, ?, ?)')
            .run(vendaNovaId, String(it.nome).trim(), qtd, preco);
        }
      }
      const totalNovo = db.prepare('SELECT COALESCE(SUM(quantidade * preco_unitario), 0) as total FROM venda_itens WHERE venda_id = ?').get(vendaNovaId).total;
      db.prepare('UPDATE vendas SET valor_total = ? WHERE id = ?').run(totalNovo, vendaNovaId);

      setFlash(
        session.sessionId,
        estoqueNegativo ? 'error' : 'success',
        estoqueNegativo
          ? `Venda ${numero} criada, mas o estoque de algum produto ficou negativo — confira.`
          : `Venda ${numero} criada com os itens.`
      );
      return redirect(res, `/vendas/${vendaNovaId}`);
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
      const servicosDisponiveis = db.prepare('SELECT * FROM tipos_servico WHERE ativo = 1 ORDER BY nome ASC').all();
      return send(res, 200, vendaShowPage({ user, flash: takeFlash(session.sessionId), venda, itens, pecasDisponiveis, servicosDisponiveis, csrfToken: session.csrfToken, configFiscal: getConfigFiscal() }));
    }

    if ((m = matchRoute('/vendas/:id/itens', pathname)) && method === 'POST') {
      const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(m.id);
      if (!venda) return notFound(res);
      if (!canEditLoja(user, venda.loja_id)) return forbidden(res);
      if (venda.status !== 'aberta') {
        setFlash(session.sessionId, 'error', 'Esta venda já foi finalizada e não pode mais ser alterada.');
        return redirect(res, `/vendas/${m.id}`);
      }

      if (typeof body.produto_id === 'string' && body.produto_id.startsWith('servico:')) {
        const tipoServicoId = body.produto_id.slice('servico:'.length);
        const servico = db.prepare('SELECT * FROM tipos_servico WHERE id = ? AND ativo = 1').get(tipoServicoId);
        if (!servico) {
          setFlash(session.sessionId, 'error', 'Tipo de serviço não encontrado ou inativo.');
          return redirect(res, `/vendas/${m.id}`);
        }
        const quantidadeServico = toIntOrNull(body.quantidade) || 1;
        db.prepare(
          'INSERT INTO venda_itens (venda_id, tipo_servico_id, nome_peca, quantidade, preco_unitario) VALUES (?, ?, ?, ?, ?)'
        ).run(m.id, servico.id, servico.nome, quantidadeServico, servico.valor);
        const novoTotalServico = db.prepare('SELECT COALESCE(SUM(quantidade * preco_unitario), 0) as total FROM venda_itens WHERE venda_id = ?').get(m.id).total;
        db.prepare('UPDATE vendas SET valor_total = ? WHERE id = ?').run(novoTotalServico, m.id);
        setFlash(session.sessionId, 'success', `Serviço "${servico.nome}" adicionado à venda.`);
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
        setFlash(session.sessionId, 'success', `Veículo "${`${marca} ${modelo}`.trim()}" adicionado à venda e cadastrado em Veículos.`);
        return redirect(res, `/vendas/${m.id}`);
      }

      if (!body.produto_id) {
        setFlash(session.sessionId, 'error', 'Selecione um produto pra adicionar.');
        return redirect(res, `/vendas/${m.id}`);
      }
      const peca = db.prepare('SELECT * FROM pecas WHERE id = ?').get(body.produto_id);
      const quantidade = toIntOrNull(body.quantidade) || 1;
      if (!peca) {
        setFlash(session.sessionId, 'error', 'Produto não encontrado no estoque.');
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
          ? `Produto "${peca.nome}" adicionado à venda. Atenção: o estoque desse produto ficou zerado ou negativo (${novaQuantidade}).`
          : `Produto "${peca.nome}" adicionado à venda.`
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
          setFlash(session.sessionId, 'success', 'Item removido da venda. O veículo cadastrado permanece no cadastro do cliente (módulo Veículos).');
          return redirect(res, `/vendas/${m.id}`);
        }
        if (item.tipo_servico_id) {
          setFlash(session.sessionId, 'success', 'Serviço removido da venda.');
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
      const senha = (body.password || '').trim();
      const nivelId = toIntOrNull(body.nivel_id);
      const nivelValido = nivelId && niveis.some((n) => n.id === nivelId);
      const lojaId = toIntOrNull(body.loja_id);
      const podeVerOutrasLojas = body.pode_ver_outras_lojas ? 1 : 0;
      if (!nome || !emailNovo || !senha || !nivelValido) {
        return send(res, 400, usuarioFormPage({ user, flash: { type: 'error', message: 'Nome, e-mail, senha e nível de acesso são obrigatórios.' }, usuario: { ...body, name: nome, email: emailNovo }, csrfToken: session.csrfToken, lojas, niveis }));
      }
      const existente = db.prepare('SELECT id FROM users WHERE email = ?').get(emailNovo);
      if (existente) {
        return send(res, 400, usuarioFormPage({ user, flash: { type: 'error', message: 'Já existe um usuário com esse e-mail.' }, usuario: { ...body, name: nome, email: emailNovo }, csrfToken: session.csrfToken, lojas, niveis }));
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(senha, salt);
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
      const senhaNova = (body.password || '').trim();
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
      if (senhaNova) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = hashPassword(senhaNova, salt);
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

    // ---------------- CONFIGURAÇÕES FISCAIS (NF-e) ----------------
    if (pathname === '/configuracoes/fiscal' && method === 'GET') {
      if (!hasManagementAccess(user)) return forbidden(res);
      return send(res, 200, configFiscalPage({
        user,
        flash: takeFlash(session.sessionId),
        config: getConfigFiscal(),
        csrfToken: session.csrfToken,
      }));
    }

    if (pathname === '/configuracoes/fiscal' && method === 'POST') {
      if (!hasManagementAccess(user)) return forbidden(res);
      const atual = getConfigFiscal();
      const ambiente = body.ambiente === 'producao' ? 'producao' : 'homologacao';
      // Tokens: só sobrescreve se o campo veio preenchido (senão mantém o atual).
      const tokenHomo = (body.token_homologacao || '').trim() || atual.focus_token_homologacao || null;
      const tokenProd = (body.token_producao || '').trim() || atual.focus_token_producao || null;
      const regime = [1, 2, 3].includes(Number(body.regime_tributario)) ? Number(body.regime_tributario) : 1;
      const origem = [0, 1, 2, 3, 8].includes(Number(body.origem_padrao)) ? Number(body.origem_padrao) : 0;
      db.prepare(
        `UPDATE config_fiscal SET
           focus_token_homologacao = ?,
           focus_token_producao = ?,
           ambiente = ?,
           regime_tributario = ?,
           natureza_operacao = ?,
           serie_nfe = ?,
           ncm_padrao = ?,
           cfop_padrao = ?,
           cfop_interestadual_padrao = ?,
           csosn_padrao = ?,
           origem_padrao = ?,
           unidade_padrao = ?,
           atualizado_em = datetime('now')
         WHERE id = 1`
      ).run(
        tokenHomo,
        tokenProd,
        ambiente,
        regime,
        (body.natureza_operacao || 'Venda de mercadoria').trim(),
        (body.serie_nfe || '').trim() || null,
        (body.ncm_padrao || '').trim() || null,
        (body.cfop_padrao || '').trim() || null,
        (body.cfop_interestadual_padrao || '').trim() || null,
        (body.csosn_padrao || '').trim() || null,
        origem,
        (body.unidade_padrao || 'UN').trim() || 'UN'
      );
      setFlash(
        session.sessionId,
        ambiente === 'producao' ? 'error' : 'success',
        ambiente === 'producao'
          ? 'Configurações salvas. ATENÇÃO: ambiente de PRODUÇÃO ativo — as próximas notas terão valor jurídico.'
          : 'Configurações fiscais salvas (ambiente de homologação/teste).'
      );
      return redirect(res, '/configuracoes/fiscal');
    }

    // ---------------- NF-e a partir da VENDA ----------------
    if ((m = matchRoute('/vendas/:id/nfe/emitir', pathname)) && method === 'POST') {
      const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(m.id);
      if (!venda) return notFound(res);
      if (!canEditLoja(user, venda.loja_id)) return forbidden(res);
      if (venda.nfe_status === 'autorizado') {
        setFlash(session.sessionId, 'error', 'Esta venda já tem NF-e autorizada. Para refazer, cancele a nota antes.');
        return redirect(res, `/vendas/${m.id}`);
      }
      const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(venda.cliente_id);
      const itens = db.prepare('SELECT * FROM venda_itens WHERE venda_id = ?').all(m.id);
      const config = getConfigFiscal();
      const { nfe, erros, creds } = buildNfePayload(venda, itens, cliente, config);
      if (erros.length) {
        setFlash(session.sessionId, 'error', 'Não dá pra emitir ainda: ' + erros.join(' '));
        return redirect(res, `/vendas/${m.id}`);
      }
      const ref = `gm-venda-${venda.id}-${Date.now()}`;
      try {
        const resp = await focus.emitirNfe(creds, ref, nfe);
        db.prepare("UPDATE vendas SET nfe_ref = ?, nfe_ambiente = ?, nfe_emitida_em = datetime('now') WHERE id = ?").run(ref, creds.ambiente, m.id);
        if (resp.status === 201 || resp.status === 202) {
          applyNfeResponse(m.id, creds.ambiente, resp.data || { status: resp.status === 201 ? 'autorizado' : 'processando_autorizacao' });
          setFlash(session.sessionId, 'success', resp.status === 201
            ? 'NF-e autorizada!'
            : 'NF-e enviada e em processamento na SEFAZ. Use "Consultar status" em alguns segundos.');
        } else {
          applyNfeResponse(m.id, creds.ambiente, resp.data || {});
          const detalhe = resp.data && (resp.data.mensagem || (Array.isArray(resp.data.erros) ? resp.data.erros.map((e) => e.mensagem || JSON.stringify(e)).join(' | ') : '')) || `HTTP ${resp.status}`;
          db.prepare('UPDATE vendas SET nfe_status = ? WHERE id = ? AND (nfe_status IS NULL OR nfe_status = ?)').run('erro', m.id, null);
          setFlash(session.sessionId, 'error', 'A Focus recusou a emissão: ' + detalhe);
        }
      } catch (err) {
        console.error('[nfe] Falha ao emitir NF-e:', err);
        db.prepare("UPDATE vendas SET nfe_status = 'erro', nfe_mensagem = ? WHERE id = ?").run(err && err.message ? err.message : 'erro desconhecido', m.id);
        setFlash(session.sessionId, 'error', 'Falha ao falar com a Focus: ' + (err && err.message ? err.message : 'erro desconhecido.'));
      }
      return redirect(res, `/vendas/${m.id}`);
    }

    if ((m = matchRoute('/vendas/:id/nfe/consultar', pathname)) && method === 'POST') {
      const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(m.id);
      if (!venda) return notFound(res);
      if (!canSeeLoja(user, venda.loja_id)) return forbidden(res);
      if (!venda.nfe_ref) {
        setFlash(session.sessionId, 'error', 'Esta venda ainda não teve NF-e enviada.');
        return redirect(res, `/vendas/${m.id}`);
      }
      const config = getConfigFiscal();
      const creds = { ambiente: venda.nfe_ambiente || focusCreds(config).ambiente, token: null };
      creds.token = creds.ambiente === 'producao' ? config.focus_token_producao : config.focus_token_homologacao;
      try {
        const resp = await focus.consultarNfe(creds, venda.nfe_ref, true);
        if (resp.data) {
          applyNfeResponse(m.id, creds.ambiente, resp.data);
          setFlash(session.sessionId, 'success', `Status atualizado: ${resp.data.status || 'desconhecido'}.`);
        } else {
          setFlash(session.sessionId, 'error', `Não foi possível consultar (HTTP ${resp.status}).`);
        }
      } catch (err) {
        console.error('[nfe] Falha ao consultar NF-e:', err);
        setFlash(session.sessionId, 'error', 'Falha ao consultar: ' + (err && err.message ? err.message : 'erro desconhecido.'));
      }
      return redirect(res, `/vendas/${m.id}`);
    }

    if ((m = matchRoute('/vendas/:id/nfe/cancelar', pathname)) && method === 'POST') {
      const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(m.id);
      if (!venda) return notFound(res);
      if (!canEditLoja(user, venda.loja_id)) return forbidden(res);
      if (venda.nfe_status !== 'autorizado') {
        setFlash(session.sessionId, 'error', 'Só é possível cancelar uma NF-e que esteja autorizada.');
        return redirect(res, `/vendas/${m.id}`);
      }
      const justificativa = (body.justificativa || '').trim();
      if (justificativa.length < 15) {
        setFlash(session.sessionId, 'error', 'A justificativa do cancelamento precisa ter pelo menos 15 caracteres.');
        return redirect(res, `/vendas/${m.id}`);
      }
      const config = getConfigFiscal();
      const creds = { ambiente: venda.nfe_ambiente || focusCreds(config).ambiente, token: null };
      creds.token = creds.ambiente === 'producao' ? config.focus_token_producao : config.focus_token_homologacao;
      try {
        const resp = await focus.cancelarNfe(creds, venda.nfe_ref, justificativa);
        if (resp.status === 200 && resp.data) {
          applyNfeResponse(m.id, creds.ambiente, resp.data);
          setFlash(session.sessionId, 'success', 'NF-e cancelada.');
        } else {
          const detalhe = resp.data && (resp.data.mensagem || resp.data.mensagem_sefaz) || `HTTP ${resp.status}`;
          setFlash(session.sessionId, 'error', 'Não foi possível cancelar: ' + detalhe);
        }
      } catch (err) {
        console.error('[nfe] Falha ao cancelar NF-e:', err);
        setFlash(session.sessionId, 'error', 'Falha ao cancelar: ' + (err && err.message ? err.message : 'erro desconhecido.'));
      }
      return redirect(res, `/vendas/${m.id}`);
    }

    if ((m = matchRoute('/vendas/:id/nfe/danfe', pathname)) && method === 'GET') {
      return await servirArquivoNfe(res, m.id, 'danfe', user);
    }
    if ((m = matchRoute('/vendas/:id/nfe/xml', pathname)) && method === 'GET') {
      return await servirArquivoNfe(res, m.id, 'xml', user);
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
