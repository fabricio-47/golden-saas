'use strict';

// Telas do CRM comercial.

const { layout } = require('./layout');
const { escapeHtml, formatMoney } = require('../utils');
const { hasManagementAccess } = require('../roles');
const { db } = require('../db');

const esc = escapeHtml;
const money = (v) => formatMoney(Number(v) || 0);
const csrfInput = (t) => `<input type="hidden" name="csrf" value="${esc(t)}">`;
const TZ = 'America/Sao_Paulo';
// Datas do banco são UTC ('YYYY-MM-DD HH:MM:SS'); mostra em horário de Brasília.
function dt(v, soData) {
  if (!v) return '—';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) { // follow-up já é horário local
    const [d, h] = s.split('T');
    return d.split('-').reverse().join('/') + (soData ? '' : ' ' + h);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.split('-').reverse().join('/');
  const d = new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z'));
  if (isNaN(d.getTime())) return '—';
  const o = { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit' };
  if (!soData) Object.assign(o, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString('pt-BR', o);
}
function haQuanto(v) {
  if (!v) return '—';
  const d = new Date(String(v).replace(' ', 'T') + 'Z');
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 60) return `há ${Math.max(min, 0)} min`;
  if (min < 1440) return `há ${Math.round(min / 60)} h`;
  return `há ${Math.round(min / 1440)} dias`;
}
const pill = (texto, cor) =>
  `<span style="display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;white-space:nowrap;background:${esc(cor || '#888')}22;color:${esc(cor || '#555')};">${esc(texto)}</span>`;
const opt = (v, label, sel) => `<option value="${esc(v)}" ${String(sel ?? '') === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
const options = (lista, sel, vazio) => (vazio !== undefined ? opt('', vazio, sel) : '') + lista.map((x) => (typeof x === 'object' ? opt(x.id, x.name || x.nome, sel) : opt(x, x, sel))).join('');

const CSS = `<style>
  .crm-wide .main { max-width: none; }
  .crm-tabs { display:flex; gap:6px; flex-wrap:wrap; margin:0 0 16px; }
  .crm-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:18px; }
  .crm-kpi { background:#fff; border:1px solid #e5e2d8; border-radius:10px; padding:12px 14px; }
  .crm-kpi .n { font-size:22px; font-weight:700; }
  .crm-kpi .l { font-size:12px; color:#6b6558; }
  .crm-kpi.alerta .n { color:#a1352a; }
  .crm-filtros { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:14px; }
  .crm-filtros input, .crm-filtros select { width:auto; padding:7px 10px; font-size:13px; }
  .kanban { display:flex; gap:12px; overflow-x:auto; padding-bottom:12px; align-items:flex-start; }
  .kcol { flex:0 0 270px; background:#efece3; border-radius:10px; display:flex; flex-direction:column; max-height:75vh; }
  .kcol-h { padding:10px 12px; border-radius:10px 10px 0 0; color:#fff; }
  .kcol-h b { font-size:14px; } .kcol-h small { display:block; opacity:.9; font-size:12px; }
  .kcol-b { padding:8px; overflow-y:auto; min-height:80px; flex:1; }
  .kcol-b.over { background:#e2dccb; }
  .kcard { background:#fff; border:1px solid #e0dccf; border-left:4px solid var(--c,#999); border-radius:8px; padding:9px 10px; margin-bottom:8px; cursor:grab; font-size:13px; }
  .kcard:active { cursor:grabbing; }
  .kcard .t { font-weight:600; display:flex; justify-content:space-between; gap:6px; }
  .kcard .s { color:#6b6558; font-size:12px; margin-top:2px; }
  .kcard .r { display:flex; gap:4px; flex-wrap:wrap; margin-top:6px; }
  .tl { list-style:none; padding:0; margin:0; }
  .tl li { border-left:2px solid #e0dccf; padding:0 0 12px 14px; position:relative; }
  .tl li:before { content:''; position:absolute; left:-6px; top:3px; width:10px; height:10px; border-radius:50%; background:var(--c,#b8b2a0); }
  .tl .meta { font-size:12px; color:#8a8474; }
  .duas { display:grid; grid-template-columns: 1.4fr 1fr; gap:18px; align-items:start; }
  .dl { display:grid; grid-template-columns: 130px 1fr; gap:6px 10px; font-size:14px; }
  .dl dt { color:#6b6558; } .dl dd { margin:0; font-weight:500; }
  .resp-msg { white-space:pre-wrap; font-size:13px; background:#faf9f5; border:1px solid #efece3; border-radius:6px; padding:8px 10px; }
  @media (max-width: 900px) { .duas { grid-template-columns:1fr; } }
</style>`;

function subnav(ativo, gestor) {
  const itens = [
    ['dia', '/crm', 'Meu dia'],
    ['funil', '/crm/funil', 'Funil'],
    ['leads', '/crm/leads', 'Leads'],
    ['followups', '/crm/follow-ups', 'Follow-ups'],
    ['propostas', '/crm/propostas', 'Propostas'],
    ['respostas', '/crm/respostas', 'Respostas rápidas'],
    ...(gestor ? [['origens', '/crm/origens', 'Origem e resultados'], ['config', '/crm/config', 'Configurar CRM']] : []),
  ];
  return `<div class="crm-tabs">${itens.map(([k, h, l]) => `<a class="btn btn-sm ${k === ativo ? '' : 'btn-secondary'}" href="${h}">${l}</a>`).join('')}</div>`;
}
const page = (o, nav, body, wide) =>
  layout({ title: o.title, activeNav: 'crm-' + nav, user: o.user, flash: o.flash, children: CSS + (wide ? '<script>document.body.classList.add("crm-wide")</script>' : '') + subnav(nav, hasManagementAccess(o.user)) + body });

// ------------------------------------------------------------------ Meu dia
function meuDiaPage({ user, flash, k, vendasMes, meta, fila, ranking, gestor }) {
  const metaV = meta && meta.meta_vendas ? meta.meta_vendas : null;
  const pct = metaV ? Math.min(100, Math.round((vendasMes.c / metaV) * 100)) : null;
  const diasMes = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const diaHoje = Number(new Date(Date.now() - 3 * 3600e3).toISOString().slice(8, 10));
  const ritmo = metaV ? Math.round((vendasMes.c / diaHoje) * diasMes) : null;
  const body = `
  <div class="page-header"><div><h1>Meu dia</h1><p class="subtitle">O que fazer agora, em ordem de prioridade.</p></div>
    <a class="btn" href="/crm/negocios/novo">+ Novo lead</a></div>
  <div class="crm-kpis">
    <div class="crm-kpi"><div class="n">${k.leadsHoje}</div><div class="l">leads entraram hoje</div></div>
    <div class="crm-kpi ${k.semResposta ? 'alerta' : ''}"><div class="n">${k.semResposta}</div><div class="l">leads sem nenhuma resposta</div></div>
    <div class="crm-kpi ${k.fuAtrasados ? 'alerta' : ''}"><div class="n">${k.fuAtrasados}</div><div class="l">follow-ups atrasados</div></div>
    <div class="crm-kpi"><div class="n">${k.fuHoje}</div><div class="l">follow-ups para hoje</div></div>
    <div class="crm-kpi ${k.esfriando ? 'alerta' : ''}"><div class="n">${k.esfriando}</div><div class="l">esfriando (7+ dias sem ação)</div></div>
    <div class="crm-kpi"><div class="n">${vendasMes.c}</div><div class="l">vendas no mês · ${money(vendasMes.v)}</div></div>
  </div>
  ${metaV ? `<div class="card"><b>Meta do mês:</b> ${vendasMes.c} de ${metaV} vendas (${pct}%) · no ritmo atual fecha em ~${ritmo}.
     <div style="height:8px;background:#efece3;border-radius:6px;margin-top:8px;"><div style="height:8px;width:${pct}%;background:var(--gold);border-radius:6px;"></div></div></div>`
    : gestor ? `<div class="card muted">Sem meta definida para este mês. <a class="link-btn" href="/crm/config#metas">Definir meta</a></div>` : ''}
  <div class="card"><h2>Comece por aqui</h2>
  ${fila.length ? `<table><thead><tr><th>Lead</th><th>Situação</th><th>Etapa</th><th>Origem</th>${gestor ? '<th>Responsável</th>' : ''}<th></th></tr></thead><tbody>
    ${fila.map((r) => `<tr><td><a href="/crm/negocios/${r.id}"><b>${esc(r.nome)}</b></a><div class="muted">${esc(r.telefone || '')}</div></td>
      <td>${r.fu ? pill('Follow-up ' + dt(r.fu), r.fu.slice(0, 10) < new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10) ? '#a1352a' : '#c98a2c') : pill('Sem resposta · ' + haQuanto(r.created_at), '#a1352a')}</td>
      <td>${esc(r.etapa || '—')}</td><td>${esc(r.origem || '—')}</td>${gestor ? `<td>${esc(r.resp || 'Sem dono')}</td>` : ''}
      <td><a class="btn btn-sm" href="/crm/negocios/${r.id}">Atender</a></td></tr>`).join('')}
  </tbody></table>` : '<p class="empty">Nada pendente. Bom trabalho.</p>'}
  </div>
  ${gestor ? `<div class="card"><h2>Equipe no mês</h2>${ranking.length ? `<table><thead><tr><th>Vendedor</th><th>Recebeu</th><th>Atendeu</th><th>Sem resposta</th><th>Vendas</th><th>Conversão</th></tr></thead><tbody>
    ${ranking.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.recebeu}</td><td>${r.atendeu}</td><td style="${r.sem_resposta ? 'color:#a1352a;font-weight:600' : ''}">${r.sem_resposta}</td><td>${r.vendas}</td><td>${r.recebeu ? ((r.vendas / r.recebeu) * 100).toFixed(1) : '0.0'}%</td></tr>`).join('')}
  </tbody></table>` : '<p class="empty">Sem leads no mês.</p>'}</div>` : ''}`;
  return page({ title: 'CRM · Meu dia', user, flash, gestor }, 'dia', body);
}

// ------------------------------------------------------------------ Funil
function funilPage({ user, flash, csrfToken, etapas, cards, k, filtros, vendedores, origens, gestor }) {
  const porEtapa = {};
  for (const c of cards) (porEtapa[c.etapa_id] = porEtapa[c.etapa_id] || []).push(c);
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const card = (c, cor) => {
    const atrasado = c.fu && c.fu.slice(0, 10) < hoje;
    return `<div class="kcard" draggable="true" data-id="${c.id}" style="--c:${esc(cor)}">
      <div class="t"><a href="/crm/negocios/${c.id}">${esc(c.nome)}</a>${c.valor ? `<span>${money(c.valor)}</span>` : ''}</div>
      <div class="s">${esc(c.produto || 'Sem produto definido')}</div>
      <div class="r">${c.origem ? pill(c.origem, '#2c6ea8') : ''}${c.resp ? pill(c.resp, '#6b6558') : pill('Sem dono', '#a1352a')}
        ${!c.primeiro_contato_at && c.status === 'aberto' ? pill('Sem resposta', '#a1352a') : ''}
        ${c.fu ? pill((atrasado ? 'Atrasado · ' : 'FU ') + dt(c.fu, true), atrasado ? '#a1352a' : '#c98a2c') : ''}</div>
      <div class="s" style="margin-top:6px;display:flex;justify-content:space-between;"><span>${haQuanto(c.ultima_acao_at)}</span>
        ${c.telefone ? `<a href="https://wa.me/${String(c.telefone).replace(/\D/g, '').replace(/^(?!55)(\d{10,11})$/, '55$1')}" target="_blank" title="WhatsApp">WhatsApp ↗</a>` : ''}</div>
    </div>`;
  };
  const per = [['hoje', 'Hoje'], ['7d', '7 dias'], ['mes', 'Este mês'], ['mes_passado', 'Mês passado'], ['30d', '30 dias'], ['tudo', 'Tudo']];
  const body = `
  <div class="page-header"><div><h1>Funil comercial</h1><p class="subtitle">Arraste os cards entre as etapas. Tudo que muda fica no histórico do negócio.</p></div>
    <div class="actions-row" style="margin:0"><a class="btn btn-secondary" href="/crm/leads/importar">Importar</a><a class="btn" href="/crm/negocios/novo">+ Novo negócio</a></div></div>
  <div class="crm-kpis">
    <div class="crm-kpi"><div class="n">${k.abertos}</div><div class="l">oportunidades em aberto</div></div>
    <div class="crm-kpi"><div class="n">${money(k.pipeline)}</div><div class="l">valor em pipeline</div></div>
    <div class="crm-kpi"><div class="n">${k.conversao.toFixed(1)}%</div><div class="l">conversão (ganhos/total)</div></div>
    <div class="crm-kpi"><div class="n">${k.ganhos} / ${k.perdidos}</div><div class="l">ganhos / perdidos</div></div>
    <div class="crm-kpi ${k.fuAtrasados ? 'alerta' : ''}"><div class="n">${k.fuAtrasados}</div><div class="l">follow-ups vencidos</div></div>
    <div class="crm-kpi ${k.esfriando ? 'alerta' : ''}"><div class="n">${k.esfriando}</div><div class="l">sem contato há 7+ dias</div></div>
  </div>
  <form class="crm-filtros" method="GET" action="/crm/funil">
    <input type="text" name="q" value="${esc(filtros.q)}" placeholder="Buscar nome, telefone, e-mail ou produto" style="min-width:260px">
    <select name="periodo">${per.map(([v, l]) => opt(v, l, filtros.periodo)).join('')}</select>
    ${gestor ? `<select name="resp">${options(vendedores, filtros.resp, 'Todos os vendedores')}</select>` : ''}
    <select name="origem">${options(origens, filtros.origem, 'Todas as origens')}</select>
    <button class="btn btn-sm" type="submit">Filtrar</button> <a class="link-btn" href="/crm/funil">Limpar</a>
  </form>
  <div class="kanban">
    ${etapas.map((e) => {
      const lista = porEtapa[e.id] || [];
      const tot = lista.reduce((s, c) => s + (c.valor || 0), 0);
      return `<div class="kcol"><div class="kcol-h" style="background:${esc(e.cor)}"><b>${esc(e.nome)}</b><small><span data-count="${e.id}">${lista.length}</span> · ${money(tot)}</small></div>
        <div class="kcol-b" data-etapa="${e.id}" data-cor="${esc(e.cor)}">${lista.slice(0, 300).map((c) => card(c, e.cor)).join('')}${lista.length > 300 ? `<p class="muted">+${lista.length - 300} — use os filtros</p>` : ''}</div></div>`;
    }).join('')}
  </div>
  <script>
  (function(){
    var csrf = ${JSON.stringify(csrfToken)}; var arrastando = null;
    document.querySelectorAll('.kcard').forEach(function(c){
      c.addEventListener('dragstart', function(){ arrastando = c; c.style.opacity = .5; });
      c.addEventListener('dragend', function(){ c.style.opacity = 1; });
    });
    document.querySelectorAll('.kcol-b').forEach(function(col){
      col.addEventListener('dragover', function(e){ e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', function(){ col.classList.remove('over'); });
      col.addEventListener('drop', function(e){
        e.preventDefault(); col.classList.remove('over');
        if (!arrastando || arrastando.parentNode === col) return;
        var de = arrastando.parentNode, card = arrastando;
        var fd = new URLSearchParams({ csrf: csrf, etapa_id: col.dataset.etapa });
        fetch('/crm/negocios/' + card.dataset.id + '/etapa', { method: 'POST', body: fd, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
          .then(function(r){ return r.json(); }).then(function(j){
            if (!j.ok) { alert(j.error || 'Não foi possível mover.'); return; }
            col.insertBefore(card, col.firstChild); card.style.setProperty('--c', col.dataset.cor);
            [de, col].forEach(function(x){ var s = document.querySelector('[data-count="' + x.dataset.etapa + '"]'); if (s) s.textContent = x.querySelectorAll('.kcard').length; });
          }).catch(function(){ alert('Sem conexão. Tente de novo.'); });
      });
    });
  })();
  </script>`;
  return page({ title: 'CRM · Funil', user, flash, gestor }, 'funil', body, true);
}

// ------------------------------------------------------------------ Negócio: form
function negocioFormPage({ user, flash, csrfToken, neg, etapas, vendedores, produtos, origens, canais, editando }) {
  const n = neg || {};
  const body = `
  <div class="page-header"><div><h1>${editando ? 'Editar negócio' : 'Novo lead / negócio'}</h1>
    <p class="subtitle">${editando ? '' : 'Se o telefone já existir com negócio em aberto, o sistema abre o existente em vez de duplicar.'}</p></div></div>
  <form method="POST" class="card" action="${editando ? `/crm/negocios/${n.id}/editar` : '/crm/negocios/novo'}">${csrfInput(csrfToken)}
    <div class="form-grid">
      <div class="field"><label>Nome do lead *</label><input type="text" name="nome" value="${esc(n.nome || '')}" required></div>
      <div class="field"><label>WhatsApp / telefone</label><input type="tel" name="telefone" value="${esc(n.telefone || '')}" placeholder="(21) 99999-9999"></div>
      <div class="field"><label>E-mail</label><input type="email" name="email" value="${esc(n.email || '')}"></div>
      <div class="field"><label>Título do negócio</label><input type="text" name="titulo" value="${esc(n.titulo || '')}" placeholder="Ex.: Tank preta à vista"></div>
      <div class="field"><label>Produto (do estoque)</label><select name="produto_id">${opt('', '—', n.produto_id)}${produtos.map((p) => opt(p.id, p.nome + (p.preco_venda ? ' · ' + money(p.preco_venda) : ''), n.produto_id)).join('')}</select></div>
      <div class="field"><label>Interesse / modelo (texto livre)</label><input type="text" name="produto_texto" value="${esc(n.produto_texto || '')}"></div>
      <div class="field"><label>Valor potencial (R$)</label><input type="number" step="0.01" name="valor" value="${esc(n.valor ?? '')}"></div>
      <div class="field"><label>Etapa</label><select name="etapa_id">${etapas.map((e) => opt(e.id, e.nome, n.etapa_id)).join('')}</select></div>
      <div class="field"><label>Origem</label><select name="origem">${options(origens, n.origem, '—')}</select></div>
      <div class="field"><label>Detalhe da origem</label><input type="text" name="origem_detalhe" value="${esc(n.origem_detalhe || '')}" placeholder="Ex.: anúncio do modelo X"></div>
      <div class="field"><label>Canal</label><select name="canal">${options(canais, n.canal, '—')}</select></div>
      <div class="field"><label>Campanha</label><input type="text" name="campanha" value="${esc(n.campanha || '')}"></div>
      <div class="field"><label>Vendedor responsável</label><select name="responsavel_id">${opt('', editando ? '— sem dono —' : 'Rodízio automático', n.responsavel_id)}${vendedores.map((v) => opt(v.id, v.name, n.responsavel_id)).join('')}</select></div>
      ${editando ? '' : `<div class="field"><label>Próximo follow-up</label><input type="datetime-local" name="proximo_followup" value="${esc(n.proximo_followup || '')}"></div>`}
      <div class="field full"><label>Observações</label><textarea name="observacoes">${esc(n.observacoes || '')}</textarea></div>
    </div>
    <div class="actions-row"><button class="btn" type="submit">Salvar</button><a class="btn btn-secondary" href="${editando ? '/crm/negocios/' + n.id : '/crm/funil'}">Cancelar</a></div>
  </form>`;
  return page({ title: 'CRM · Negócio', user, flash, gestor: false }, 'funil', body);
}

// ------------------------------------------------------------------ Negócio: detalhe
const COR_ATIV = { sistema: '#b8b2a0', etapa: '#2c6ea8', observacao: '#8a8474', ligacao: '#4f9d69', mensagem: '#25a35a', reuniao: '#d4af37', followup: '#c98a2c', proposta: '#6b4fa8', venda: '#2f8a4f' };
const NOME_ATIV = { sistema: 'Sistema', etapa: 'Etapa', observacao: 'Observação', ligacao: 'Ligação', mensagem: 'Mensagem', reuniao: 'Reunião', followup: 'Follow-up', proposta: 'Proposta', venda: 'Venda' };

function negocioShowPage({ user, flash, csrfToken, neg, atividades, followups, propostas, outros, respostas, etapas, vendedores, tipos, motivosFollowup, motivosPerda, wa, hoje }) {
  const c = csrfInput(csrfToken);
  const st = neg.status === 'ganho' ? pill('GANHO', '#2f8a4f') : neg.status === 'perdido' ? pill('PERDIDO' + (neg.motivo_perda ? ' · ' + neg.motivo_perda : ''), '#a1352a') : pill('EM ABERTO', '#2c6ea8');
  const body = `
  <p><a class="link-btn" href="/crm/funil">← Funil</a></p>
  <div class="card" style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:center;">
    <div>${st}<h1 style="margin-top:6px">${esc(neg.lead_nome)}</h1><div class="muted">${esc(neg.titulo !== neg.lead_nome ? neg.titulo : '')} ${esc(neg.telefone || '')} ${esc(neg.email || '')}</div></div>
    <div style="text-align:right"><div class="muted">Valor</div><div style="font-size:24px;font-weight:700">${money(neg.valor)}</div></div>
    <form method="POST" action="/crm/negocios/${neg.id}/etapa-form" style="display:flex;gap:6px;align-items:center">${c}
      <select name="etapa_id" onchange="this.form.submit()" style="width:auto">${etapas.map((e) => opt(e.id, e.nome, neg.etapa_id)).join('')}</select></form>
  </div>
  <div class="duas">
    <div>
      <div class="card"><h2>Registrar interação</h2>
        <form method="POST" action="/crm/negocios/${neg.id}/atividade">${c}
          <div class="form-grid"><div class="field"><label>Tipo</label><select name="tipo">${Object.entries(tipos).map(([k, l]) => opt(k, l, 'mensagem')).join('')}</select></div>
          <div class="field"><label>Mover para etapa (opcional)</label><select name="etapa_id">${opt('', '— manter —', '')}${etapas.map((e) => opt(e.id, e.nome, '')).join('')}</select></div></div>
          <div class="field"><textarea name="texto" placeholder="O que aconteceu nessa interação?" required></textarea></div>
          <button class="btn btn-sm" type="submit">Registrar</button>
        </form></div>
      ${wa ? `<div class="card"><h2>WhatsApp</h2>
        <form method="POST" action="/crm/negocios/${neg.id}/whatsapp" target="_blank" style="display:flex;gap:8px;flex-wrap:wrap">${c}
          <select name="resposta_id" style="flex:1;min-width:200px">${opt('', 'Abrir conversa sem mensagem', '')}${respostas.map((r) => opt(r.id, (r.atalho ? r.atalho + ' · ' : '') + r.titulo, '')).join('')}</select>
          <button class="btn btn-sm" type="submit">Abrir no WhatsApp ↗</button></form>
        <p class="muted" style="margin:8px 0 0">Abre o WhatsApp com a resposta rápida preenchida (nome do cliente já substituído) e registra no histórico.</p></div>` : ''}
      <div class="card"><h2>Histórico</h2><ul class="tl">
        ${atividades.map((a) => `<li style="--c:${COR_ATIV[a.tipo] || '#b8b2a0'}"><div>${esc(a.texto || '')}</div><div class="meta">${NOME_ATIV[a.tipo] || a.tipo} · ${esc(a.user_nome || 'Sistema')} · ${dt(a.created_at)}</div></li>`).join('') || '<li>Nenhuma atividade.</li>'}
      </ul></div>
    </div>
    <div>
      <div class="card"><h2>Dados do negócio</h2><dl class="dl">
        <dt>Responsável</dt><dd>${esc(neg.responsavel_nome || 'Sem dono')}</dd>
        <dt>Produto</dt><dd>${esc(neg.produto_nome || neg.produto_texto || '—')}</dd>
        <dt>Origem</dt><dd>${esc(neg.origem || '—')}${neg.origem_detalhe ? ' · ' + esc(neg.origem_detalhe) : ''}</dd>
        <dt>Canal</dt><dd>${esc(neg.canal || '—')}</dd>
        <dt>Campanha</dt><dd>${esc(neg.campanha || '—')}</dd>
        <dt>Criado em</dt><dd>${dt(neg.created_at)}</dd>
        <dt>1ª resposta</dt><dd>${neg.primeiro_contato_at ? dt(neg.primeiro_contato_at) : '<span style="color:#a1352a">ainda não respondido</span>'}</dd>
        <dt>Última ação</dt><dd>${dt(neg.ultima_acao_at)}</dd>
        ${neg.observacoes ? `<dt>Obs.</dt><dd>${esc(neg.observacoes)}</dd>` : ''}
      </dl>
      <div class="actions-row"><a class="btn btn-sm btn-secondary" href="/crm/negocios/${neg.id}/editar">Editar</a>
        <form method="POST" action="/crm/negocios/${neg.id}/cliente" style="display:inline">${c}<button class="btn btn-sm btn-secondary" type="submit">${neg.cliente_id ? 'Ver cliente' : 'Converter em cliente'}</button></form>
        <a class="btn btn-sm btn-secondary" href="/crm/negocios/${neg.id}/proposta">Nova proposta</a></div></div>

      ${neg.status === 'aberto' ? `<div class="card"><h2>Fechar negócio</h2>
        <form method="POST" action="/crm/negocios/${neg.id}/ganho" style="display:flex;gap:6px;margin-bottom:10px">${c}
          <input type="number" step="0.01" name="valor" value="${esc(neg.valor || '')}" placeholder="Valor fechado" style="flex:1"><button class="btn btn-sm" type="submit">Ganho ✓</button></form>
        <form method="POST" action="/crm/negocios/${neg.id}/perdido" style="display:flex;gap:6px">${c}
          <select name="motivo_perda" style="flex:1" required>${options(motivosPerda, '', 'Motivo da perda…')}</select><button class="btn btn-sm btn-danger" type="submit">Perdido</button></form>
      </div>` : `<div class="card"><form method="POST" action="/crm/negocios/${neg.id}/reabrir">${c}<button class="btn btn-sm btn-secondary" type="submit">Reabrir negócio</button></form>
        ${neg.status === 'ganho' ? `<p class="muted">Lance a venda no <a class="link-btn" href="/vendas">Balcão</a> para baixar estoque e emitir nota.</p>` : ''}</div>`}

      <div class="card"><h2>Follow-ups</h2>
        ${followups.map((f) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid #efece3;font-size:13px">
          <div>${f.concluido ? '✓ ' : ''}<b>${dt(f.data_hora)}</b> ${esc(f.motivo || '')}<div class="muted">${esc(f.resp || '')}${f.observacao ? ' · ' + esc(f.observacao) : ''}</div></div>
          ${f.concluido ? '' : `<form method="POST" action="/crm/follow-ups/${f.id}/concluir">${c}<input type="hidden" name="voltar" value="/crm/negocios/${neg.id}"><button class="btn btn-sm btn-secondary" type="submit">Concluir</button></form>`}</div>`).join('') || '<p class="muted">Nenhum follow-up.</p>'}
        <form method="POST" action="/crm/negocios/${neg.id}/followup" style="margin-top:10px">${c}
          <div class="form-grid"><div class="field"><label>Data</label><input type="date" name="data" value="${hoje}" required></div>
          <div class="field"><label>Hora</label><input type="time" name="hora" value="10:00"></div>
          <div class="field"><label>Motivo</label><select name="motivo">${options(motivosFollowup, '')}</select></div>
          <div class="field"><label>Responsável</label><select name="responsavel_id">${vendedores.map((v) => opt(v.id, v.name, neg.responsavel_id || user.id)).join('')}</select></div>
          <div class="field full"><input type="text" name="observacao" placeholder="Observação (opcional)"></div></div>
          <button class="btn btn-sm" type="submit">Agendar follow-up</button></form></div>

      <div class="card"><h2>Propostas</h2>
        ${propostas.map((p) => `<div style="padding:4px 0;font-size:13px"><a class="link-btn" href="/crm/propostas/${p.id}/ver">#${p.id}</a> · ${money(p.valor - p.desconto)} · ${esc(p.status)} · val. ${dt(p.validade)}</div>`).join('') || '<p class="muted">Nenhuma proposta.</p>'}</div>
      ${outros.length ? `<div class="card"><h2>Outros negócios deste lead</h2>${outros.map((o) => `<div style="font-size:13px"><a class="link-btn" href="/crm/negocios/${o.id}">#${o.id}</a> · ${esc(o.etapa || '')} · ${esc(o.status)} · ${dt(o.created_at, true)}</div>`).join('')}</div>` : ''}
    </div>
  </div>`;
  return page({ title: 'CRM · ' + neg.lead_nome, user, flash, gestor: false }, 'funil', body);
}

// ------------------------------------------------------------------ Leads
function leadsPage({ user, flash, rows, filtros, vendedores, origens, gestor }) {
  const per = [['hoje', 'Hoje'], ['7d', '7 dias'], ['mes', 'Este mês'], ['mes_passado', 'Mês passado'], ['30d', '30 dias'], ['tudo', 'Tudo']];
  const qs = new URLSearchParams({ ...filtros, csv: '1' }).toString();
  const semResp = rows.filter((r) => !r.primeiro_contato_at && r.status === 'aberto').length;
  const body = `
  <div class="page-header"><div><h1>Leads</h1><p class="subtitle">${rows.length} leads no filtro · <b style="color:${semResp ? '#a1352a' : 'inherit'}">${semResp} sem resposta</b></p></div>
    <div class="actions-row" style="margin:0"><a class="btn btn-secondary" href="/crm/leads/importar">Importar</a><a class="btn btn-secondary" href="/crm/leads?${esc(qs)}">Exportar CSV</a><a class="btn" href="/crm/negocios/novo">+ Novo lead</a></div></div>
  <form class="crm-filtros" method="GET">
    <input type="text" name="q" value="${esc(filtros.q)}" placeholder="Buscar nome, telefone ou e-mail" style="min-width:240px">
    <select name="periodo">${per.map(([v, l]) => opt(v, l, filtros.periodo)).join('')}</select>
    <select name="sit">${opt('', 'Todas as situações', filtros.sit)}${opt('sem_resposta', 'Sem resposta', filtros.sit)}${opt('ganho', 'Ganhos', filtros.sit)}${opt('perdido', 'Perdidos', filtros.sit)}</select>
    ${gestor ? `<select name="resp">${options(vendedores, filtros.resp, 'Todos os vendedores')}</select>` : ''}
    <select name="origem">${options(origens, filtros.origem, 'Todas as origens')}</select>
    <button class="btn btn-sm" type="submit">Filtrar</button>
  </form>
  <div class="card" style="padding:0">${rows.length ? `<table><thead><tr><th>Lead</th><th>Contato</th><th>Origem</th><th>Etapa</th><th>Responsável</th><th>Recebido</th><th>Última ação</th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td><a href="/crm/negocios/${r.id}"><b>${esc(r.nome)}</b></a><div class="muted">${esc(r.produto || '')}</div></td>
    <td>${esc(r.telefone || '')}<div class="muted">${esc(r.email || '')}</div></td><td>${esc(r.origem || '—')}${r.campanha ? `<div class="muted">${esc(r.campanha)}</div>` : ''}</td>
    <td>${pill(r.etapa || '—', r.etapa_cor)}${!r.primeiro_contato_at && r.status === 'aberto' ? ' ' + pill('Sem resposta', '#a1352a') : ''}</td>
    <td>${esc(r.resp || 'Sem dono')}</td><td>${dt(r.created_at)}</td><td>${haQuanto(r.ultima_acao_at)}</td></tr>`).join('')}
  </tbody></table>` : '<p class="empty">Nenhum lead no filtro.</p>'}</div>`;
  return page({ title: 'CRM · Leads', user, flash, gestor }, 'leads', body);
}

function importarPage({ user, flash, csrfToken }) {
  const body = `<div class="page-header"><div><h1>Importar leads</h1><p class="subtitle">Cole as linhas de uma planilha (Excel/Google Sheets): <b>nome; telefone; e-mail; origem; produto</b>. Separador ponto e vírgula ou TAB (copiar/colar direto do Excel funciona).</p></div></div>
  <form method="POST" class="card">${csrfInput(csrfToken)}
    <div class="field"><label>Origem padrão (quando a linha não tiver)</label><input type="text" name="origem_padrao" placeholder="Ex.: Importação MOVEE"></div>
    <div class="field"><label>Linhas</label><textarea name="csv" style="min-height:260px;font-family:monospace" placeholder="Maria Souza;21999998888;maria@email.com;Meta Ads;Tank"></textarea></div>
    <p class="muted">Telefones que já existem com negócio em aberto não duplicam — viram uma nota no histórico. Os novos entram no rodízio de vendedores.</p>
    <button class="btn" type="submit">Importar</button></form>`;
  return page({ title: 'CRM · Importar', user, flash, gestor: false }, 'leads', body);
}

// ------------------------------------------------------------------ Follow-ups
function followupsPage({ user, flash, csrfToken, rows, f, hoje, semRetorno }) {
  const abas = [['hoje', 'Hoje'], ['atrasados', 'Atrasados'], ['amanha', 'Amanhã'], ['7d', 'Próximos 7 dias'], ['todos', 'Todos em aberto'], ['concluidos', 'Concluídos']];
  const body = `<div class="page-header"><div><h1>Follow-ups</h1><p class="subtitle">${semRetorno ? `<b style="color:#a1352a">${semRetorno} negócios em aberto já atendidos estão sem próximo retorno agendado.</b> Todo lead atendido deveria sair com data de retorno.` : 'Todos os negócios atendidos têm retorno agendado.'}</p></div></div>
  <div class="crm-tabs">${abas.map(([k, l]) => `<a class="btn btn-sm ${k === f ? '' : 'btn-secondary'}" href="/crm/follow-ups?f=${k}">${l}</a>`).join('')}</div>
  <div class="card" style="padding:0">${rows.length ? `<table><thead><tr><th>Quando</th><th>Lead</th><th>Motivo</th><th>Etapa</th><th>Responsável</th><th></th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td style="${!r.concluido && r.data_hora.slice(0, 10) < hoje ? 'color:#a1352a;font-weight:600' : ''}">${dt(r.data_hora)}</td>
    <td><a href="/crm/negocios/${r.negocio_id}"><b>${esc(r.nome)}</b></a><div class="muted">${esc(r.telefone || '')}</div></td>
    <td>${esc(r.motivo || '—')}${r.observacao ? `<div class="muted">${esc(r.observacao)}</div>` : ''}</td><td>${esc(r.etapa || '')}</td><td>${esc(r.resp || '')}</td>
    <td>${r.concluido ? 'Concluído ' + dt(r.concluido_at) : `<form method="POST" action="/crm/follow-ups/${r.id}/concluir" style="display:flex;gap:4px">${csrfInput(csrfToken)}<input type="hidden" name="voltar" value="/crm/follow-ups?f=${esc(f)}"><input type="text" name="resultado" placeholder="Resultado" style="width:140px;padding:6px"><button class="btn btn-sm" type="submit">Concluir</button></form>`}</td></tr>`).join('')}
  </tbody></table>` : '<p class="empty">Nada aqui.</p>'}</div>`;
  return page({ title: 'CRM · Follow-ups', user, flash, gestor: false }, 'followups', body);
}

// ------------------------------------------------------------------ Propostas
function propostasPage({ user, flash, rows, status, STATUS_PROPOSTA, hoje }) {
  const body = `<div class="page-header"><div><h1>Propostas</h1><p class="subtitle">Crie propostas a partir de um negócio (botão "Nova proposta" no negócio).</p></div></div>
  <form class="crm-filtros" method="GET"><select name="status" onchange="this.form.submit()">${opt('', 'Todos os status', status)}${Object.entries(STATUS_PROPOSTA).map(([k, l]) => opt(k, l, status)).join('')}</select></form>
  <div class="card" style="padding:0">${rows.length ? `<table><thead><tr><th>#</th><th>Cliente</th><th>Produto</th><th>Valor</th><th>Entrada</th><th>Parcelamento</th><th>Vendedor</th><th>Criada</th><th>Validade</th><th>Status</th></tr></thead><tbody>
  ${rows.map((p) => `<tr><td><a class="link-btn" href="/crm/propostas/${p.id}/ver">#${p.id}</a></td><td><a href="/crm/negocios/${p.negocio_id}">${esc(p.nome)}</a></td><td>${esc(p.produto || '—')}</td>
    <td>${money(p.valor - p.desconto)}</td><td>${p.entrada ? money(p.entrada) : '—'}</td><td>${p.parcelas ? p.parcelas + 'x ' + money(p.valor_parcela) : '—'}</td><td>${esc(p.vendedor || '')}</td>
    <td>${dt(p.created_at, true)}</td><td style="${p.validade && p.validade < hoje && !['aceita', 'recusada'].includes(p.status) ? 'color:#a1352a' : ''}">${dt(p.validade)}</td><td>${esc(STATUS_PROPOSTA[p.status] || p.status)}</td></tr>`).join('')}
  </tbody></table>` : '<p class="empty">Nenhuma proposta.</p>'}</div>`;
  return page({ title: 'CRM · Propostas', user, flash, gestor: false }, 'propostas', body);
}

function propostaFormPage({ user, flash, csrfToken, neg, prop, editando, produtos, vendedores, formas, STATUS_PROPOSTA }) {
  const p = prop;
  const body = `<p><a class="link-btn" href="/crm/negocios/${neg.id}">← ${esc(neg.lead_nome)}</a></p>
  <h1>${editando ? 'Editar proposta #' + p.id : 'Nova proposta'}</h1>
  <form method="POST" class="card" action="${editando ? '/crm/propostas/' + p.id : '/crm/negocios/' + neg.id + '/proposta'}">${csrfInput(csrfToken)}
    <div class="form-grid">
      <div class="field"><label>Produto</label><select name="produto_id" id="pp">${opt('', '—', p.produto_id)}${produtos.map((x) => `<option value="${x.id}" data-preco="${x.preco_venda || ''}" ${String(p.produto_id) === String(x.id) ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></div>
      <div class="field"><label>Descrição (se não estiver no estoque)</label><input type="text" name="produto_texto" value="${esc(p.produto_texto || '')}"></div>
      <div class="field"><label>Valor (R$)</label><input type="number" step="0.01" name="valor" id="pv" value="${esc(p.valor ?? '')}"></div>
      <div class="field"><label>Desconto (R$)</label><input type="number" step="0.01" name="desconto" id="pd" value="${esc(p.desconto || 0)}"></div>
      <div class="field"><label>Forma de pagamento</label><select name="forma_pagamento">${options(formas, p.forma_pagamento, 'Selecionar')}</select></div>
      <div class="field"><label>Entrada (R$)</label><input type="number" step="0.01" name="entrada" id="pe" value="${esc(p.entrada || 0)}"></div>
      <div class="field"><label>Parcelas</label><input type="number" name="parcelas" id="pn" value="${esc(p.parcelas || '')}"></div>
      <div class="field"><label>Valor da parcela (R$)</label><input type="number" step="0.01" name="valor_parcela" id="vp" value="${esc(p.valor_parcela || '')}"><small class="muted">Calculado sem juros; ajuste se tiver juros da maquininha.</small></div>
      <div class="field"><label>Validade</label><input type="date" name="validade" value="${esc(p.validade || '')}"></div>
      <div class="field"><label>Status</label><select name="status">${Object.entries(STATUS_PROPOSTA).map(([k, l]) => opt(k, l, p.status)).join('')}</select></div>
      <div class="field"><label>Vendedor</label><select name="vendedor_id">${vendedores.map((v) => opt(v.id, v.name, p.vendedor_id)).join('')}</select></div>
      <div class="field full"><label>Observações (aparecem na proposta)</label><textarea name="observacoes">${esc(p.observacoes || '')}</textarea></div>
    </div>
    <button class="btn" type="submit">Salvar proposta</button></form>
  <script>(function(){var g=function(i){return document.getElementById(i)};
    g('pp').addEventListener('change',function(){var o=this.selectedOptions[0];if(o&&o.dataset.preco&&!g('pv').value)g('pv').value=o.dataset.preco;calc();});
    function calc(){var v=+g('pv').value||0,d=+g('pd').value||0,e=+g('pe').value||0,n=+g('pn').value||0;if(n>0)g('vp').value=((v-d-e)/n).toFixed(2);}
    ['pv','pd','pe','pn'].forEach(function(i){g(i).addEventListener('input',calc)});})();</script>`;
  return page({ title: 'CRM · Proposta', user, flash, gestor: false }, 'propostas', body);
}

// Nome da empresa vem do título do catálogo (Configurações → Catálogo), pra servir a qualquer cliente do SaaS.
function nomeEmpresa() {
  try {
    const r = db.prepare('SELECT catalogo_titulo FROM config_geral WHERE id = 1').get();
    return r && r.catalogo_titulo ? String(r.catalogo_titulo).trim() : '';
  } catch (e) {
    return '';
  }
}

function propostaTextoWhatsApp(p, neg) {
  const primeiro = String(neg.lead_nome || '').split(/\s+/)[0];
  const linhas = [
    `Olá, ${primeiro}! Segue sua proposta${nomeEmpresa() ? ' da ' + nomeEmpresa() : ''}:`,
    '',
    `🛵 ${p.produto || 'Produto'}`,
    `💰 Valor: ${money(p.valor - p.desconto)}${p.desconto ? ` (desconto de ${money(p.desconto)})` : ''}`,
  ];
  if (p.forma_pagamento) linhas.push(`💳 Pagamento: ${p.forma_pagamento}`);
  if (p.entrada) linhas.push(`Entrada: ${money(p.entrada)}`);
  if (p.parcelas) linhas.push(`${p.parcelas}x de ${money(p.valor_parcela)}`);
  if (p.validade) linhas.push(`Válida até ${dt(p.validade)}`);
  if (p.observacoes) linhas.push('', p.observacoes);
  linhas.push('', 'Qualquer dúvida, é só me chamar!');
  return linhas.join('\n');
}

function propostaVerPage({ user, flash, prop, neg, STATUS_PROPOSTA, wa }) {
  const p = prop;
  const body = `<p><a class="link-btn" href="/crm/negocios/${neg.id}">← ${esc(neg.lead_nome)}</a></p>
  <div class="page-header"><h1>Proposta #${p.id}</h1><div class="actions-row" style="margin:0">
    <a class="btn btn-secondary" href="/crm/propostas/${p.id}">Editar</a><button class="btn btn-secondary" onclick="window.print()">Imprimir / PDF</button>
    ${wa ? `<a class="btn" href="${esc(wa)}" target="_blank">Enviar no WhatsApp ↗</a>` : ''}</div></div>
  <div class="card"><dl class="dl">
    <dt>Cliente</dt><dd>${esc(neg.lead_nome)} ${esc(neg.telefone || '')}</dd>
    <dt>Produto</dt><dd>${esc(p.produto || '—')}</dd>
    <dt>Valor</dt><dd>${money(p.valor)}${p.desconto ? ' − desconto ' + money(p.desconto) + ' = <b>' + money(p.valor - p.desconto) + '</b>' : ''}</dd>
    <dt>Pagamento</dt><dd>${esc(p.forma_pagamento || '—')}</dd>
    ${p.entrada ? `<dt>Entrada</dt><dd>${money(p.entrada)}</dd>` : ''}
    ${p.parcelas ? `<dt>Parcelamento</dt><dd>${p.parcelas}x de ${money(p.valor_parcela)}</dd>` : ''}
    <dt>Validade</dt><dd>${dt(p.validade)}</dd><dt>Vendedor</dt><dd>${esc(p.vendedor || '')}</dd><dt>Status</dt><dd>${esc(STATUS_PROPOSTA[p.status] || p.status)}</dd>
    ${p.observacoes ? `<dt>Observações</dt><dd style="white-space:pre-wrap">${esc(p.observacoes)}</dd>` : ''}
  </dl></div>`;
  return page({ title: 'Proposta #' + p.id, user, flash, gestor: false }, 'propostas', body);
}

// ------------------------------------------------------------------ Respostas rápidas
function respostasPage({ user, flash, csrfToken, rows, edit, categorias }) {
  const e = edit || {};
  const grupos = {};
  for (const r of rows) (grupos[r.categoria || 'Sem categoria'] = grupos[r.categoria || 'Sem categoria'] || []).push(r);
  const body = `<div class="page-header"><div><h1>Respostas rápidas</h1><p class="subtitle">Variáveis: <code>{nome}</code> (primeiro nome do cliente), <code>{nome_completo}</code>, <code>{vendedor}</code>, <code>{produto}</code>. São substituídas na hora de abrir o WhatsApp pelo negócio.</p></div></div>
  <div class="duas"><div>
  ${Object.entries(grupos).map(([g, lista]) => `<div class="card"><h2>${esc(g)} (${lista.length})</h2>${lista.map((r) => `<div style="padding:8px 0;border-bottom:1px solid #efece3">
    <div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(r.titulo)} ${r.atalho ? `<span class="muted">${esc(r.atalho)}</span>` : ''}</b>
    <span><button class="btn btn-sm btn-secondary" type="button" onclick="navigator.clipboard.writeText(this.closest('div').nextElementSibling.textContent);this.textContent='Copiado'">Copiar</button>
    <a class="btn btn-sm btn-secondary" href="/crm/respostas?editar=${r.id}">Editar</a>
    <form method="POST" action="/crm/respostas/${r.id}/excluir" style="display:inline" onsubmit="return confirm('Excluir esta resposta?')">${csrfInput(csrfToken)}<button class="btn btn-sm btn-secondary" type="submit">×</button></form></span></div>
    <div class="resp-msg">${esc(r.mensagem)}</div></div>`).join('')}</div>`).join('') || '<div class="card"><p class="empty">Nenhuma resposta cadastrada.</p></div>'}
  </div><div><form method="POST" class="card" action="/crm/respostas">${csrfInput(csrfToken)}<h2>${e.id ? 'Editar resposta' : 'Nova resposta'}</h2>
    ${e.id ? `<input type="hidden" name="id" value="${e.id}">` : ''}
    <div class="field"><label>Título *</label><input type="text" name="titulo" value="${esc(e.titulo || '')}" required></div>
    <div class="field"><label>Categoria</label><select name="categoria">${options(categorias, e.categoria)}</select></div>
    <div class="field"><label>Atalho</label><input type="text" name="atalho" value="${esc(e.atalho || '')}" placeholder="/preco"></div>
    <div class="field"><label>Mensagem *</label><textarea name="mensagem" style="min-height:180px" required>${esc(e.mensagem || '')}</textarea></div>
    <button class="btn" type="submit">Salvar</button> ${e.id ? '<a class="link-btn" href="/crm/respostas">cancelar</a>' : ''}</form></div></div>`;
  return page({ title: 'CRM · Respostas rápidas', user, flash, gestor: false }, 'respostas', body);
}

// ------------------------------------------------------------------ Origem e resultados
function origensPage({ user, flash, rows, per, por }) {
  const pers = [['hoje', 'Hoje'], ['7d', '7 dias'], ['mes', 'Este mês'], ['mes_passado', 'Mês passado'], ['30d', '30 dias'], ['tudo', 'Tudo']];
  const tot = rows.reduce((a, r) => ({ leads: a.leads + r.leads, vendas: a.vendas + r.vendas, receita: a.receita + r.receita }), { leads: 0, vendas: 0, receita: 0 });
  const min = (v) => (v === null || v === undefined ? '—' : v < 60 ? Math.round(v) + ' min' : v < 1440 ? (v / 60).toFixed(1) + ' h' : (v / 1440).toFixed(1) + ' dias');
  const body = `<div class="page-header"><div><h1>Origem e resultados</h1><p class="subtitle">De onde vêm os leads e quais viram venda (coorte: leads que entraram no período).</p></div></div>
  <form class="crm-filtros" method="GET"><select name="periodo">${pers.map(([v, l]) => opt(v, l, per)).join('')}</select>
    <select name="por">${opt('origem', 'Por origem', por)}${opt('canal', 'Por canal', por)}${opt('campanha', 'Por campanha', por)}${opt('vendedor', 'Por vendedor', por)}</select>
    <button class="btn btn-sm" type="submit">Ver</button></form>
  <div class="card" style="padding:0"><table><thead><tr><th>${esc(por)}</th><th>Leads</th><th>Respondidos</th><th>Tempo médio 1ª resposta</th><th>Vendas</th><th>Conversão</th><th>Receita</th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td><b>${esc(r.grupo)}</b></td><td>${r.leads}</td><td>${r.respondidos} (${r.leads ? Math.round((r.respondidos / r.leads) * 100) : 0}%)</td><td>${min(r.min_resposta)}</td><td>${r.vendas}</td><td>${r.leads ? ((r.vendas / r.leads) * 100).toFixed(1) : '0.0'}%</td><td>${money(r.receita)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Sem dados no período.</td></tr>'}
  <tr style="font-weight:700"><td>Total</td><td>${tot.leads}</td><td></td><td></td><td>${tot.vendas}</td><td>${tot.leads ? ((tot.vendas / tot.leads) * 100).toFixed(1) : '0.0'}%</td><td>${money(tot.receita)}</td></tr>
  </tbody></table></div>`;
  return page({ title: 'CRM · Origens', user, flash, gestor: true }, 'origens', body);
}

// ------------------------------------------------------------------ Configurar CRM
function configPage({ user, flash, csrfToken, etapas, dist, metas, mes, webhook }) {
  const c = csrfInput(csrfToken);
  const meta = (uid) => metas.find((m) => m.user_id === uid) || {};
  const tipos = [['aberta', 'Em aberto'], ['ganho', 'Ganho'], ['perdido', 'Perdido'], ['desqualificado', 'Desqualificado']];
  const body = `<h1>Configurar CRM</h1>
  <form method="POST" class="card">${c}<input type="hidden" name="secao" value="etapas"><h2>Etapas do funil</h2>
    <p class="muted">Etapas do tipo "Ganho" contam como venda; "Perdido"/"Desqualificado" fecham o negócio.</p>
    <table><thead><tr><th>Ordem</th><th>Nome</th><th>Cor</th><th>Tipo</th><th>Ativa</th></tr></thead><tbody>
    ${etapas.map((e) => `<tr><td><input type="number" name="ordem_${e.id}" value="${e.ordem}" style="width:70px"></td><td><input type="text" name="nome_${e.id}" value="${esc(e.nome)}"></td>
      <td><input type="color" name="cor_${e.id}" value="${esc(e.cor)}" style="width:50px;padding:2px"></td><td><select name="tipo_${e.id}">${tipos.map(([v, l]) => opt(v, l, e.tipo)).join('')}</select></td>
      <td><input type="checkbox" name="ativo_${e.id}" value="1" ${e.ativo ? 'checked' : ''} style="width:auto"></td></tr>`).join('')}
    <tr><td></td><td><input type="text" name="nova_nome" placeholder="+ nova etapa"></td><td><input type="color" name="nova_cor" value="#2c6ea8" style="width:50px;padding:2px"></td><td colspan="2"></td></tr>
    </tbody></table><div class="actions-row"><button class="btn" type="submit">Salvar etapas</button></div></form>

  <form method="POST" class="card">${c}<input type="hidden" name="secao" value="distribuicao"><h2>Distribuição de leads (rodízio)</h2>
    <p class="muted">Leads novos (manual sem responsável, importação e webhook) são distribuídos em rodízio entre os marcados, na ordem abaixo. Desmarque quem está de folga.</p>
    <table><thead><tr><th>Ordem</th><th>Vendedor</th><th>Recebe leads</th><th>Recebidos no mês</th></tr></thead><tbody>
    ${dist.map((d) => `<tr><td><input type="number" name="ordem_${d.id}" value="${d.ordem === 999 ? '' : d.ordem}" style="width:70px"></td><td>${esc(d.name)}</td><td><input type="checkbox" name="ativo_${d.id}" value="1" ${d.ativo ? 'checked' : ''} style="width:auto"></td><td>${d.recebidos_mes}</td></tr>`).join('')}
    </tbody></table><div class="actions-row"><button class="btn" type="submit">Salvar distribuição</button></div></form>

  <form method="POST" class="card" id="metas">${c}<input type="hidden" name="secao" value="metas"><h2>Metas de ${esc(mes)}</h2>
    <input type="hidden" name="mes" value="${esc(mes)}">
    <table><thead><tr><th></th><th>Meta de vendas (qtd)</th><th>Meta de faturamento (R$)</th></tr></thead><tbody>
    <tr><td><b>Loja (total)</b></td><td><input type="number" name="vendas_0" value="${esc(meta(0).meta_vendas ?? '')}"></td><td><input type="number" step="0.01" name="fat_0" value="${esc(meta(0).meta_faturamento ?? '')}"></td></tr>
    ${dist.map((d) => `<tr><td>${esc(d.name)}</td><td><input type="number" name="vendas_${d.id}" value="${esc(meta(d.id).meta_vendas ?? '')}"></td><td><input type="number" step="0.01" name="fat_${d.id}" value="${esc(meta(d.id).meta_faturamento ?? '')}"></td></tr>`).join('')}
    </tbody></table><div class="actions-row"><button class="btn" type="submit">Salvar metas</button></div></form>

  <div class="card"><h2>Entrada automática de leads (webhook)</h2>
    <p class="muted">Use este endereço no Zapier/Make, no formulário do site ou no integrador do Meta Lead Ads. Método POST, JSON ou formulário com os campos <code>nome, telefone, email, origem, canal, campanha, produto, mensagem</code>.</p>
    <input type="text" readonly value="${esc(webhook)}" onclick="this.select()" style="font-family:monospace;font-size:12px">
    <form method="POST" style="margin-top:10px" onsubmit="return confirm('O link atual para de funcionar. Continuar?')">${c}<input type="hidden" name="secao" value="token"><button class="btn btn-sm btn-secondary" type="submit">Gerar novo token</button></form>
  </div>`;
  return page({ title: 'CRM · Configurar', user, flash, gestor: true }, 'config', body);
}

module.exports = {
  meuDiaPage, funilPage, negocioFormPage, negocioShowPage, leadsPage, importarPage, followupsPage,
  propostasPage, propostaFormPage, propostaVerPage, propostaTextoWhatsApp, respostasPage, origensPage, configPage,
};
