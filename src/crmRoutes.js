'use strict';

// CRM comercial: funil (kanban), leads, follow-ups, propostas, respostas
// rápidas, distribuição de leads (rodízio), metas e origem dos leads.
// Mesmo padrão da Locação Pro: o handler principal chama handleCrm() e,
// se a rota for daqui, ela responde e devolve true.

const { db } = require('./db');
const V = require('./views/crm');

// ----------------------------------------------------------------- helpers
const txt = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
const num = (v) => {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  let t = String(v).trim();
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const int = (v) => {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
};
const soDigitos = (v) => String(v || '').replace(/\D/g, '');
// Normaliza telefone BR para comparar duplicados: só dígitos, sem 55 na frente.
function telNorm(v) {
  let d = soDigitos(v);
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  return d || null;
}
// Horário de Brasília (o banco grava UTC).
const agoraLocal = () => new Date(Date.now() - 3 * 3600 * 1000);
const hojeLocal = () => agoraLocal().toISOString().slice(0, 10);
const mesLocal = () => agoraLocal().toISOString().slice(0, 7);
const LOCAL = (col) => `datetime(${col}, '-3 hours')`;

const ORIGENS = ['Meta Ads', 'Google Ads', 'TikTok', 'Instagram', 'Facebook', 'WhatsApp', 'Site', 'Indicação', 'Loja física', 'Feira / evento', 'Outro'];
const CANAIS = ['WhatsApp', 'Instagram', 'Facebook', 'Site', 'Telefone', 'Indicação', 'Loja física', 'Outro'];
const MOTIVOS_FOLLOWUP = ['Retorno de proposta', 'Cliente pediu para chamar depois', 'Negociação', 'Financiamento / crediário', 'Test ride / visita', 'Pós-atendimento', 'Outro'];
const FORMAS_PGTO = ['PIX', 'Dinheiro', 'Cartão', 'Crediário próprio', 'Locação com compra garantida', 'Outra'];
const STATUS_PROPOSTA = { rascunho: 'Rascunho', enviada: 'Enviada', negociacao: 'Em negociação', aceita: 'Aceita', recusada: 'Recusada', expirada: 'Expirada' };
const CATEGORIAS_RESPOSTA = ['Apresentação', 'Preço', 'Parcelamento', 'Locação', 'Disponibilidade', 'Localização', 'Test ride', 'Follow-up', 'Pós-venda', 'Personalizado'];
const MOTIVOS_PERDA = ['Preço', 'Comprou em outro lugar', 'Sem crédito / reprovado', 'Desistiu', 'Sem resposta', 'Sem estoque do modelo', 'Outro'];
const TIPOS_INTERACAO = { observacao: 'Observação', ligacao: 'Ligação', mensagem: 'Mensagem', reuniao: 'Reunião / visita' };

function periodo(p) {
  const hoje = hojeLocal();
  const d = (n) => new Date(Date.parse(hoje + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
  const mes = hoje.slice(0, 7);
  switch (p) {
    case 'hoje': return [hoje, hoje];
    case '7d': return [d(6), hoje];
    case '30d': return [d(29), hoje];
    case 'mes_passado': {
      const [y, m] = mes.split('-').map(Number);
      const ini = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
      const fim = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
      return [ini, fim];
    }
    case 'tudo': return ['0000-01-01', '9999-12-31'];
    default: return [mes + '-01', hoje]; // 'mes'
  }
}

function getConfig(chave) {
  const r = db.prepare('SELECT valor FROM crm_config WHERE chave = ?').get(chave);
  return r ? r.valor : null;
}
function setConfig(chave, valor) {
  db.prepare('INSERT INTO crm_config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(chave, valor);
}

const etapas = () => db.prepare('SELECT * FROM crm_etapas WHERE ativo = 1 ORDER BY ordem, id').all();
const etapaInicial = () => db.prepare("SELECT * FROM crm_etapas WHERE ativo = 1 AND tipo = 'aberta' ORDER BY ordem, id LIMIT 1").get();
const vendedores = () => db.prepare('SELECT id, name FROM users WHERE ativo = 1 ORDER BY name').all();
const produtos = () => db.prepare('SELECT id, nome, preco_venda FROM pecas ORDER BY nome LIMIT 1000').all();

function registrar(negocioId, userId, tipo, texto, { contaComoContato = false } = {}) {
  const neg = negocioId ? db.prepare('SELECT lead_id FROM crm_negocios WHERE id = ?').get(negocioId) : null;
  db.prepare('INSERT INTO crm_atividades (negocio_id, lead_id, user_id, tipo, texto) VALUES (?, ?, ?, ?, ?)').run(negocioId, neg ? neg.lead_id : null, userId || null, tipo, texto || null);
  if (negocioId) {
    db.prepare("UPDATE crm_negocios SET ultima_acao_at = datetime('now') WHERE id = ?").run(negocioId);
    if (contaComoContato && userId) {
      db.prepare("UPDATE crm_negocios SET primeiro_contato_at = COALESCE(primeiro_contato_at, datetime('now')) WHERE id = ?").run(negocioId);
    }
  }
}

// Rodízio (round-robin) entre os vendedores ativos na distribuição.
function proximoResponsavel() {
  const fila = db
    .prepare('SELECT d.user_id FROM crm_distribuicao d JOIN users u ON u.id = d.user_id WHERE d.ativo = 1 AND u.ativo = 1 ORDER BY d.ordem, d.user_id')
    .all()
    .map((r) => r.user_id);
  if (!fila.length) return null;
  const ultimo = Number(getConfig('rr_ultimo_user_id'));
  const idx = fila.indexOf(ultimo);
  const prox = fila[(idx + 1) % fila.length];
  setConfig('rr_ultimo_user_id', String(prox));
  return prox;
}

// Cria (ou reaproveita, pelo telefone) o lead e abre um negócio no funil.
// Se o lead já tem negócio em aberto, só registra que ele voltou a chamar.
function entradaDeLead(d, userId) {
  const tn = telNorm(d.telefone);
  let lead = tn ? db.prepare('SELECT * FROM crm_leads WHERE telefone_norm = ? ORDER BY id LIMIT 1').get(tn) : null;
  if (!lead) {
    const info = db
      .prepare('INSERT INTO crm_leads (nome, telefone, telefone_norm, email, observacoes) VALUES (?, ?, ?, ?, ?)')
      .run(d.nome || 'Sem nome', txt(d.telefone), tn, txt(d.email), txt(d.observacoes));
    lead = db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(info.lastInsertRowid);
  }
  const aberto = db.prepare("SELECT id FROM crm_negocios WHERE lead_id = ? AND status = 'aberto' ORDER BY id DESC LIMIT 1").get(lead.id);
  if (aberto && !d.forcarNovo) {
    registrar(aberto.id, null, 'sistema', `Lead voltou a entrar em contato${d.origem ? ' (' + d.origem + ')' : ''}${d.mensagem ? ': ' + d.mensagem : ''}`);
    return { leadId: lead.id, negocioId: aberto.id, duplicado: true };
  }
  const etapaId = int(d.etapa_id) || (etapaInicial() || {}).id || null;
  const resp = int(d.responsavel_id) || proximoResponsavel() || userId || null;
  const info = db
    .prepare(
      `INSERT INTO crm_negocios (lead_id, titulo, valor, etapa_id, responsavel_id, produto_id, produto_texto, origem, origem_detalhe, canal, campanha, observacoes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(lead.id, d.titulo || lead.nome, num(d.valor) || 0, etapaId, resp, int(d.produto_id), txt(d.produto_texto), txt(d.origem), txt(d.origem_detalhe), txt(d.canal), txt(d.campanha), txt(d.observacoes));
  const negocioId = info.lastInsertRowid;
  const et = etapaId ? db.prepare('SELECT nome FROM crm_etapas WHERE id = ?').get(etapaId) : null;
  registrar(negocioId, userId, 'sistema', `Negócio criado em "${et ? et.nome : '—'}"${d.origem ? ' · origem: ' + d.origem : ''}`);
  if (d.mensagem) registrar(negocioId, null, 'mensagem', 'Mensagem do lead: ' + d.mensagem);
  if (txt(d.proximo_followup)) {
    db.prepare('INSERT INTO crm_followups (negocio_id, responsavel_id, data_hora, motivo) VALUES (?, ?, ?, ?)').run(negocioId, resp, d.proximo_followup, 'Primeiro contato');
  }
  return { leadId: lead.id, negocioId, duplicado: false };
}

function negocioCompleto(id) {
  return db
    .prepare(
      `SELECT n.*, l.nome AS lead_nome, l.telefone, l.email, l.cliente_id, e.nome AS etapa_nome, e.cor AS etapa_cor, e.tipo AS etapa_tipo,
         u.name AS responsavel_nome, p.nome AS produto_nome
       FROM crm_negocios n JOIN crm_leads l ON l.id = n.lead_id
       LEFT JOIN crm_etapas e ON e.id = n.etapa_id
       LEFT JOIN users u ON u.id = n.responsavel_id
       LEFT JOIN pecas p ON p.id = n.produto_id
       WHERE n.id = ?`
    )
    .get(id);
}

// Muda etapa e mantém status coerente com o tipo da etapa.
function moverEtapa(negocioId, etapaId, userId) {
  const neg = db.prepare('SELECT * FROM crm_negocios WHERE id = ?').get(negocioId);
  const et = db.prepare('SELECT * FROM crm_etapas WHERE id = ?').get(etapaId);
  if (!neg || !et) throw new Error('Negócio ou etapa não encontrado.');
  if (neg.etapa_id === et.id) return;
  const status = et.tipo === 'ganho' ? 'ganho' : et.tipo === 'aberta' ? 'aberto' : 'perdido';
  db.prepare(
    `UPDATE crm_negocios SET etapa_id = ?, status = ?, fechado_at = CASE WHEN ? = 'aberto' THEN NULL ELSE COALESCE(fechado_at, datetime('now')) END WHERE id = ?`
  ).run(et.id, status, status, negocioId);
  const de = neg.etapa_id ? db.prepare('SELECT nome FROM crm_etapas WHERE id = ?').get(neg.etapa_id) : null;
  registrar(negocioId, userId, 'etapa', `Etapa: ${de ? de.nome : '—'} → ${et.nome}`, { contaComoContato: true });
}

function aplicarVariaveis(msg, ctx) {
  const primeiro = String(ctx.nome || '').trim().split(/\s+/)[0] || '';
  return String(msg || '')
    .replace(/\{\{?\s*(cliente|nome)\s*\}?\}/gi, primeiro)
    .replace(/\{\{?\s*nome_completo\s*\}?\}/gi, ctx.nome || '')
    .replace(/\{\{?\s*vendedor\s*\}?\}/gi, ctx.vendedor || '')
    .replace(/\{\{?\s*produto\s*\}?\}/gi, ctx.produto || '');
}

function waLink(telefone, texto) {
  let d = soDigitos(telefone);
  if (!d) return null;
  if (d.length <= 11) d = '55' + d;
  return `https://wa.me/${d}${texto ? '?text=' + encodeURIComponent(texto) : ''}`;
}

// ------------------------------------------------- webhook (entrada de leads)
// POST /api/crm/lead?token=XXX  (JSON ou form) — Zapier, Make, formulário do site,
// Meta Lead Ads via integrador etc. Campos: nome, telefone, email, origem, canal,
// campanha, produto, mensagem.
async function handleCrmWebhook(req, res, url, send) {
  const json = (st, o) => send(res, st, JSON.stringify(o), { 'Content-Type': 'application/json; charset=utf-8' });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Use POST' });
  const token = url.searchParams.get('token') || req.headers['x-crm-token'];
  if (!token || token !== getConfig('webhook_token')) return json(401, { ok: false, error: 'Token inválido' });
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > 200000) return json(413, { ok: false, error: 'Corpo muito grande' });
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  let d = {};
  try {
    if ((req.headers['content-type'] || '').includes('json')) d = JSON.parse(raw || '{}');
    else d = Object.fromEntries(new URLSearchParams(raw));
  } catch (e) {
    return json(400, { ok: false, error: 'JSON inválido' });
  }
  if (!txt(d.nome) && !txt(d.telefone)) return json(400, { ok: false, error: 'Informe nome ou telefone' });
  const r = entradaDeLead(
    {
      nome: txt(d.nome) || txt(d.telefone),
      telefone: d.telefone || d.whatsapp,
      email: d.email,
      origem: d.origem || 'Site',
      canal: d.canal,
      campanha: d.campanha,
      produto_texto: d.produto,
      mensagem: d.mensagem,
    },
    null
  );
  return json(200, { ok: true, ...r });
}

// ---------------------------------------------------------------- rotas
async function handleCrm(ctx) {
  const { req, res, url, pathname, method, body, user, session, h } = ctx;
  if (pathname !== '/crm' && !pathname.startsWith('/crm/')) return false;
  const { send, redirect, setFlash, takeFlash, hasManagementAccess, forbidden, notFound, matchRoute, enviarCsv } = h;
  const base = { user, csrfToken: session.csrfToken };
  const flash = () => takeFlash(session.sessionId);
  const ok = (msg) => setFlash(session.sessionId, 'success', msg);
  const erro = (msg) => setFlash(session.sessionId, 'error', msg);
  const gestor = hasManagementAccess(user);
  const q = (k) => url.searchParams.get(k) || '';
  const json = (st, o) => send(res, st, JSON.stringify(o), { 'Content-Type': 'application/json; charset=utf-8' });
  let m;

  // ---------------------------------------------------------- Meu dia
  if (pathname === '/crm' && method === 'GET') {
    const hoje = hojeLocal();
    const mes = mesLocal();
    const [ini, fim] = periodo('mes');
    const filtroResp = gestor ? '' : ' AND n.responsavel_id = ' + Number(user.id);
    const k = {
      leadsHoje: db.prepare(`SELECT COUNT(*) c FROM crm_negocios n WHERE date(${LOCAL('n.created_at')}) = ?${filtroResp}`).get(hoje).c,
      semResposta: db.prepare(`SELECT COUNT(*) c FROM crm_negocios n WHERE n.status='aberto' AND n.primeiro_contato_at IS NULL${filtroResp}`).get().c,
      fuAtrasados: db.prepare(`SELECT COUNT(*) c FROM crm_followups f JOIN crm_negocios n ON n.id=f.negocio_id WHERE f.concluido=0 AND substr(f.data_hora,1,10) < ?${filtroResp}`).get(hoje).c,
      fuHoje: db.prepare(`SELECT COUNT(*) c FROM crm_followups f JOIN crm_negocios n ON n.id=f.negocio_id WHERE f.concluido=0 AND substr(f.data_hora,1,10) = ?${filtroResp}`).get(hoje).c,
      esfriando: db.prepare(`SELECT COUNT(*) c FROM crm_negocios n WHERE n.status='aberto' AND n.ultima_acao_at < datetime('now','-7 days')${filtroResp}`).get().c,
    };
    const vendasMes = db
      .prepare(`SELECT COUNT(*) c, COALESCE(SUM(valor),0) v FROM crm_negocios n WHERE n.status='ganho' AND date(${LOCAL('n.fechado_at')}) BETWEEN ? AND ?${filtroResp}`)
      .get(ini, fim);
    const meta = db.prepare('SELECT * FROM crm_metas WHERE mes = ? AND user_id = ?').get(mes, gestor ? 0 : user.id) || null;
    const fila = db
      .prepare(
        `SELECT n.id, l.nome, l.telefone, n.created_at, n.origem, e.nome etapa, u.name resp,
           (SELECT MIN(f.data_hora) FROM crm_followups f WHERE f.negocio_id=n.id AND f.concluido=0) fu
         FROM crm_negocios n JOIN crm_leads l ON l.id=n.lead_id LEFT JOIN crm_etapas e ON e.id=n.etapa_id LEFT JOIN users u ON u.id=n.responsavel_id
         WHERE n.status='aberto' AND (n.primeiro_contato_at IS NULL OR EXISTS (SELECT 1 FROM crm_followups f WHERE f.negocio_id=n.id AND f.concluido=0 AND substr(f.data_hora,1,10) <= ?))${filtroResp}
         ORDER BY CASE WHEN n.primeiro_contato_at IS NULL THEN 0 ELSE 1 END, COALESCE(fu, n.created_at) LIMIT 40`
      )
      .all(hoje);
    const ranking = db
      .prepare(
        `SELECT u.name, COUNT(n.id) recebeu, SUM(CASE WHEN n.primeiro_contato_at IS NOT NULL THEN 1 ELSE 0 END) atendeu,
           SUM(CASE WHEN n.primeiro_contato_at IS NULL AND n.status='aberto' THEN 1 ELSE 0 END) sem_resposta,
           SUM(CASE WHEN n.status='ganho' THEN 1 ELSE 0 END) vendas
         FROM crm_negocios n JOIN users u ON u.id = n.responsavel_id
         WHERE date(${LOCAL('n.created_at')}) BETWEEN ? AND ? GROUP BY u.id ORDER BY recebeu DESC`
      )
      .all(ini, fim);
    return send(res, 200, V.meuDiaPage({ ...base, flash: flash(), k, vendasMes, meta, fila, ranking, gestor })), true;
  }

  // ---------------------------------------------------------- Funil (kanban)
  if (pathname === '/crm/funil' && method === 'GET') {
    const per = q('periodo') || 'tudo';
    const [ini, fim] = periodo(per);
    const where = [`date(${LOCAL('n.created_at')}) BETWEEN ? AND ?`];
    const params = [ini, fim];
    if (!gestor) { where.push('n.responsavel_id = ?'); params.push(user.id); }
    else if (q('resp')) { where.push('n.responsavel_id = ?'); params.push(Number(q('resp'))); }
    if (q('origem')) { where.push('n.origem = ?'); params.push(q('origem')); }
    if (q('q')) {
      where.push('(l.nome LIKE ? OR l.telefone_norm LIKE ? OR l.email LIKE ? OR n.produto_texto LIKE ? OR p.nome LIKE ?)');
      const t = '%' + q('q') + '%';
      params.push(t, '%' + (telNorm(q('q')) || q('q')) + '%', t, t, t);
    }
    const cards = db
      .prepare(
        `SELECT n.id, n.etapa_id, n.valor, n.status, n.origem, n.canal, n.created_at, n.ultima_acao_at, n.primeiro_contato_at,
           l.nome, l.telefone, COALESCE(p.nome, n.produto_texto) produto, u.name resp,
           (SELECT MIN(f.data_hora) FROM crm_followups f WHERE f.negocio_id = n.id AND f.concluido = 0) fu
         FROM crm_negocios n JOIN crm_leads l ON l.id = n.lead_id
         LEFT JOIN pecas p ON p.id = n.produto_id LEFT JOIN users u ON u.id = n.responsavel_id
         WHERE ${where.join(' AND ')} ORDER BY n.ultima_acao_at DESC LIMIT 3000`
      )
      .all(...params);
    const total = cards.length;
    const ganhos = cards.filter((c) => c.status === 'ganho').length;
    const k = {
      abertos: cards.filter((c) => c.status === 'aberto').length,
      pipeline: cards.filter((c) => c.status === 'aberto').reduce((s, c) => s + (c.valor || 0), 0),
      conversao: total ? (ganhos / total) * 100 : 0,
      ganhos,
      perdidos: cards.filter((c) => c.status === 'perdido').length,
      fuAtrasados: cards.filter((c) => c.status === 'aberto' && c.fu && c.fu.slice(0, 10) < hojeLocal()).length,
      esfriando: cards.filter((c) => c.status === 'aberto' && Date.parse(c.ultima_acao_at + 'Z') < Date.now() - 7 * 86400000).length,
    };
    return send(res, 200, V.funilPage({ ...base, flash: flash(), etapas: etapas(), cards, k, filtros: { periodo: per, resp: q('resp'), origem: q('origem'), q: q('q') }, vendedores: vendedores(), origens: ORIGENS, gestor })), true;
  }

  // mover card (drag & drop) — responde JSON
  if ((m = matchRoute('/crm/negocios/:id/etapa', pathname)) && method === 'POST') {
    try {
      moverEtapa(Number(m.id), Number(body.etapa_id), user.id);
      return json(200, { ok: true }), true;
    } catch (e) {
      return json(400, { ok: false, error: e.message }), true;
    }
  }

  // ---------------------------------------------------------- Negócio: novo
  if (pathname === '/crm/negocios/novo' && method === 'GET') {
    return send(res, 200, V.negocioFormPage({ ...base, flash: flash(), neg: { etapa_id: Number(q('etapa')) || null, responsavel_id: user.id }, etapas: etapas(), vendedores: vendedores(), produtos: produtos(), origens: ORIGENS, canais: CANAIS })), true;
  }
  if (pathname === '/crm/negocios/novo' && method === 'POST') {
    if (!txt(body.nome)) {
      return send(res, 400, V.negocioFormPage({ ...base, flash: { type: 'error', message: 'Nome do lead é obrigatório.' }, neg: body, etapas: etapas(), vendedores: vendedores(), produtos: produtos(), origens: ORIGENS, canais: CANAIS })), true;
    }
    const r = entradaDeLead({ ...body, titulo: txt(body.titulo) || txt(body.nome) }, user.id);
    if (r.duplicado) ok('Esse telefone já tem um negócio em aberto — abri o existente.');
    else ok('Negócio criado.');
    return redirect(res, '/crm/negocios/' + r.negocioId), true;
  }

  // ---------------------------------------------------------- Negócio: detalhe
  if ((m = matchRoute('/crm/negocios/:id', pathname)) && method === 'GET') {
    const neg = negocioCompleto(Number(m.id));
    if (!neg) return notFound(res), true;
    if (!gestor && neg.responsavel_id && neg.responsavel_id !== user.id) return forbidden(res), true;
    const atividades = db.prepare('SELECT a.*, u.name user_nome FROM crm_atividades a LEFT JOIN users u ON u.id=a.user_id WHERE a.negocio_id = ? ORDER BY a.id DESC').all(neg.id);
    const followups = db.prepare('SELECT f.*, u.name resp FROM crm_followups f LEFT JOIN users u ON u.id=f.responsavel_id WHERE f.negocio_id = ? ORDER BY f.concluido, f.data_hora').all(neg.id);
    const propostas = db.prepare('SELECT * FROM crm_propostas WHERE negocio_id = ? ORDER BY id DESC').all(neg.id);
    const outros = db.prepare('SELECT n.id, n.status, n.created_at, e.nome etapa FROM crm_negocios n LEFT JOIN crm_etapas e ON e.id=n.etapa_id WHERE n.lead_id = ? AND n.id != ? ORDER BY n.id DESC').all(neg.lead_id, neg.id);
    const respostas = db.prepare('SELECT * FROM crm_respostas ORDER BY categoria, titulo').all();
    return send(res, 200, V.negocioShowPage({ ...base, flash: flash(), neg, atividades, followups, propostas, outros, respostas, etapas: etapas(), vendedores: vendedores(), tipos: TIPOS_INTERACAO, motivosFollowup: MOTIVOS_FOLLOWUP, motivosPerda: MOTIVOS_PERDA, wa: waLink(neg.telefone), hoje: hojeLocal() })), true;
  }

  if ((m = matchRoute('/crm/negocios/:id/editar', pathname))) {
    const neg = negocioCompleto(Number(m.id));
    if (!neg) return notFound(res), true;
    if (method === 'GET') {
      return send(res, 200, V.negocioFormPage({ ...base, flash: flash(), neg: { ...neg, nome: neg.lead_nome }, etapas: etapas(), vendedores: vendedores(), produtos: produtos(), origens: ORIGENS, canais: CANAIS, editando: true })), true;
    }
    if (method === 'POST') {
      db.prepare('UPDATE crm_leads SET nome = ?, telefone = ?, telefone_norm = ?, email = ? WHERE id = ?').run(txt(body.nome) || neg.lead_nome, txt(body.telefone), telNorm(body.telefone), txt(body.email), neg.lead_id);
      db.prepare(
        `UPDATE crm_negocios SET titulo=?, valor=?, responsavel_id=?, produto_id=?, produto_texto=?, origem=?, origem_detalhe=?, canal=?, campanha=?, observacoes=? WHERE id=?`
      ).run(txt(body.titulo) || txt(body.nome) || neg.titulo, num(body.valor) || 0, int(body.responsavel_id), int(body.produto_id), txt(body.produto_texto), txt(body.origem), txt(body.origem_detalhe), txt(body.canal), txt(body.campanha), txt(body.observacoes), neg.id);
      if (int(body.etapa_id) && int(body.etapa_id) !== neg.etapa_id) moverEtapa(neg.id, int(body.etapa_id), user.id);
      if (int(body.responsavel_id) !== neg.responsavel_id) registrar(neg.id, user.id, 'sistema', 'Responsável alterado');
      ok('Negócio atualizado.');
      return redirect(res, '/crm/negocios/' + neg.id), true;
    }
  }

  if ((m = matchRoute('/crm/negocios/:id/:acao', pathname)) && method === 'POST') {
    const neg = negocioCompleto(Number(m.id));
    if (!neg) return notFound(res), true;
    const voltar = () => redirect(res, '/crm/negocios/' + neg.id);
    switch (m.acao) {
      case 'atividade': {
        const tipo = TIPOS_INTERACAO[body.tipo] ? body.tipo : 'observacao';
        if (!txt(body.texto)) { erro('Escreva o que aconteceu.'); return voltar(), true; }
        registrar(neg.id, user.id, tipo, txt(body.texto), { contaComoContato: tipo !== 'observacao' });
        if (txt(body.etapa_id) && int(body.etapa_id) !== neg.etapa_id) moverEtapa(neg.id, int(body.etapa_id), user.id);
        ok('Interação registrada.');
        return voltar(), true;
      }
      case 'etapa-form': {
        moverEtapa(neg.id, int(body.etapa_id), user.id);
        ok('Etapa atualizada.');
        return voltar(), true;
      }
      case 'followup': {
        const data = txt(body.data);
        if (!data) { erro('Informe a data do follow-up.'); return voltar(), true; }
        const dh = data + 'T' + (txt(body.hora) || '09:00');
        db.prepare('INSERT INTO crm_followups (negocio_id, responsavel_id, data_hora, motivo, observacao) VALUES (?, ?, ?, ?, ?)').run(neg.id, int(body.responsavel_id) || neg.responsavel_id || user.id, dh, txt(body.motivo), txt(body.observacao));
        registrar(neg.id, user.id, 'followup', `Follow-up agendado para ${dh.replace('T', ' ')}${body.motivo ? ' · ' + body.motivo : ''}`);
        ok('Follow-up agendado.');
        return voltar(), true;
      }
      case 'ganho': {
        const etG = db.prepare("SELECT id FROM crm_etapas WHERE tipo='ganho' AND ativo=1 ORDER BY ordem LIMIT 1").get();
        if (num(body.valor) !== null) db.prepare('UPDATE crm_negocios SET valor = ? WHERE id = ?').run(num(body.valor), neg.id);
        if (etG) moverEtapa(neg.id, etG.id, user.id);
        else db.prepare("UPDATE crm_negocios SET status='ganho', fechado_at=datetime('now') WHERE id=?").run(neg.id);
        db.prepare('UPDATE crm_followups SET concluido=1, concluido_at=datetime(\'now\') WHERE negocio_id=? AND concluido=0').run(neg.id);
        registrar(neg.id, user.id, 'venda', 'Venda fechada' + (num(body.valor) ? ' · R$ ' + num(body.valor).toFixed(2) : ''));
        ok('Venda marcada como ganha. Lance a venda no Balcão para baixar o estoque e emitir nota.');
        return voltar(), true;
      }
      case 'perdido': {
        const etP = db.prepare("SELECT id FROM crm_etapas WHERE tipo='perdido' AND ativo=1 ORDER BY ordem LIMIT 1").get();
        db.prepare('UPDATE crm_negocios SET motivo_perda = ? WHERE id = ?').run(txt(body.motivo_perda), neg.id);
        if (etP) moverEtapa(neg.id, etP.id, user.id);
        else db.prepare("UPDATE crm_negocios SET status='perdido', fechado_at=datetime('now') WHERE id=?").run(neg.id);
        db.prepare('UPDATE crm_followups SET concluido=1, concluido_at=datetime(\'now\') WHERE negocio_id=? AND concluido=0').run(neg.id);
        registrar(neg.id, user.id, 'sistema', 'Marcado como perdido' + (body.motivo_perda ? ': ' + body.motivo_perda : ''));
        ok('Negócio marcado como perdido.');
        return voltar(), true;
      }
      case 'reabrir': {
        const et = etapaInicial();
        if (et) moverEtapa(neg.id, et.id, user.id);
        db.prepare("UPDATE crm_negocios SET motivo_perda=NULL WHERE id=?").run(neg.id);
        ok('Negócio reaberto.');
        return voltar(), true;
      }
      case 'whatsapp': {
        // Abre o WhatsApp com a resposta rápida já preenchida e registra no histórico.
        const r = int(body.resposta_id) ? db.prepare('SELECT * FROM crm_respostas WHERE id = ?').get(int(body.resposta_id)) : null;
        const texto = r ? aplicarVariaveis(r.mensagem, { nome: neg.lead_nome, vendedor: user.name, produto: neg.produto_nome || neg.produto_texto }) : txt(body.texto) || '';
        const link = waLink(neg.telefone, texto);
        if (!link) { erro('Lead sem telefone.'); return voltar(), true; }
        registrar(neg.id, user.id, 'mensagem', 'WhatsApp aberto' + (r ? ' com resposta rápida "' + r.titulo + '"' : '') + (texto ? ': ' + texto.slice(0, 300) : ''), { contaComoContato: true });
        return redirect(res, link), true;
      }
      case 'cliente': {
        // Converte o lead em cliente do sistema (para vender no Balcão / locação).
        if (neg.cliente_id) return redirect(res, '/clientes/' + neg.cliente_id), true;
        const tn = telNorm(neg.telefone);
        let cli = tn ? db.prepare("SELECT id FROM clientes WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(telefone,''),' ',''),'-',''),'(',''),')',''),'+','') LIKE ?").get('%' + tn) : null;
        if (!cli) {
          const info = db.prepare('INSERT INTO clientes (nome, telefone, email, observacoes) VALUES (?, ?, ?, ?)').run(neg.lead_nome, neg.telefone, neg.email, 'Criado a partir do CRM (negócio #' + neg.id + ')');
          cli = { id: info.lastInsertRowid };
        }
        db.prepare('UPDATE crm_leads SET cliente_id = ? WHERE id = ?').run(cli.id, neg.lead_id);
        registrar(neg.id, user.id, 'sistema', 'Lead vinculado ao cadastro de cliente #' + cli.id);
        ok('Cliente vinculado. Complete CPF/endereço no cadastro antes de vender.');
        return redirect(res, '/clientes/' + cli.id + '/editar'), true;
      }
      case 'excluir': {
        if (!gestor) return forbidden(res), true;
        db.prepare('DELETE FROM crm_negocios WHERE id = ?').run(neg.id);
        ok('Negócio excluído.');
        return redirect(res, '/crm/funil'), true;
      }
    }
  }

  // ---------------------------------------------------------- Leads (lista)
  if (pathname === '/crm/leads' && method === 'GET') {
    const per = q('periodo') || 'mes';
    const [ini, fim] = periodo(per);
    const where = [`date(${LOCAL('n.created_at')}) BETWEEN ? AND ?`];
    const params = [ini, fim];
    if (!gestor) { where.push('n.responsavel_id = ?'); params.push(user.id); }
    else if (q('resp')) { where.push('n.responsavel_id = ?'); params.push(Number(q('resp'))); }
    if (q('origem')) { where.push('n.origem = ?'); params.push(q('origem')); }
    if (q('sit') === 'sem_resposta') where.push("n.primeiro_contato_at IS NULL AND n.status='aberto'");
    if (q('sit') === 'ganho') where.push("n.status='ganho'");
    if (q('sit') === 'perdido') where.push("n.status='perdido'");
    if (q('q')) {
      where.push('(l.nome LIKE ? OR l.telefone_norm LIKE ? OR l.email LIKE ?)');
      params.push('%' + q('q') + '%', '%' + (telNorm(q('q')) || q('q')) + '%', '%' + q('q') + '%');
    }
    const rows = db
      .prepare(
        `SELECT n.id, l.nome, l.telefone, l.email, n.origem, n.canal, n.campanha, n.status, n.created_at, n.ultima_acao_at, n.primeiro_contato_at,
           e.nome etapa, e.cor etapa_cor, u.name resp, COALESCE(p.nome, n.produto_texto) produto
         FROM crm_negocios n JOIN crm_leads l ON l.id=n.lead_id LEFT JOIN crm_etapas e ON e.id=n.etapa_id
         LEFT JOIN users u ON u.id=n.responsavel_id LEFT JOIN pecas p ON p.id=n.produto_id
         WHERE ${where.join(' AND ')} ORDER BY n.created_at DESC LIMIT 2000`
      )
      .all(...params);
    if (q('csv') === '1') {
      enviarCsv(res, 'leads-crm.csv', ['Nome', 'Telefone', 'E-mail', 'Produto', 'Origem', 'Canal', 'Campanha', 'Etapa', 'Status', 'Responsável', 'Recebido em'],
        rows.map((r) => [r.nome, r.telefone, r.email, r.produto, r.origem, r.canal, r.campanha, r.etapa, r.status, r.resp, r.created_at]));
      return true;
    }
    return send(res, 200, V.leadsPage({ ...base, flash: flash(), rows, filtros: { periodo: per, resp: q('resp'), origem: q('origem'), sit: q('sit'), q: q('q') }, vendedores: vendedores(), origens: ORIGENS, gestor })), true;
  }

  // importar leads colando CSV (nome;telefone;email;origem;produto)
  if (pathname === '/crm/leads/importar') {
    if (method === 'GET') return send(res, 200, V.importarPage({ ...base, flash: flash() })), true;
    if (method === 'POST') {
      const linhas = String(body.csv || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      let novos = 0, dup = 0, ign = 0;
      for (const [i, linha] of linhas.entries()) {
        const c = linha.split(/[;\t]/).map((x) => x.trim().replace(/^"|"$/g, ''));
        if (i === 0 && /nome/i.test(c[0]) && /tel|whats|fone/i.test(c[1] || '')) continue; // cabeçalho
        if (!c[0] && !c[1]) { ign++; continue; }
        const r = entradaDeLead({ nome: c[0] || c[1], telefone: c[1], email: c[2], origem: c[3] || txt(body.origem_padrao), produto_texto: c[4] }, user.id);
        r.duplicado ? dup++ : novos++;
      }
      ok(`Importação: ${novos} novos, ${dup} já existiam (registrado no histórico), ${ign} linhas vazias.`);
      return redirect(res, '/crm/leads?periodo=tudo'), true;
    }
  }

  // ---------------------------------------------------------- Follow-ups
  if (pathname === '/crm/follow-ups' && method === 'GET') {
    const f = q('f') || 'hoje';
    const hoje = hojeLocal();
    const d = (n) => new Date(Date.parse(hoje + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
    const cond = {
      hoje: ['f.concluido=0 AND substr(f.data_hora,1,10) = ?', [hoje]],
      atrasados: ['f.concluido=0 AND substr(f.data_hora,1,10) < ?', [hoje]],
      amanha: ['f.concluido=0 AND substr(f.data_hora,1,10) = ?', [d(1)]],
      '7d': ['f.concluido=0 AND substr(f.data_hora,1,10) BETWEEN ? AND ?', [hoje, d(7)]],
      todos: ['f.concluido=0', []],
      concluidos: ['f.concluido=1', []],
    }[f] || ['f.concluido=0', []];
    let where = cond[0];
    const params = [...cond[1]];
    if (!gestor) { where += ' AND f.responsavel_id = ?'; params.push(user.id); }
    const rows = db
      .prepare(
        `SELECT f.*, n.id negocio_id, l.nome, l.telefone, e.nome etapa, u.name resp
         FROM crm_followups f JOIN crm_negocios n ON n.id=f.negocio_id JOIN crm_leads l ON l.id=n.lead_id
         LEFT JOIN crm_etapas e ON e.id=n.etapa_id LEFT JOIN users u ON u.id=f.responsavel_id
         WHERE ${where} ORDER BY f.data_hora ${f === 'concluidos' ? 'DESC' : 'ASC'} LIMIT 500`
      )
      .all(...params);
    const semRetorno = db
      .prepare(`SELECT COUNT(*) c FROM crm_negocios n WHERE n.status='aberto' AND n.primeiro_contato_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crm_followups f WHERE f.negocio_id=n.id AND f.concluido=0)${gestor ? '' : ' AND n.responsavel_id=' + Number(user.id)}`)
      .get().c;
    return send(res, 200, V.followupsPage({ ...base, flash: flash(), rows, f, hoje, semRetorno })), true;
  }
  if ((m = matchRoute('/crm/follow-ups/:id/concluir', pathname)) && method === 'POST') {
    const fu = db.prepare('SELECT * FROM crm_followups WHERE id = ?').get(Number(m.id));
    if (!fu) return notFound(res), true;
    db.prepare("UPDATE crm_followups SET concluido=1, concluido_at=datetime('now') WHERE id=?").run(fu.id);
    registrar(fu.negocio_id, user.id, 'followup', 'Follow-up concluído' + (txt(body.resultado) ? ': ' + txt(body.resultado) : ''), { contaComoContato: true });
    ok('Follow-up concluído. Agende o próximo passo para o lead não esfriar.');
    return redirect(res, txt(body.voltar) && String(body.voltar).startsWith('/crm') ? body.voltar : '/crm/follow-ups'), true;
  }

  // ---------------------------------------------------------- Propostas
  if (pathname === '/crm/propostas' && method === 'GET') {
    const where = ['1=1'];
    const params = [];
    if (!gestor) { where.push('pr.vendedor_id = ?'); params.push(user.id); }
    if (q('status')) { where.push('pr.status = ?'); params.push(q('status')); }
    const rows = db
      .prepare(
        `SELECT pr.*, l.nome, COALESCE(p.nome, pr.produto_texto) produto, u.name vendedor
         FROM crm_propostas pr JOIN crm_negocios n ON n.id=pr.negocio_id JOIN crm_leads l ON l.id=n.lead_id
         LEFT JOIN pecas p ON p.id=pr.produto_id LEFT JOIN users u ON u.id=pr.vendedor_id
         WHERE ${where.join(' AND ')} ORDER BY pr.id DESC LIMIT 500`
      )
      .all(...params);
    return send(res, 200, V.propostasPage({ ...base, flash: flash(), rows, status: q('status'), STATUS_PROPOSTA, hoje: hojeLocal() })), true;
  }
  if ((m = matchRoute('/crm/negocios/:id/proposta', pathname)) || pathname.match(/^\/crm\/propostas\/\d+$/)) {
    const editId = pathname.startsWith('/crm/propostas/') ? Number(pathname.split('/').pop()) : null;
    const prop = editId ? db.prepare('SELECT * FROM crm_propostas WHERE id = ?').get(editId) : null;
    if (editId && !prop) return notFound(res), true;
    const negId = prop ? prop.negocio_id : Number(m.id);
    const neg = negocioCompleto(negId);
    if (!neg) return notFound(res), true;
    if (method === 'GET') {
      const vazio = { produto_id: neg.produto_id, produto_texto: neg.produto_texto, valor: neg.valor || '', status: 'rascunho', vendedor_id: neg.responsavel_id || user.id, validade: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) };
      return send(res, 200, V.propostaFormPage({ ...base, flash: flash(), neg, prop: prop || vazio, editando: !!prop, produtos: produtos(), vendedores: vendedores(), formas: FORMAS_PGTO, STATUS_PROPOSTA })), true;
    }
    if (method === 'POST') {
      const vals = [int(body.produto_id), txt(body.produto_texto), num(body.valor) || 0, num(body.desconto) || 0, num(body.entrada) || 0, int(body.parcelas), num(body.valor_parcela), txt(body.forma_pagamento), txt(body.validade), STATUS_PROPOSTA[body.status] ? body.status : 'rascunho', int(body.vendedor_id), txt(body.observacoes)];
      let id = prop && prop.id;
      if (prop) {
        db.prepare('UPDATE crm_propostas SET produto_id=?, produto_texto=?, valor=?, desconto=?, entrada=?, parcelas=?, valor_parcela=?, forma_pagamento=?, validade=?, status=?, vendedor_id=?, observacoes=? WHERE id=?').run(...vals, prop.id);
        if (prop.status !== vals[9]) registrar(neg.id, user.id, 'proposta', `Proposta #${prop.id}: ${STATUS_PROPOSTA[prop.status]} → ${STATUS_PROPOSTA[vals[9]]}`);
      } else {
        id = db.prepare('INSERT INTO crm_propostas (negocio_id, produto_id, produto_texto, valor, desconto, entrada, parcelas, valor_parcela, forma_pagamento, validade, status, vendedor_id, observacoes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(neg.id, ...vals).lastInsertRowid;
        registrar(neg.id, user.id, 'proposta', `Proposta #${id} criada · R$ ${(vals[2] - vals[3]).toFixed(2)}`, { contaComoContato: true });
      }
      // valor do negócio acompanha a última proposta
      db.prepare('UPDATE crm_negocios SET valor = ? WHERE id = ?').run(Math.max(0, vals[2] - vals[3]), neg.id);
      ok('Proposta salva.');
      return redirect(res, '/crm/propostas/' + id + '/ver'), true;
    }
  }
  if ((m = matchRoute('/crm/propostas/:id/ver', pathname)) && method === 'GET') {
    const prop = db.prepare('SELECT pr.*, COALESCE(p.nome, pr.produto_texto) produto, u.name vendedor FROM crm_propostas pr LEFT JOIN pecas p ON p.id=pr.produto_id LEFT JOIN users u ON u.id=pr.vendedor_id WHERE pr.id = ?').get(Number(m.id));
    if (!prop) return notFound(res), true;
    const neg = negocioCompleto(prop.negocio_id);
    const textoWa = V.propostaTextoWhatsApp(prop, neg);
    return send(res, 200, V.propostaVerPage({ ...base, flash: flash(), prop, neg, STATUS_PROPOSTA, wa: waLink(neg.telefone, textoWa) })), true;
  }

  // ---------------------------------------------------------- Respostas rápidas
  if (pathname === '/crm/respostas' && method === 'GET') {
    const rows = db.prepare('SELECT * FROM crm_respostas ORDER BY categoria, titulo').all();
    const edit = q('editar') ? db.prepare('SELECT * FROM crm_respostas WHERE id = ?').get(Number(q('editar'))) : null;
    return send(res, 200, V.respostasPage({ ...base, flash: flash(), rows, edit, categorias: CATEGORIAS_RESPOSTA })), true;
  }
  if (pathname === '/crm/respostas' && method === 'POST') {
    if (!txt(body.titulo) || !txt(body.mensagem)) { erro('Título e mensagem são obrigatórios.'); return redirect(res, '/crm/respostas'), true; }
    const atalho = txt(body.atalho) ? '/' + String(body.atalho).replace(/^\/+/, '').trim() : null;
    if (int(body.id)) db.prepare('UPDATE crm_respostas SET titulo=?, categoria=?, atalho=?, mensagem=? WHERE id=?').run(txt(body.titulo), txt(body.categoria), atalho, txt(body.mensagem), int(body.id));
    else db.prepare('INSERT INTO crm_respostas (titulo, categoria, atalho, mensagem) VALUES (?, ?, ?, ?)').run(txt(body.titulo), txt(body.categoria), atalho, txt(body.mensagem));
    ok('Resposta rápida salva.');
    return redirect(res, '/crm/respostas'), true;
  }
  if ((m = matchRoute('/crm/respostas/:id/excluir', pathname)) && method === 'POST') {
    db.prepare('DELETE FROM crm_respostas WHERE id = ?').run(Number(m.id));
    ok('Resposta excluída.');
    return redirect(res, '/crm/respostas'), true;
  }

  // ---------------------------------------------------------- Origem e resultados
  if (pathname === '/crm/origens' && method === 'GET') {
    if (!gestor) return forbidden(res), true;
    const per = q('periodo') || 'mes';
    const [ini, fim] = periodo(per);
    const agrupar = { origem: "COALESCE(n.origem,'(sem origem)')", canal: "COALESCE(n.canal,'(sem canal)')", campanha: "COALESCE(n.campanha,'(sem campanha)')", vendedor: "COALESCE(u.name,'(sem responsável)')" }[q('por')] || "COALESCE(n.origem,'(sem origem)')";
    const rows = db
      .prepare(
        `SELECT ${agrupar} grupo, COUNT(*) leads,
           SUM(CASE WHEN n.primeiro_contato_at IS NOT NULL THEN 1 ELSE 0 END) respondidos,
           AVG(CASE WHEN n.primeiro_contato_at IS NOT NULL THEN (julianday(n.primeiro_contato_at) - julianday(n.created_at)) * 1440 END) min_resposta,
           SUM(CASE WHEN n.status='ganho' THEN 1 ELSE 0 END) vendas,
           SUM(CASE WHEN n.status='ganho' THEN n.valor ELSE 0 END) receita
         FROM crm_negocios n LEFT JOIN users u ON u.id = n.responsavel_id
         WHERE date(${LOCAL('n.created_at')}) BETWEEN ? AND ? GROUP BY grupo ORDER BY leads DESC`
      )
      .all(ini, fim);
    return send(res, 200, V.origensPage({ ...base, flash: flash(), rows, per, por: q('por') || 'origem' })), true;
  }

  // ---------------------------------------------------------- Configurações do CRM
  if (pathname === '/crm/config') {
    if (!gestor) return forbidden(res), true;
    if (method === 'GET') {
      const dist = db
        .prepare('SELECT u.id, u.name, COALESCE(d.ordem, 999) ordem, COALESCE(d.ativo, 0) ativo, (SELECT COUNT(*) FROM crm_negocios n WHERE n.responsavel_id=u.id AND date(n.created_at) >= ?) recebidos_mes FROM users u LEFT JOIN crm_distribuicao d ON d.user_id=u.id WHERE u.ativo=1 ORDER BY ordem, u.name')
        .all(mesLocal() + '-01');
      const mes = mesLocal();
      const metas = db.prepare('SELECT * FROM crm_metas WHERE mes = ?').all(mes);
      const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
      return send(res, 200, V.configPage({ ...base, flash: flash(), etapas: db.prepare('SELECT * FROM crm_etapas ORDER BY ativo DESC, ordem, id').all(), dist, metas, mes, webhook: origin + '/api/crm/lead?token=' + getConfig('webhook_token') })), true;
    }
    if (method === 'POST') {
      const sec = body.secao;
      if (sec === 'etapas') {
        for (const e of db.prepare('SELECT id FROM crm_etapas').all()) {
          if (body['nome_' + e.id] === undefined) continue;
          db.prepare('UPDATE crm_etapas SET nome=?, ordem=?, cor=?, tipo=?, ativo=? WHERE id=?').run(
            txt(body['nome_' + e.id]) || 'Etapa', int(body['ordem_' + e.id]) || 0, txt(body['cor_' + e.id]) || '#2c6ea8',
            ['aberta', 'ganho', 'perdido', 'desqualificado'].includes(body['tipo_' + e.id]) ? body['tipo_' + e.id] : 'aberta',
            body['ativo_' + e.id] ? 1 : 0, e.id
          );
        }
        if (txt(body.nova_nome)) {
          const mx = db.prepare('SELECT COALESCE(MAX(ordem),0) m FROM crm_etapas').get().m;
          db.prepare("INSERT INTO crm_etapas (nome, ordem, cor, tipo) VALUES (?, ?, ?, 'aberta')").run(txt(body.nova_nome), mx + 1, txt(body.nova_cor) || '#2c6ea8');
        }
        ok('Etapas do funil salvas.');
      } else if (sec === 'distribuicao') {
        for (const u of vendedores()) {
          db.prepare('INSERT INTO crm_distribuicao (user_id, ordem, ativo) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET ordem=excluded.ordem, ativo=excluded.ativo')
            .run(u.id, int(body['ordem_' + u.id]) || 0, body['ativo_' + u.id] ? 1 : 0);
        }
        ok('Distribuição de leads salva.');
      } else if (sec === 'metas') {
        const mes = txt(body.mes) || mesLocal();
        const up = db.prepare('INSERT INTO crm_metas (mes, user_id, meta_vendas, meta_faturamento) VALUES (?, ?, ?, ?) ON CONFLICT(mes, user_id) DO UPDATE SET meta_vendas=excluded.meta_vendas, meta_faturamento=excluded.meta_faturamento');
        up.run(mes, 0, int(body.vendas_0), num(body.fat_0));
        for (const u of vendedores()) if (body['vendas_' + u.id] !== undefined) up.run(mes, u.id, int(body['vendas_' + u.id]), num(body['fat_' + u.id]));
        ok('Metas salvas.');
      } else if (sec === 'token') {
        setConfig('webhook_token', require('node:crypto').randomBytes(18).toString('hex'));
        ok('Novo token gerado. Atualize o link nas integrações (Zapier, site etc.).');
      }
      return redirect(res, '/crm/config'), true;
    }
  }

  return false;
}

module.exports = { handleCrm, handleCrmWebhook, entradaDeLead };
