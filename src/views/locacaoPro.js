'use strict';

// Telas da "Locação Pro": painel gerencial, motos individuais (unidades),
// detalhe da locação (parcelas, ocorrências, devolução, contrato), despesas
// por moto, agendamentos, modelos de contrato e relatórios de lucratividade.

const { layout } = require('./layout');
const { escapeHtml, formatMoney, formatDateOnly } = require('../utils');

const esc = escapeHtml;
const money = (v) => formatMoney(Number(v) || 0);
const dt = (v) => (v ? formatDateOnly(v) : '—');
const hojeISO = () => new Date().toLocaleDateString('en-CA');

function diasAte(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const h = new Date();
  h.setHours(0, 0, 0, 0);
  return Math.round((d - h) / 86400000);
}

const csrfInput = (t) => `<input type="hidden" name="csrf" value="${esc(t)}">`;
const badge = (txt, cor) => {
  const cores = {
    verde: 'background:rgba(27,122,67,0.12);color:#1b7a43;',
    vermelho: 'background:rgba(161,53,42,0.12);color:#a1352a;',
    amarelo: 'background:rgba(176,137,0,0.16);color:#8a6d00;',
    cinza: 'background:rgba(0,0,0,0.06);color:#555;',
  };
  return `<span style="font-size:12px;padding:2px 8px;border-radius:10px;white-space:nowrap;${cores[cor] || cores.cinza}">${esc(txt)}</span>`;
};

const TIPOS_OCORRENCIA = {
  multa: 'Multa',
  colisao: 'Colisão',
  avaria: 'Avaria',
  danos_terceiros: 'Danos a terceiros',
  parada_tecnica: 'Moto parada (problema técnico)',
  outros: 'Outros',
};
const TIPOS_DOCUMENTO = {
  contrato_assinado: 'Contrato assinado',
  cnh: 'CNH',
  rg_cpf: 'RG / CPF',
  comprovante_residencia: 'Comprovante de residência',
  termo_entrega: 'Termo de entrega / vistoria',
  termo_devolucao: 'Termo de devolução',
  outros: 'Outros',
};
const CATEGORIAS_DESPESA = ['Revisão', 'Peças', 'Pneu', 'Freio/pastilha', 'Bateria', 'Elétrica', 'Funilaria', 'Seguro', 'Rastreador', 'Reboque', 'Documentação/IPVA', 'Outros'];
const FORMAS_PGTO = ['PIX', 'Dinheiro', 'Cartão', 'Boleto', 'Outro'];

function subnav(ativo) {
  const itens = [
    ['painel', '/locacao', 'Painel'],
    ['frota', '/frota', 'Frota / alugar'],
    ['locacoes', '/locacoes', 'Locações'],
    ['agendamentos', '/frota/agendamentos', 'Agendamentos'],
    ['cobranca', '/frota/cobranca', 'Cobrança'],
    ['agenda-cobranca', '/frota/agenda-cobranca', 'Agenda de cobrança'],
    ['despesas', '/frota/despesas', 'Despesas'],
    ['revisoes', '/frota/revisoes', 'Revisões'],
    ['documentos', '/frota/documentos', 'Contratos/Documentos'],
    ['relatorios', '/frota/relatorios', 'Lucratividade'],
    ['faturamento', '/frota/faturamento-mensal', 'Faturamento mensal'],
    ['contratos', '/frota/contratos-modelos', 'Modelos de contrato'],
  ];
  return `<div class="actions-row" style="flex-wrap:wrap;gap:6px;margin:0 0 14px;">${itens
    .map(([k, h, l]) => `<a class="btn btn-sm ${k === ativo ? '' : 'btn-secondary'}" href="${h}">${l}</a>`)
    .join('')}</div>`;
}

function page({ title, user, flash, ativo, header, children }) {
  return layout({
    title,
    activeNav: { painel: 'locacao-painel', despesas: 'despesas-frota', relatorios: 'lucratividade', faturamento: 'faturamento-mensal', documentos: 'documentos-locacao', contratos: 'contratos-modelos', revisoes: 'revisoes' }[ativo] || ativo,
    user,
    flash,
    children: `
      <div class="page-header"><div><h1>${esc(title)}</h1>${header ? `<p class="subtitle">${header}</p>` : ''}</div></div>
      ${subnav(ativo)}
      ${children}`,
  });
}

function tabela(cabecalho, linhas, vazio) {
  if (!linhas.length) return `<div class="empty">${esc(vazio || 'Nada por aqui.')}</div>`;
  return `<div style="overflow-x:auto;"><table><thead><tr>${cabecalho.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${linhas
    .map((l) => `<tr>${l.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

function optionList(lista, selecionado, labelFn, valorFn = (x) => x.id) {
  return lista
    .map((x) => {
      const v = valorFn(x);
      return `<option value="${esc(v)}" ${String(v) === String(selecionado ?? '') ? 'selected' : ''}>${esc(labelFn(x))}</option>`;
    })
    .join('');
}

// ---------------------------------------------------------------- PAINEL
function painelLocacaoPage({ user, flash, k, retornos, receber, ocorrencias, alertas, podeGerenciar }) {
  const stat = (num, label, cor, href) =>
    `<${href ? `a href="${href}" style="text-decoration:none;color:inherit;"` : 'div'} class="stat-card"><div class="num" style="${cor ? 'color:' + cor + ';' : ''}">${num}</div><div class="label">${label}</div></${href ? 'a' : 'div'}>`;

  const linRet = retornos.map((r) => {
    const d = diasAte(r.devolucao_prevista);
    const st = d === null ? badge('sem data', 'cinza') : d < 0 ? badge(`atrasada ${-d}d`, 'vermelho') : d === 0 ? badge('hoje', 'amarelo') : badge(`em ${d}d`, 'verde');
    return [`<a href="/locacoes/${r.id}">#${r.id}</a>`, esc(r.cliente_nome || '—'), esc(r.modelo || ''), esc(r.placa || r.chassi || ''), dt(r.devolucao_prevista), st];
  });
  const linRec = receber.map((p) => {
    const d = diasAte(p.vencimento);
    return [
      esc(p.cliente_nome || '—'),
      `<a href="/locacoes/${p.locacao_id}">#${p.locacao_id}</a> · ${p.numero}/${p.total}`,
      `${dt(p.vencimento)} ${d < 0 ? badge(`${-d}d atraso`, 'vermelho') : badge('hoje', 'amarelo')}`,
      money(p.valor),
      podeGerenciar
        ? `<form method="POST" action="/parcelas/${p.id}/pagar" style="margin:0;display:flex;gap:6px;">${csrfInput(k.csrf)}<input type="hidden" name="voltar" value="cobranca"><select name="forma_pagamento" style="width:auto;">${FORMAS_PGTO.map((f) => `<option>${f}</option>`).join('')}</select><button class="btn btn-sm" type="submit">Receber</button></form>`
        : '',
    ];
  });
  const linOc = ocorrencias.map((o) => [
    `<a href="/locacoes/${o.locacao_id}">#${o.locacao_id}</a>`,
    esc(o.cliente_nome || '—'),
    esc(TIPOS_OCORRENCIA[o.tipo] || o.tipo),
    o.data_hora ? esc(String(o.data_hora).replace('T', ' ')) : '—',
    o.valor != null ? money(o.valor) : '—',
  ]);
  const linAl = alertas.map((a) => [esc(a.modelo), esc(a.placa || a.chassi), a.motivos.map((m) => badge(m, 'amarelo')).join(' '), `<a class="btn btn-sm btn-secondary" href="/frota/unidades/${a.id}/editar">Abrir</a>`]);

  return page({
    title: 'Painel da locação',
    user,
    flash,
    ativo: 'painel',
    header: 'Visão geral: motos, retornos, cobrança e resultado do mês (em dinheiro que entrou de verdade).',
    children: `
      <div class="stat-grid">
        ${stat(k.ativas, 'Motos ativas')}
        ${stat(k.locadas, 'Locadas')}
        ${stat(k.disponiveis, 'Disponíveis', k.disponiveis ? '#1b7a43' : '', '/frota')}
        ${stat(k.manutencao, 'Em manutenção')}
        ${stat(k.atrasadas, 'Devolução atrasada', k.atrasadas ? '#a1352a' : '')}
        ${stat(k.ocupacao + '%', 'Taxa de ocupação')}
      </div>
      ${
        podeGerenciar
          ? `<div class="stat-grid">
        ${stat(money(k.recebidoHoje), 'Recebido hoje')}
        ${stat(money(k.recebidoMes), 'Recebido no mês')}
        ${stat(money(k.vencido), `Vencido (${k.qtdVencido})`, k.vencido ? '#a1352a' : '', '/frota/cobranca')}
        ${stat(money(k.despesasMes), 'Despesas do mês', '', '/frota/despesas')}
        ${stat(money(k.resultadoMes), 'Resultado do mês', k.resultadoMes < 0 ? '#a1352a' : '#1b7a43', '/frota/relatorios')}
        ${stat(money(k.carteira), 'Carteira a receber')}
      </div>`
          : ''
      }
      <div class="card"><h2 style="margin-top:0;">A receber hoje / vencidas</h2>${tabela(['Cliente', 'Locação', 'Vencimento', 'Valor', ''], linRec, 'Nenhuma parcela vencida ou vencendo hoje.')}</div>
      <div class="card"><h2 style="margin-top:0;">Próximos retornos</h2>${tabela(['Locação', 'Cliente', 'Modelo', 'Placa/chassi', 'Retorno', ''], linRet, 'Nenhuma locação ativa.')}</div>
      <div class="card"><h2 style="margin-top:0;">Ocorrências pendentes</h2>${tabela(['Locação', 'Cliente', 'Tipo', 'Quando', 'Valor'], linOc, 'Nenhuma ocorrência pendente.')}</div>
      <div class="card"><h2 style="margin-top:0;">Alertas de manutenção</h2>${tabela(['Modelo', 'Placa/chassi', 'Motivo', ''], linAl, 'Nenhuma moto com revisão ou troca pendente.')}</div>`,
  });
}

// ---------------------------------------------------------------- UNIDADES
function unidadesPage({ user, flash, modelo, unidades, csrfToken, outros = [], podeGerenciar = false, lote = null }) {
  const linhas = unidades.map((u) => {
    const st = !u.ativo ? badge('desativada', 'cinza') : u.locacao_id ? badge('locada', 'amarelo') : u.em_manutencao ? badge('manutenção', 'vermelho') : badge('disponível', 'verde');
    const rv = u.revisao;
    const rev = !rv
      ? '<span class="muted">nunca locada</span>'
      : `${dt(rv.prox)} ${rv.dias < 0 ? badge(`vencida ${-rv.dias}d`, 'vermelho') : rv.dias <= 7 ? badge(`em ${rv.dias}d`, 'amarelo') : badge(`em ${rv.dias}d`, 'verde')}<br><small class="muted">conta de ${rv.origem === 'revisao' ? 'última revisão' : '1º dia locada'} (${dt(rv.base)})</small>`;
    return [
      esc(u.placa || '—'),
      esc(u.chassi),
      esc(u.cor || ''),
      u.km_atual != null ? esc(String(u.km_atual)) : '—',
      rev,
      st + (u.locacao_id ? ` <a href="/locacoes/${u.locacao_id}">${esc(u.cliente_nome || '#' + u.locacao_id)}</a>` : ''),
      `<a class="btn btn-sm btn-secondary" href="/frota/unidades/${u.id}/editar">Editar</a>`,
    ];
  });
  return page({
    title: `Motos do modelo ${modelo.identificacao}`,
    user,
    flash,
    ativo: 'frota',
    header: 'Cada moto física com placa, chassi e km. Com motos cadastradas, a quantidade do modelo passa a ser calculada por elas.',
    children: `
      <div class="card">${tabela(['Placa', 'Chassi', 'Cor', 'Km', 'Próx. revisão', 'Situação', ''], linhas, 'Nenhuma moto cadastrada neste modelo (ele segue no modo quantidade).')}</div>
      ${podeGerenciar ? loteCard({ modelo, csrfToken, lote }) : ''}
      <div class="card"><h2 style="margin-top:0;">Cadastrar uma moto</h2>${unidadeForm({ u: { frota_id: modelo.id, cor: modelo.cor }, csrfToken, action: '/frota/unidades' })}</div>
      ${
        podeGerenciar && outros.length
          ? `<div class="card"><h2 style="margin-top:0;">Juntar com outro modelo</h2>
        <p class="muted">Use quando dois modelos são a mesma moto (ex.: "X13" e "X13 GOLD"). Motos, locações, agendamentos e despesas deste modelo vão para o escolhido, e este modelo é apagado.</p>
        <form method="POST" action="/frota/${modelo.id}/juntar" style="display:flex;gap:8px;flex-wrap:wrap;" onsubmit="return confirm('Juntar o modelo ${esc(modelo.identificacao).replace(/'/g, '')} no escolhido? Não dá para desfazer.');">${csrfInput(csrfToken)}
          <select name="destino" style="width:auto;">${optionList(outros, null, (o) => o.identificacao)}</select>
          <button class="btn btn-sm">Juntar</button>
        </form></div>`
          : ''
      }`,
  });
}

// Entrada em lote: cola a lista, confere a prévia e cadastra tudo de uma vez.
function loteCard({ modelo, csrfToken, lote }) {
  const c = (lote && lote.comum) || {};
  const v = (x) => esc(x ?? '');
  const campos = `
      <div class="form-grid">
        <div class="field"><label>Cor (quando a linha não tiver)</label><input name="cor" value="${v(c.cor ?? modelo.cor)}"></div>
        <div class="field"><label>Ano</label><input type="number" name="ano" min="1990" max="2100" value="${v(c.ano)}"></div>
        <div class="field"><label>Data da compra</label><input type="date" name="data_compra" value="${v(c.data_compra)}"></div>
        <div class="field"><label>Valor de compra de cada moto (R$)</label><input type="number" name="valor_compra" min="0" step="0.01" value="${v(c.valor_compra)}"></div>
        <div class="field"><label>Revisão a cada (dias)</label><input type="number" name="intervalo_revisao_dias" min="1" value="${v(c.intervalo_revisao_dias || 90)}"></div>
        <div class="field"><label>Observações (vale para todas)</label><input name="observacoes" value="${v(c.observacoes)}"></div>
      </div>`;
  let previa = '';
  let botoes = `<button class="btn" type="submit" name="modo" value="conferir">Conferir lista</button>`;
  if (lote) {
    const cores = { nova: ['nova', 'verde'], existe: ['já existe', 'vermelho'], repetida: ['repetida', 'amarelo'], invalida: ['inválida', 'vermelho'] };
    const linhas = lote.itens.map((i) => [esc(i.chassi || i.linha), esc(i.interno ? '#' + i.interno : ''), esc(i.cor || c.cor || modelo.cor || ''), badge(...cores[i.status]) + (i.motivo ? ` <small class="muted">${esc(i.motivo)}</small>` : '')]);
    const n = lote.itens.filter((i) => i.status === 'nova').length;
    const pul = lote.itens.length - n;
    previa = `<h3>Prévia: ${n} nova(s)${pul ? `, ${pul} ignorada(s)` : ''}</h3>
      ${tabela(['Chassi', 'Nº interno', 'Cor', 'Situação'], linhas, '')}`;
    botoes = n
      ? `<button class="btn" type="submit" name="modo" value="gravar">Cadastrar ${n} moto(s)</button> <button class="btn btn-secondary" type="submit" name="modo" value="conferir">Conferir de novo</button>`
      : `<button class="btn" type="submit" name="modo" value="conferir">Conferir de novo</button>`;
  }
  return `<div class="card" id="lote"><h2 style="margin-top:0;">Entrada em lote</h2>
    <p class="muted">Cole uma moto por linha: <b>chassi</b>, e se quiser o número interno e a cor. Ex.: <code>R3TDR1AW1N1222210 #31 Preta</code>. O sistema limpa o chassi, separa o "#número" e bloqueia chassi que já existe em qualquer modelo (inclusive desativadas).</p>
    <form method="POST" action="/frota/${modelo.id}/lote">${csrfInput(csrfToken)}
      <div class="field full"><label>Chassis (um por linha) *</label><textarea name="chassis" rows="6" required>${esc((lote && lote.texto) || '')}</textarea></div>
      ${campos}
      ${previa}
      <div class="actions-row">${botoes}</div>
    </form></div>`;
}

function unidadeForm({ u, csrfToken, action, modelos }) {
  const f = (name, label, type = 'text', extra = '') =>
    `<div class="field"><label>${label}</label><input type="${type}" name="${name}" value="${esc(u[name] ?? '')}" ${extra}></div>`;
  return `
    <form method="POST" action="${action}">
      ${csrfInput(csrfToken)}
      ${modelos ? `<div class="field"><label>Modelo *</label><select name="frota_id" required>${optionList(modelos, u.frota_id, (m) => m.identificacao)}</select></div>` : `<input type="hidden" name="frota_id" value="${esc(u.frota_id)}">`}
      <div class="form-grid">
        ${f('chassi', 'Chassi *', 'text', 'required')}
        ${f('placa', 'Placa')}
        ${f('renavam', 'Renavam')}
        ${f('cor', 'Cor')}
        ${f('ano', 'Ano', 'number', 'min="1990" max="2100"')}
        ${f('km_atual', 'Km atual', 'number', 'min="0"')}
        ${f('data_compra', 'Data da compra', 'date')}
        ${f('valor_compra', 'Valor de compra (R$) — usado no payback', 'number', 'min="0" step="0.01"')}
      </div>
      <h3>Manutenção (moto elétrica)</h3>
      <div class="form-grid">
        ${f('data_ultima_revisao', 'Última revisão (vazio = conta do 1º dia locada)', 'date')}
        ${f('intervalo_revisao_dias', 'Revisão a cada (dias)', 'number', 'min="1"')}
        ${f('km_prox_pastilha', 'Próxima troca de pastilha (km)', 'number', 'min="0"')}
        ${f('km_prox_pneu', 'Próxima troca de pneu (km)', 'number', 'min="0"')}
      </div>
      <div class="form-grid">
        <div class="field"><label><input type="checkbox" name="em_manutencao" value="1" style="width:auto;" ${u.em_manutencao ? 'checked' : ''}> Em manutenção (fora da locação)</label></div>
        <div class="field"><label><input type="checkbox" name="ativo" value="1" style="width:auto;" ${u.ativo === 0 ? '' : 'checked'}> Ativa na frota</label></div>
      </div>
      <div class="field full"><label>Observações</label><textarea name="observacoes" rows="2">${esc(u.observacoes || '')}</textarea></div>
      <div class="actions-row"><button class="btn" type="submit">Salvar moto</button></div>
    </form>`;
}

function unidadeEditarPage({ user, flash, u, modelos, despesas, locacoes, csrfToken }) {
  const linD = despesas.map((d) => [dt(d.data), esc(d.categoria || ''), esc(d.descricao || ''), money(d.valor)]);
  const linL = locacoes.map((l) => [`<a href="/locacoes/${l.id}">#${l.id}</a>`, esc(l.cliente_nome || '—'), dt(l.data_saida), dt(l.data_devolucao || l.devolucao_prevista), esc(l.status)]);
  return page({
    title: `Moto ${u.placa || u.chassi}`,
    user,
    flash,
    ativo: 'frota',
    children: `
      <div class="card">${unidadeForm({ u, csrfToken, action: `/frota/unidades/${u.id}`, modelos })}</div>
      <div class="card"><h2 style="margin-top:0;">Histórico de locações</h2>${tabela(['Locação', 'Cliente', 'Saída', 'Retorno', 'Status'], linL, 'Sem locações.')}</div>
      <div class="card"><h2 style="margin-top:0;">Despesas desta moto</h2>${tabela(['Data', 'Categoria', 'Descrição', 'Valor'], linD, 'Sem despesas.')}
        <div class="actions-row"><a class="btn btn-sm btn-secondary" href="/frota/despesas?unidade=${u.id}">+ Lançar despesa</a></div></div>
      <form method="POST" action="/frota/unidades/${u.id}/excluir" onsubmit="return confirm('Excluir esta moto? O histórico de locações fica, sem o vínculo.');">${csrfInput(csrfToken)}<button class="btn btn-sm btn-secondary" type="submit">Excluir moto</button></form>`,
  });
}

// ---------------------------------------------------------------- LOCAÇÕES (lista)
function locacoesListPage({ user, flash, locacoes, filtro, modelos = [] }) {
  const linhas = locacoes.map((l) => {
    const d = diasAte(l.devolucao_prevista);
    let st = l.status === 'ativa' ? badge('locada', 'amarelo') : badge(l.status, 'cinza');
    if (l.status === 'ativa' && d !== null && d < 0) st = badge('atrasada', 'vermelho');
    if (l.vencidas) st += ' ' + badge(l.vencidas + ' vencida(s)', 'vermelho');
    return [
      `<a href="/locacoes/${l.id}">#${l.id}</a>`,
      l.oc_pendentes ? badge(String(l.oc_pendentes), 'vermelho') : '0',
      esc(l.cliente_nome || '—'),
      esc(l.modelo || ''),
      esc(l.placa || l.chassi || ''),
      `${dt(l.data_saida)} ${esc(l.hora_saida || '')}`,
      `${dt(l.devolucao_prevista)} ${esc(l.hora_retorno || '')}`,
      money(l.valor_combinado),
      `${money(l.aberto)}`,
      st,
    ];
  });
  const opt = (v, l) => `<option value="${v}" ${filtro.status === v ? 'selected' : ''}>${l}</option>`;
  const optMod = (v, l) => `<option value="${v}" ${String(filtro.modelo) === String(v) ? 'selected' : ''}>${l}</option>`;
  const optAtr = (v, l) => `<option value="${v}" ${filtro.atraso === v ? 'selected' : ''}>${l}</option>`;
  return page({
    title: 'Locações',
    user,
    flash,
    ativo: 'locacoes',
    children: `
      <form method="GET" action="/locacoes" class="card" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
        <div class="field" style="margin:0;"><label>Status</label><select name="status">${opt('ativa', 'Locadas')}${opt('devolvida', 'Devolvidas')}${opt('quitada', 'Quitadas (compra garantida)')}${opt('todas', 'Todas')}</select></div>
        <div class="field" style="margin:0;"><label>Modelo</label><select name="modelo">${optMod('', 'Todos os modelos')}${modelos.map((md) => optMod(md.id, esc(md.identificacao))).join('')}</select></div>
        <div class="field" style="margin:0;"><label>Pagamento</label><select name="atraso">${optAtr('', 'Em dia + Atrasados')}${optAtr('atrasado', 'Só atrasados')}${optAtr('em_dia', 'Só em dia')}</select></div>
        <div class="field" style="margin:0;"><label>Busca</label><input type="text" name="q" value="${esc(filtro.q || '')}" placeholder="cliente, placa, chassi"></div>
        <div class="field" style="margin:0;"><label>Saída de</label><input type="date" name="de" value="${esc(filtro.de || '')}"></div>
        <div class="field" style="margin:0;"><label>até</label><input type="date" name="ate" value="${esc(filtro.ate || '')}"></div>
        <button class="btn btn-sm" type="submit">Filtrar</button>
        <a class="btn btn-sm btn-secondary" href="/locacoes/exportar.csv?${new URLSearchParams(filtro).toString()}">Exportar CSV</a>
      </form>
      <div class="card">${tabela(['ID', 'Ocorr.', 'Cliente', 'Modelo', 'Placa/chassi', 'Saída', 'Retorno', 'Valor total', 'Em aberto', 'Status'], linhas, 'Nenhuma locação encontrada.')}</div>`,
  });
}

// ---------------------------------------------------------------- LOCAÇÃO (detalhe)
// Alterar valor da parcela, com prévia ao vivo (o servidor refaz a mesma conta ao salvar).
function reparcelarForm(loc, r, csrfToken) {
  if (!r) return '';
  const dados = esc(JSON.stringify({ saldo: r.saldo, qtd: r.qtd, primeiro: r.primeiro, dias: r.dias }));
  return `<details style="margin-top:10px;"><summary>Alterar valor da parcela</summary>
    <form method="POST" action="/locacoes/${loc.id}/reparcelar" style="margin-top:8px;" onsubmit="return confirm('Refazer as parcelas em aberto com o novo valor?');" data-reparc="${dados}">${csrfInput(csrfToken)}
      <p class="muted">Hoje: <b>${r.qtd}</b> parcela(s) em aberto de <b>${money(r.valorAtual)}</b>, saldo <b>${money(r.saldo)}</b>, próxima em ${dt(r.primeiro)}. Parcelas pagas, entrada e cobranças avulsas não mudam.</p>
      <div class="form-grid">
        <div class="field"><label>Novo valor da parcela (R$) *</label><input type="number" name="novo_valor" step="0.01" min="0.01" required></div>
        <div class="field"><label>O que manter</label><select name="manter">
          <option value="saldo">Saldo devedor — a quantidade de parcelas se ajusta</option>
          <option value="quantidade">Quantidade de parcelas — o saldo muda</option></select></div>
      </div>
      <p class="reparc-previa" style="font-weight:600;"></p>
      <button class="btn btn-sm">Aplicar novo valor</button>
    </form>
    <script>(function(){var f=document.querySelector('form[data-reparc]');if(!f)return;var d=JSON.parse(f.dataset.reparc);
      function br(v){return v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
      function dt(iso,k){var x=new Date(iso+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+k*d.dias);return x.toISOString().slice(0,10).split('-').reverse().join('/');}
      function calc(){var v=parseFloat(f.novo_valor.value),o=f.querySelector('.reparc-previa');if(!(v>0)){o.textContent='';return;}
        var n,saldo,ult;if(f.manter.value==='quantidade'){n=d.qtd;saldo=v*n;ult=v;}else{var c=Math.round(d.saldo*100),p=Math.round(v*100);var ch=Math.floor(c/p),r=c-ch*p;n=ch+(r>0?1:0);saldo=d.saldo;ult=r>0?r/100:v;}
        o.textContent='Fica: '+n+' parcela(s) de '+br(v)+(ult!==v?' (a última de '+br(ult)+')':'')+', saldo '+br(saldo)+', última em '+dt(d.primeiro,n-1)+' ('+(n-d.qtd>=0?'+':'')+(n-d.qtd)+' parcela(s)).';}
      f.novo_valor.addEventListener('input',calc);f.manter.addEventListener('change',calc);})();</script>
  </details>`;
}

function locacaoDetalhePage({ user, flash, loc, parcelas, ocorrencias, modelosContrato, csrfToken, podeGerenciar, reparc = null, documentos = [] }) {
  const total = parcelas.reduce((s, p) => s + (Number(p.valor) || 0), 0);
  const pago = parcelas.filter((p) => p.pago).reduce((s, p) => s + (Number(p.valor) || 0), 0);
  const linP = parcelas.map((p) => {
    const d = diasAte(p.vencimento);
    const st = p.pago ? badge('pago ' + dt(p.data_pagamento), 'verde') : d !== null && d < 0 ? badge('vencida', 'vermelho') : badge('pendente', 'amarelo');
    const acao = !podeGerenciar
      ? ''
      : p.pago
      ? `<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            ${p.comprovante_caminho ? `<a class="link-btn" href="/uploads/${esc(p.comprovante_caminho)}" target="_blank" rel="noopener">comprovante</a>` : ''}
            <form method="POST" action="/parcelas/${p.id}/estornar" style="margin:0;" onsubmit="return confirm('Desfazer o pagamento?');">${csrfInput(csrfToken)}<input type="hidden" name="voltar" value="loc${loc.id}"><button class="btn btn-sm btn-secondary">Desfazer</button></form>
          </div>
          <details style="font-size:12px;">
            <summary style="cursor:pointer;color:#8a6d00;">Editar / anexar comprovante</summary>
            <form method="POST" action="/parcelas/${p.id}/editar-recebimento" style="margin:6px 0;display:flex;gap:6px;align-items:flex-end;flex-wrap:wrap;">${csrfInput(csrfToken)}<label style="font-size:11px;">Data<br><input type="date" name="data_pagamento" value="${esc(String(p.data_pagamento || '').slice(0, 10))}" style="width:auto;"></label><label style="font-size:11px;">Valor recebido (R$)<br><input type="number" name="valor" step="0.01" min="0" value="${Number(p.valor) || 0}" style="width:110px;"></label><button class="btn btn-sm" type="submit">Salvar</button></form>
            <form method="POST" action="/parcelas/${p.id}/comprovante" enctype="multipart/form-data" style="margin:0;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">${csrfInput(csrfToken)}<input type="file" name="comprovante" accept="image/*,application/pdf" required style="font-size:11px;"><button class="btn btn-sm btn-secondary" type="submit">Anexar comprovante</button></form>
          </details>
        </div>`
      : `<form method="POST" action="/parcelas/${p.id}/pagar" style="margin:0;display:flex;gap:6px;">${csrfInput(csrfToken)}<input type="hidden" name="voltar" value="loc${loc.id}"><select name="forma_pagamento" style="width:auto;">${FORMAS_PGTO.map((f) => `<option>${f}</option>`).join('')}</select><button class="btn btn-sm">Receber</button></form>`;
    return [String(p.numero) + (p.origem ? ' ' + badge(p.origem === 'entrada' ? 'entrada' : p.origem.startsWith('ocorrencia:') ? TIPOS_OCORRENCIA[p.origem.slice(11)] || 'ocorrência' : 'avulsa', p.origem === 'entrada' ? 'verde' : 'cinza') : ''), dt(p.vencimento), money(p.valor), st + (p.forma_pagamento ? ' ' + esc(p.forma_pagamento) : ''), acao];
  });
  const linO = ocorrencias.map((o) => [
    esc(TIPOS_OCORRENCIA[o.tipo] || o.tipo),
    o.data_hora ? esc(String(o.data_hora).replace('T', ' ')) : '—',
    o.valor != null ? money(o.valor) : '—',
    esc(o.descricao || ''),
    o.concluido
      ? badge('concluída', 'verde')
      : `<form method="POST" action="/locacoes/ocorrencias/${o.id}/concluir" style="margin:0;">${csrfInput(csrfToken)}<button class="btn btn-sm btn-secondary">Concluir</button></form>`,
  ]);
  const ativa = loc.status === 'ativa';
  const fotos = ['foto_moto_caminho', 'foto_moto2_caminho', 'foto_moto3_caminho', 'foto_moto4_caminho', 'foto_cnh_caminho']
    .filter((c) => loc[c])
    .map((c) => `<a href="/uploads/${esc(loc[c])}" target="_blank"><img src="/uploads/${esc(loc[c])}" style="height:90px;border-radius:6px;border:1px solid var(--border);"></a>`)
    .join(' ');
  const f = (name, label, type = 'text') => `<div class="field"><label>${label}</label><input type="${type}" name="${name}" value="${esc(loc[name] ?? '')}" ${type === 'number' ? 'step="0.01" min="0"' : ''}></div>`;

  return page({
    title: `Locação #${loc.id}`,
    user,
    flash,
    ativo: 'locacoes',
    header: `${esc(loc.cliente_nome || 'Cliente')} · ${esc(loc.modelo || '')} ${esc(loc.placa || loc.chassi || '')} · ${ativa ? 'em andamento' : esc(loc.status)}${loc.compra_garantida ? ' · compra garantida' : ''}`,
    children: `
      <div class="stat-grid">
        <div class="stat-card"><div class="num">${money(total)}</div><div class="label">Total das parcelas</div></div>
        <div class="stat-card"><div class="num" style="color:#1b7a43;">${money(pago)}</div><div class="label">Recebido</div></div>
        <div class="stat-card"><div class="num" style="color:#8a6d00;">${money(total - pago)}</div><div class="label">Em aberto</div></div>
        <div class="stat-card"><div class="num">${money(loc.valor_caucao)}</div><div class="label">Entrada ${(() => { const e = parcelas.find((p) => p.origem === 'entrada'); return e ? (e.pago ? '(paga)' : '(pendente)') : ''; })()}</div></div>
      </div>

      <div class="card">
        <h2 style="margin-top:0;">Contrato</h2>
        ${
          modelosContrato.length
            ? `<form method="GET" action="/locacoes/${loc.id}/contrato" target="_blank" style="display:flex;gap:8px;flex-wrap:wrap;">
                 <select name="modelo" style="width:auto;">${optionList(modelosContrato, null, (m) => m.titulo)}</select>
                 <button class="btn btn-sm" type="submit">Gerar documento</button>
               </form><p class="muted" style="margin:6px 0 0;">Abre pronto pra imprimir ou salvar em PDF. Pra assinatura digital, salve o PDF e envie em Contratos.</p>`
            : '<p class="muted">Nenhum modelo de contrato. <a href="/frota/contratos-modelos/novo">Cadastrar modelo</a>.</p>'
        }
      </div>

      <div class="card">
        <h2 style="margin-top:0;">Parcelas</h2>
        ${tabela(['Nº', 'Vencimento', 'Valor', 'Situação', ''], linP, 'Sem parcelas.')}
        ${
          podeGerenciar
            ? `<details style="margin-top:10px;"><summary>+ Adicionar cobrança avulsa</summary>
          <form method="POST" action="/locacoes/${loc.id}/parcela-avulsa" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">${csrfInput(csrfToken)}
            <input type="number" name="valor" step="0.01" min="0.01" required placeholder="Valor" style="width:140px;">
            <input type="date" name="vencimento" value="${hojeISO()}" style="width:auto;">
            <button class="btn btn-sm">Adicionar</button></form></details>${reparcelarForm(loc, reparc, csrfToken)}`
            : ''
        }
      </div>

      <div class="card">
        <h2 style="margin-top:0;">Ocorrências</h2>
        ${tabela(['Tipo', 'Quando', 'Valor', 'Descrição', ''], linO, 'Nenhuma ocorrência.')}
        <details style="margin-top:10px;"><summary>+ Registrar ocorrência</summary>
          <form method="POST" action="/locacoes/${loc.id}/ocorrencias" style="margin-top:8px;">${csrfInput(csrfToken)}
            <div class="form-grid">
              <div class="field"><label>Tipo</label><select name="tipo">${Object.entries(TIPOS_OCORRENCIA).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
              <div class="field"><label>Data e hora</label><input type="datetime-local" name="data_hora"></div>
              <div class="field"><label>Valor (R$)</label><input type="number" name="valor" step="0.01" min="0"></div>
              <div class="field"><label>O que fazer com o valor</label><select name="acao_valor">
                <option value="">Só registrar</option>
                <option value="cobrar">Cobrar do cliente (vira parcela)</option>
                <option value="abater">Abater da próxima parcela (ex.: dias parados)</option>
              </select></div>
            </div>
            <div class="field full"><label>Descrição</label><textarea name="descricao" rows="2"></textarea></div>
            <button class="btn btn-sm">Salvar ocorrência</button>
          </form>
        </details>
      </div>

      <div class="card">
        <h2 style="margin-top:0;">Dados do contrato</h2>
        <form method="POST" action="/locacoes/${loc.id}/dados">${csrfInput(csrfToken)}
          <div class="form-grid">
            ${f('data_saida', 'Data de saída', 'date')}${f('hora_saida', 'Hora de saída', 'time')}
            ${f('devolucao_prevista', 'Retorno previsto', 'date')}${f('hora_retorno', 'Hora de retorno', 'time')}
            ${f('km_saida', 'Km de saída', 'number')}${f('valor_caucao', 'Entrada (R$)', 'number')}
            ${f('testemunha1_nome', 'Testemunha 1')}${f('testemunha1_rg', 'RG testemunha 1')}
            ${f('testemunha2_nome', 'Testemunha 2')}${f('testemunha2_rg', 'RG testemunha 2')}
            ${f('fiador_nome', 'Fiador')}${f('fiador_dados', 'Dados do fiador (CPF, endereço...)')}
          </div>
          <div class="field"><label><input type="checkbox" name="compra_garantida" value="1" style="width:auto;" ${loc.compra_garantida ? 'checked' : ''}> Locação com compra garantida (moto vira do cliente ao quitar)</label></div>
          <div class="field full"><label>Observações</label><textarea name="observacoes" rows="2">${esc(loc.observacoes || '')}</textarea></div>
          <button class="btn btn-sm">Salvar dados</button>
        </form>
      </div>

      ${
        ativa
          ? `<div class="card"><h2 style="margin-top:0;">Devolução</h2>
        <form method="POST" action="/locacoes/${loc.id}/devolver" onsubmit="return confirm('Confirmar a devolução da moto?');">${csrfInput(csrfToken)}
          <div class="form-grid">
            <div class="field"><label>Km na devolução</label><input type="number" name="km_retorno" min="0"></div>
          </div>
          <button class="btn">Registrar devolução</button>
        </form></div>`
          : ''
      }
      ${fotos ? `<div class="card"><h2 style="margin-top:0;">Fotos da entrega</h2>${fotos}</div>` : ''}
      <div class="card" id="documentos"><h2 style="margin-top:0;">Contratos e documentos</h2>
        ${documentos.some((d) => d.tipo === 'contrato_assinado') ? '' : `<p style="margin-top:0;color:#a1352a;font-weight:600;">Falta anexar o contrato assinado desta locação.</p>`}
        ${tabela(
          ['Tipo', 'Arquivo', 'Descrição', 'Enviado', ''],
          documentos.map((d) => [
            d.tipo === 'contrato_assinado' ? badge(TIPOS_DOCUMENTO[d.tipo], 'verde') : esc(TIPOS_DOCUMENTO[d.tipo] || d.tipo),
            `<a href="/uploads/${esc(d.caminho_arquivo)}" target="_blank">${esc(d.nome_arquivo || 'arquivo')}</a>`,
            esc(d.descricao || ''),
            `${dt(String(d.created_at).slice(0, 10))}${d.enviado_nome ? ' · ' + esc(d.enviado_nome) : ''}`,
            podeGerenciar ? `<form method="POST" action="/locacoes/documentos/${d.id}/excluir" style="margin:0;" onsubmit="return confirm('Excluir este documento?');">${csrfInput(csrfToken)}<button class="btn btn-sm btn-secondary">Excluir</button></form>` : '',
          ]),
          'Nenhum documento anexado ainda.'
        )}
        <form method="POST" action="/locacoes/${loc.id}/documentos" enctype="multipart/form-data" style="margin-top:10px;">${csrfInput(csrfToken)}
          <div class="form-grid">
            <div class="field"><label>Tipo</label><select name="tipo">${Object.entries(TIPOS_DOCUMENTO).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
            <div class="field"><label>Arquivo (PDF ou foto) *</label><input type="file" name="arquivo" accept="application/pdf,image/*" multiple required></div>
            <div class="field"><label>Descrição</label><input type="text" name="descricao" placeholder="Opcional"></div>
          </div>
          <button class="btn btn-sm">Anexar</button>
        </form>
      </div>`,
  });
}

function documentosPage({ user, flash, lista, status, pendentes }) {
  const semContrato = lista.filter((l) => !l.contratos).length;
  const linhas = lista.map((l) => [
    `<a href="/locacoes/${l.id}#documentos">#${l.id}</a>`,
    esc(l.cliente_nome || '—'),
    esc([l.modelo, l.moto].filter(Boolean).join(' · ')),
    dt(l.data_saida),
    l.contratos ? badge('contrato assinado', 'verde') : badge('sem contrato assinado', 'vermelho'),
    l.tipos ? esc(String(l.tipos).split(',').filter((t) => t !== 'contrato_assinado').map((t) => TIPOS_DOCUMENTO[t] || t).join(', ')) : '<span class="muted">—</span>',
    `<a class="btn btn-sm" href="/locacoes/${l.id}#documentos">Anexar</a>`,
  ]);
  return page({
    title: 'Contratos e documentos',
    user,
    flash,
    ativo: 'documentos',
    header: 'Contrato assinado e documentos de cada locação, num lugar só. Sem contrato assinado guardado, fica difícil cobrar ou recuperar a moto.',
    children: `
      <form method="GET" action="/frota/documentos" class="card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
        <div class="field" style="margin:0;"><label>Locações</label><select name="status">
          <option value="ativa" ${status === 'ativa' ? 'selected' : ''}>Ativas</option>
          <option value="devolvida" ${status === 'devolvida' ? 'selected' : ''}>Devolvidas</option>
          <option value="quitada" ${status === 'quitada' ? 'selected' : ''}>Quitadas</option>
          <option value="todas" ${status === 'todas' ? 'selected' : ''}>Todas</option>
        </select></div>
        <label style="display:flex;gap:6px;align-items:center;font-weight:normal;"><input type="checkbox" name="sem_contrato" value="1" ${pendentes ? 'checked' : ''} style="width:auto;"> Só as sem contrato assinado</label>
        <button class="btn btn-sm">Filtrar</button>
      </form>
      <div class="card">
        <h2 style="margin-top:0;">${lista.length} locação(ões)${semContrato ? ` · <span style="color:#a1352a;">${semContrato} sem contrato assinado</span>` : ''}</h2>
        ${tabela(['Locação', 'Cliente', 'Moto', 'Saída', 'Contrato', 'Outros documentos', ''], linhas, 'Nenhuma locação aqui.')}
      </div>`,
  });
}

// ---------------------------------------------------------------- DESPESAS
function despesasPage({ user, flash, despesas, unidades, fornecedores, filtro, total, csrfToken, preUnidade, custosFixos = [], qtdMotos = 0 }) {
  const linhas = despesas.map((d) => [
    dt(d.data),
    esc(d.modelo || ''),
    esc(d.placa || d.chassi || '(geral)'),
    esc(d.categoria || ''),
    esc(d.fornecedor_nome || ''),
    esc(d.descricao || ''),
    money(d.valor),
    d.conta_pagar_id ? badge('no financeiro', 'verde') : '',
    `<form method="POST" action="/frota/despesas/${d.id}/excluir" style="margin:0;" onsubmit="return confirm('Excluir despesa?');">${csrfInput(csrfToken)}<button class="btn btn-sm btn-secondary">Excluir</button></form>`,
  ]);
  return page({
    title: 'Despesas e manutenções da frota',
    user,
    flash,
    ativo: 'despesas',
    header: 'Tudo que a frota custa. Entra no cálculo de lucratividade por moto.',
    children: `
      <div class="card"><h2 style="margin-top:0;">Custos mensais fixos por moto</h2>
        <p class="muted" style="margin-top:0;">Ex.: rastreador. Todo mês o sistema lança sozinho uma despesa desse valor em cada moto ativa da frota (hoje: ${qtdMotos} motos).</p>
        ${tabela(
          ['Categoria', 'Descrição', 'Valor/mês por moto', 'Desde', 'Custo/mês hoje', 'Lançado até agora', ''],
          custosFixos.map((c) => [
            esc(c.categoria),
            esc(c.descricao || ''),
            money(c.valor),
            esc(c.desde),
            c.ativo ? money(c.valor * qtdMotos) : badge('encerrado', 'cinza'),
            `${money(c.total_lancado)} <span class="muted">(${c.lancados})</span>`,
            c.ativo ? `<form method="POST" action="/frota/custos-fixos/${c.id}/encerrar" style="margin:0;" onsubmit="return confirm('Parar de lançar este custo nos próximos meses?');">${csrfInput(csrfToken)}<button class="btn btn-sm btn-secondary">Encerrar</button></form>` : '',
          ]),
          'Nenhum custo mensal cadastrado.'
        )}
        <form method="POST" action="/frota/custos-fixos" style="margin-top:10px;">${csrfInput(csrfToken)}
          <div class="form-grid">
            <div class="field"><label>Categoria</label><select name="categoria">${CATEGORIAS_DESPESA.map((c) => `<option ${c === 'Rastreador' ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
            <div class="field"><label>Descrição</label><input type="text" name="descricao" placeholder="Ex.: Mensalidade do rastreador"></div>
            <div class="field"><label>Valor por moto por mês (R$) *</label><input type="number" name="valor" step="0.01" min="0.01" required></div>
            <div class="field"><label>A partir do mês</label><input type="month" name="desde" value="${hojeISO().slice(0, 7)}"></div>
          </div>
          <button class="btn btn-sm">Cadastrar custo mensal</button>
        </form>
      </div>
      <div class="card"><h2 style="margin-top:0;">Lançar despesa</h2>
        <form method="POST" action="/frota/despesas">${csrfInput(csrfToken)}
          <div class="form-grid">
            <div class="field"><label>Moto</label><select name="unidade_id"><option value="">(despesa geral da frota)</option>${optionList(unidades, preUnidade, (u) => `${u.modelo} · ${u.placa || u.chassi}`)}</select></div>
            <div class="field"><label>Categoria</label><select name="categoria">${CATEGORIAS_DESPESA.map((c) => `<option>${c}</option>`).join('')}</select></div>
            <div class="field"><label>Fornecedor</label><select name="fornecedor_id"><option value="">—</option>${optionList(fornecedores, null, (f) => f.nome)}</select></div>
            <div class="field"><label>Data *</label><input type="date" name="data" value="${hojeISO()}" required></div>
            <div class="field"><label>Km atual</label><input type="number" name="km" min="0"></div>
            <div class="field"><label>Valor (R$) *</label><input type="number" name="valor" step="0.01" min="0.01" required></div>
          </div>
          <div class="field full"><label>Descrição</label><input type="text" name="descricao"></div>
          <div class="field"><label><input type="checkbox" name="lancar_financeiro" value="1" style="width:auto;"> Lançar em Contas a Pagar</label></div>
          <div class="field"><label><input type="checkbox" name="registrar_revisao" value="1" style="width:auto;"> Foi a revisão periódica (atualiza a data da última revisão da moto)</label></div>
          <button class="btn">Salvar despesa</button>
        </form>
      </div>
      <form method="GET" action="/frota/despesas" class="card" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
        <div class="field" style="margin:0;"><label>De</label><input type="date" name="de" value="${esc(filtro.de || '')}"></div>
        <div class="field" style="margin:0;"><label>Até</label><input type="date" name="ate" value="${esc(filtro.ate || '')}"></div>
        <button class="btn btn-sm">Filtrar</button>
        <strong style="margin-left:auto;">Total: ${money(total)}</strong>
      </form>
      <div class="card">${tabela(['Data', 'Modelo', 'Moto', 'Categoria', 'Fornecedor', 'Descrição', 'Valor', '', ''], linhas, 'Nenhuma despesa no período.')}</div>`,
  });
}

// ---------------------------------------------------------------- AGENDAMENTOS
function agendamentosPage({ user, flash, agendamentos, modelos, clientes, csrfToken }) {
  const linhas = agendamentos.map((a) => {
    const st = a.status === 'agendado' ? badge('agendado', 'amarelo') : a.status === 'convertido' ? badge('virou locação', 'verde') : badge(a.status, 'cinza');
    const acoes =
      a.status === 'agendado'
        ? `<div style="display:flex;gap:6px;">
             <a class="btn btn-sm" href="/frota?alugar=${a.frota_id}&cliente=${a.cliente_id || ''}&agendamento=${a.id}">Entregar moto</a>
             <form method="POST" action="/frota/agendamentos/${a.id}/cancelar" style="margin:0;" onsubmit="return confirm('Cancelar agendamento?');">${csrfInput(csrfToken)}<button class="btn btn-sm btn-secondary">Cancelar</button></form>
           </div>`
        : a.locacao_id
        ? `<a href="/locacoes/${a.locacao_id}">Locação #${a.locacao_id}</a>`
        : '';
    return [
      esc(a.cliente_nome || '—'),
      esc(a.modelo || ''),
      `${dt(a.data_saida)} ${esc(a.hora_saida || '')}`,
      `${dt(a.data_retorno)} ${esc(a.hora_retorno || '')}`,
      money((a.valor_total || 0) - (a.desconto || 0)),
      money(a.valor_pago),
      money((a.valor_total || 0) - (a.desconto || 0) - (a.valor_pago || 0)),
      st,
      acoes,
    ];
  });
  return page({
    title: 'Agendamentos',
    user,
    flash,
    ativo: 'agendamentos',
    header: 'Reserva de moto com data futura (e sinal, se houver). Na data, clique em "Entregar moto".',
    children: `
      <div class="card"><h2 style="margin-top:0;">Novo agendamento</h2>
        <form method="POST" action="/frota/agendamentos">${csrfInput(csrfToken)}
          <div class="form-grid">
            <div class="field"><label>Cliente *</label><select name="cliente_id" required><option value="">Selecione...</option>${optionList(clientes, null, (c) => c.nome)}</select></div>
            <div class="field"><label>Modelo *</label><select name="frota_id" required>${optionList(modelos, null, (m) => m.identificacao)}</select></div>
            <div class="field"><label>Data de saída *</label><input type="date" name="data_saida" required></div>
            <div class="field"><label>Hora de saída</label><input type="time" name="hora_saida"></div>
            <div class="field"><label>Data de retorno</label><input type="date" name="data_retorno"></div>
            <div class="field"><label>Hora de retorno</label><input type="time" name="hora_retorno"></div>
            <div class="field"><label>Valor total (R$)</label><input type="number" name="valor_total" step="0.01" min="0"></div>
            <div class="field"><label>Desconto (R$)</label><input type="number" name="desconto" step="0.01" min="0" value="0"></div>
            <div class="field"><label>Sinal pago (R$)</label><input type="number" name="valor_pago" step="0.01" min="0" value="0"></div>
          </div>
          <div class="field full"><label>Observações</label><textarea name="observacoes" rows="2"></textarea></div>
          <button class="btn">Agendar</button>
        </form>
      </div>
      <div class="card">${tabela(['Cliente', 'Modelo', 'Saída', 'Retorno', 'Valor', 'Pago', 'Restante', 'Status', ''], linhas, 'Nenhum agendamento.')}</div>`,
  });
}

// ---------------------------------------------------------------- MODELOS DE CONTRATO
const VARIAVEIS_CONTRATO = [
  ['Empresa', [['logo_raw', 'Logo (use {!! $logo_raw !!})'], ['data_hoje', 'Data de hoje'], ['data_hoje_extenso', 'Data de hoje por extenso']]],
  ['Cliente', [['cliente_nome', 'Nome'], ['cpfCnpj', 'CPF/CNPJ formatado'], ['cliente_cpf_cnpj', 'CPF/CNPJ'], ['cliente_endereco', 'Endereço completo'], ['cliente_cidade', 'Cidade'], ['cliente_estado', 'Estado'], ['cliente_telefone_1', 'Telefone 1'], ['cliente_telefone_2', 'Telefone 2'], ['telefone_1', 'Telefone 1 (alt.)'], ['telefone_2', 'Telefone 2 (alt.)'], ['cliente_email', 'E-mail'], ['cliente_rede_social', 'Rede social'], ['cliente_cnh', 'CNH'], ['cliente_validade_cnh', 'Validade da CNH'], ['cliente_rg', 'RG'], ['cliente_orgao_emissor', 'Órgão emissor'], ['cliente_uf_rg', 'UF do RG'], ['cliente_data_nascimento', 'Nascimento']]],
  ['Veículo', [['veiculo_marca', 'Marca'], ['veiculo_modelo', 'Modelo'], ['veiculo_placa', 'Placa'], ['veiculo_ano', 'Ano'], ['veiculo_cor', 'Cor'], ['veiculo_chassi', 'Chassi'], ['veiculo_renavam', 'Renavam'], ['veiculo_km_saida', 'Km de saída']]],
  ['Locação', [['data_saida', 'Data de saída'], ['hora_saida', 'Hora de saída'], ['data_retorno', 'Data de retorno'], ['hora_retorno', 'Hora de retorno'], ['qtd_diarias', 'Qtd. de diárias'], ['qtd_semanas', 'Qtd. de semanas'], ['qtd_periodos', 'Qtd. de períodos'], ['periodo', 'Período (diária/semanal/mensal)'], ['valor_total', 'Valor total'], ['valor_desconto', 'Desconto'], ['valor_total_desconto', 'Total com desconto'], ['valor_caucao', 'Entrada'], ['valor_entrada', 'Entrada (alt.)'], ['parcelas_financeiro', 'Nº de parcelas'], ['valor_parcela_financeiro', 'Valor da parcela'], ['observacoes', 'Observações']]],
  ['Assinaturas', [['testemunha_1', 'Testemunha 1'], ['testemunha_1_rg', 'RG test. 1'], ['testemunha_2', 'Testemunha 2'], ['testemunha_2_rg', 'RG test. 2'], ['fiador', 'Fiador'], ['dados_fiador', 'Dados do fiador']]],
];

function contratoModelosPage({ user, flash, modelos, csrfToken }) {
  const linhas = modelos.map((m) => [
    String(m.id),
    esc(m.titulo),
    dt(m.updated_at),
    `<div style="display:flex;gap:6px;"><a class="btn btn-sm btn-secondary" href="/frota/contratos-modelos/${m.id}/editar">Editar</a>
     <form method="POST" action="/frota/contratos-modelos/${m.id}/excluir" style="margin:0;" onsubmit="return confirm('Excluir modelo?');">${csrfInput(csrfToken)}<button class="btn btn-sm btn-secondary">Excluir</button></form></div>`,
  ]);
  return page({
    title: 'Modelos de contrato',
    user,
    flash,
    ativo: 'contratos',
    header: 'Texto do contrato com variáveis que são trocadas pelos dados da locação. Mesma sintaxe do WSYS: dá pra colar o HTML dos modelos antigos.',
    children: `<div class="actions-row"><a class="btn" href="/frota/contratos-modelos/novo">+ Novo modelo</a></div>
      <div class="card">${tabela(['ID', 'Título', 'Atualizado', ''], linhas, 'Nenhum modelo ainda.')}</div>`,
  });
}

function contratoModeloFormPage({ user, flash, modelo, csrfToken }) {
  const m = modelo || {};
  const vars = VARIAVEIS_CONTRATO.map(
    ([grupo, lista]) =>
      `<div style="margin-bottom:8px;"><strong>${grupo}</strong><div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">${lista
        .map(([v, l]) => {
          const token = v === 'logo_raw' ? '{!! $logo_raw !!}' : `{{ $${v} }}`;
          return `<button type="button" class="btn btn-sm btn-secondary" title="${esc(l)}" onclick="insVar('${token.replace(/'/g, "\\'")}')">${esc(l)}</button>`;
        })
        .join('')}</div></div>`
  ).join('');
  return page({
    title: m.id ? 'Editar modelo de contrato' : 'Novo modelo de contrato',
    user,
    flash,
    ativo: 'contratos',
    children: `
      <div class="card">
        <form method="POST" action="${m.id ? `/frota/contratos-modelos/${m.id}` : '/frota/contratos-modelos'}">${csrfInput(csrfToken)}
          <div class="field full"><label>Título *</label><input type="text" name="titulo" required value="${esc(m.titulo || '')}"></div>
          <details open style="margin:8px 0;"><summary>Variáveis (clique pra inserir no cursor)</summary><div style="margin-top:8px;">${vars}</div></details>
          <div class="field full"><label>Texto (HTML ou texto simples — quebras de linha são mantidas)</label>
            <textarea id="corpo" name="corpo" rows="24" style="font-family:monospace;font-size:13px;">${esc(m.corpo || '')}</textarea></div>
          <button class="btn">Salvar modelo</button>
        </form>
      </div>
      <script>
        function insVar(t){var a=document.getElementById('corpo');var s=a.selectionStart||0,e=a.selectionEnd||0;a.value=a.value.slice(0,s)+t+a.value.slice(e);a.focus();a.selectionStart=a.selectionEnd=s+t.length;}
      </script>`,
  });
}

// Documento final pra impressão (sem o layout do sistema).
function contratoImpressaoPage({ titulo, corpoHtml }) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#000;max-width:800px;margin:20px auto;padding:0 20px;line-height:1.45;}
  table{border-collapse:collapse;width:100%;} td,th{border:1px solid #999;padding:4px 6px;vertical-align:top;}
  .barra{position:sticky;top:0;background:#fff;padding:8px 0;border-bottom:1px solid #ddd;margin-bottom:12px;}
  @media print{.barra{display:none;} body{margin:0;}}
</style></head><body>
<div class="barra"><button onclick="window.print()">Imprimir / salvar PDF</button></div>
${corpoHtml}
</body></html>`;
}

// ---------------------------------------------------------------- RELATÓRIOS
// Estilo das telas de relatório (cards no padrão WSYS + impressão em PDF).
const REL_CSS = `<style>
  .rel-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:16px}
  .rel-card{background:var(--bg-dark,#111);color:#fff;border-radius:12px;padding:16px 18px;border-bottom:3px solid #1b7a43;min-width:0}
  .rel-card.neg{border-bottom-color:#a1352a}.rel-card.neu{border-bottom-color:#d4af37}
  .rel-card .t{font-size:13px;color:#bbb}.rel-card .v{font-size:26px;font-weight:700;margin:4px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rel-card .s{font-size:12px;color:#8fd19e}.rel-card.neg .s{color:#f0a39a}.rel-card.neu .s{color:#e8cf7a}
  .pill{display:inline-block;font-size:12px;padding:2px 8px;border-radius:6px;white-space:nowrap;font-weight:600}
  .pill.v{background:rgba(27,122,67,.12);color:#1b7a43}.pill.r{background:rgba(161,53,42,.12);color:#a1352a}.pill.a{background:rgba(176,137,0,.16);color:#8a6d00}
  .rel-barra{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-bottom:10px}
  @media print{.sidebar,.mobile-topbar,.no-print,#ia-btn,#ia-box,.actions-row{display:none!important}.main{margin:0!important;padding:0!important}.card{break-inside:avoid}}
</style>`;
const relCard = (t, v, s, tipo) => `<div class="rel-card ${tipo || ''}"><div class="t">${t}</div><div class="v" title="${esc(v)}">${v}</div><div class="s">${s}</div></div>`;
const BUSCA_JS = `<script>function relBusca(inp,tab){var q=inp.value.toLowerCase();document.querySelectorAll('#'+tab+' tbody tr').forEach(function(tr){tr.style.display=tr.innerText.toLowerCase().indexOf(q)>=0?'':'none'})}</script>`;

function relatoriosLocacaoPage({ user, flash, porMoto, filtro, conflitos = [] }) {
  const tot = porMoto.reduce((a, u) => ({ r: a.r + u.receita, c: a.c + (u.contratado || 0), ab: a.ab + (u.aberto || 0), d: a.d + u.despesas }), { r: 0, c: 0, ab: 0, d: 0 });
  const lucro = tot.r - tot.d;
  const margem = tot.r ? Math.round((lucro / tot.r) * 100) : 0;
  const qs = `de=${encodeURIComponent(filtro.de || '')}&ate=${encodeURIComponent(filtro.ate || '')}`;
  const linhas = porMoto.map((u) => {
    const payback = u.valor_compra ? Math.round((u.receita / u.valor_compra) * 100) : null;
    return `<tr>
      <td>${esc(u.modelo)}</td>
      <td>${u.id ? `<a href="/frota/unidades/${u.id}/editar">${esc(u.placa && u.placa !== u.chassi ? u.placa + ' · ' + (u.chassi || '') : u.chassi || u.placa || '—')}</a>` : esc(u.placa || '—')}${u.id && !u.ativo ? ' <span class="pill r">desativada</span>' : ''}</td>
      <td style="text-align:center;">${u.qtd_locacoes}</td>
      <td><span class="pill a">${money(u.contratado)}</span></td>
      <td><span class="pill v">${money(u.receita)}</span></td>
      <td><span class="pill r">${money(u.despesas)}</span></td>
      <td><strong style="color:${u.resultado < 0 ? '#a1352a' : '#1b7a43'}">${money(u.resultado)}</strong>${u.receita ? ` <span class="muted">${Math.round((u.resultado / u.receita) * 100)}%</span>` : ''}</td>
      <td>${u.valor_compra ? `${payback}% de ${money(u.valor_compra)}` : '<span class="muted">sem valor de compra</span>'}</td>
    </tr>`;
  });
  return page({
    title: 'Lucratividade dos veículos',
    user,
    flash,
    ativo: 'relatorios',
    header: 'Recebido = dinheiro que entrou de verdade. Contratado = valor total dos contratos (inclui parcelas que ainda vão vencer).',
    children: `${REL_CSS}${BUSCA_JS}
      <form method="GET" action="/frota/relatorios" class="card no-print" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
        <div class="field" style="margin:0;"><label>De</label><input type="date" name="de" value="${esc(filtro.de === '2000-01-01' ? '' : filtro.de || '')}"></div>
        <div class="field" style="margin:0;"><label>Até</label><input type="date" name="ate" value="${esc(filtro.ate || '')}"></div>
        <button class="btn btn-sm">Aplicar</button>
        <span style="flex:1"></span>
        <a class="btn btn-sm btn-secondary" href="/frota/relatorios.csv?${qs}">Exportar relatório</a>
        <button type="button" class="btn btn-sm" onclick="window.print()">Relatório - PDF</button>
      </form>
      <div class="rel-cards">
        ${relCard('Faturamento recebido', money(tot.r), 'Dinheiro que entrou no período')}
        ${relCard('Contratado', money(tot.c), `Ainda a receber das ativas: ${money(tot.ab)}`, 'neu')}
        ${relCard('Custos totais', money(tot.d), tot.d ? 'Despesas e manutenções' : 'Sem custos registrados', 'neg')}
        ${relCard('Lucro líquido', money(lucro), `Lucratividade: ${margem}%`, lucro < 0 ? 'neg' : '')}
      </div>
      ${tot.d === 0 ? `<div class="card no-print" style="border-left:4px solid #d4af37;"><strong>Margem de 100% não é real:</strong> nenhuma despesa foi lançada. Lance manutenção, seguro, rastreador e IPVA em <a href="/frota/despesas">Despesas</a> e o valor de compra de cada moto (em Frota → Motos) para o lucro e o payback ficarem certos.</div>` : ''}
      ${conflitos.length ? `<div class="card" style="border:2px solid #a1352a;">
        <h2 style="margin-top:0;color:#a1352a;">Mesma moto em mais de uma locação ativa (${conflitos.length})</h2>
        <p class="muted" style="margin-top:0;">Uma das locações está com o chassi errado: confira o chassi na moto e corrija a locação.</p>
        ${tabela(['Chassi', 'Locações ativas'], conflitos.map((cf) => [esc(cf.chassi), cf.locacoes.map((l) => `<a href="/locacoes/${l.id}">#${l.id}</a> ${esc(l.cliente_nome || '?')} (saída ${esc(l.data_saida || '?')})`).join('<br>')]), '')}
      </div>` : ''}
      <div class="card">
        <div class="rel-barra"><h2 style="margin:0;">Por veículo (${porMoto.length})</h2><input type="search" class="no-print" placeholder="Pesquisar" oninput="relBusca(this,'tab-lucro')" style="max-width:240px;"></div>
        ${porMoto.length ? `<div style="overflow-x:auto;"><table id="tab-lucro"><thead><tr><th>Modelo</th><th>Placa / chassi</th><th style="text-align:center;">Locações</th><th>Contratado</th><th>Recebido</th><th>Manutenções/Despesas</th><th>Lucratividade</th><th>Payback</th></tr></thead><tbody>${linhas.join('')}</tbody></table></div>` : '<div class="empty">Cadastre as motos (unidades) pra ver a lucratividade por veículo.</div>'}
      </div>`,
  });
}

function faturamentoMensalPage({ user, flash, linhas, porMes, filtro, clientes, veiculos, qs }) {
  const sel = (v, a) => (String(v) === String(a) ? 'selected' : '');
  const COLS = [['cliente', 'Cliente'], ['veiculo', 'Veículo'], ['placa', 'Placa'], ['saida', 'Data saída'], ['dias', 'Qtd diárias'], ['diaria', 'Valor diária'], ['total', 'Valor total']];
  const linMes = porMes
    .map(
      (m) => `<tr${m.atual ? ' style="background:rgba(212,175,55,.08);font-weight:600;"' : ''}><td>${esc(m.mes)}</td><td>${money(m.competencia)}</td><td>${money(m.previsto)}</td><td>${money(m.recebido)}</td><td>${money(m.despesas)}</td><td>${m.previsto ? Math.round((m.recebido / m.previsto) * 100) + '%' : '—'}</td></tr>`
    )
    .join('');
  const linDet = linhas
    .map(
      (l) => `<tr>
      <td data-c="cliente"><a href="/locacoes/${l.id}">#${l.id}</a> ${esc(l.cliente_nome || '—')}</td>
      <td data-c="veiculo">${esc(l.modelo || '')}</td>
      <td data-c="placa">${esc(l.placa || l.chassi || '—')}</td>
      <td data-c="saida">${dt(l.data_saida)}</td>
      <td data-c="dias">${l.dias}</td>
      <td data-c="diaria">${money(l.diaria)}</td>
      <td data-c="total">${money(l.total)}</td>
    </tr>`
    )
    .join('');
  const nf = ['cliente', 'veiculo', 'de', 'ate'].filter((k) => filtro[k]).length;
  return page({
    title: 'Faturamento mensal',
    user,
    flash,
    ativo: 'faturamento',
    header: 'Divide cada locação pela quantidade de diárias e coloca cada diária no mês em que a moto foi usada, a partir da data de saída. Assim você vê o valor da locação por mês de uso (competência), e compara com o que venceu e o que entrou de verdade.',
    children: `${REL_CSS}${BUSCA_JS}
      <div class="card">
        <h2 style="margin-top:0;">Por mês</h2>
        <div style="overflow-x:auto;"><table><thead><tr><th>Mês</th><th>Competência (uso)</th><th>Previsto (vencimentos)</th><th>Recebido</th><th>Despesas</th><th>% recebido</th></tr></thead><tbody>${linMes}</tbody></table></div>
        <p class="muted" style="margin:6px 0 0;">"% recebido" abaixo de 100% = dinheiro na rua (inadimplência). Competência considera só as locações do filtro abaixo.</p>
      </div>
      <div class="card">
        <div class="rel-barra">
          <h2 style="margin:0;">Locações (${linhas.length})</h2>
          <div class="no-print" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <input type="search" placeholder="Pesquisar" oninput="relBusca(this,'tab-fat')" style="max-width:220px;">
            <details style="position:relative;"><summary class="btn btn-sm btn-secondary" style="list-style:none;">Filtros${nf ? ` (${nf})` : ''}</summary>
              <form method="GET" action="/frota/faturamento-mensal" class="card" style="position:absolute;right:0;z-index:20;width:280px;margin-top:6px;">
                <div class="field"><label>Cliente</label><select name="cliente"><option value="">Todos</option>${clientes.map((c) => `<option value="${c.id}" ${sel(c.id, filtro.cliente)}>${esc(c.nome)}</option>`).join('')}</select></div>
                <div class="field"><label>Veículo (placa/chassi)</label><select name="veiculo"><option value="">Todos</option>${veiculos.map((v) => `<option value="${esc(v.chassi)}" ${sel(v.chassi, filtro.veiculo)}>${esc(v.modelo + ' · ' + (v.placa || v.chassi))}</option>`).join('')}</select></div>
                <div class="field"><label>Saída de</label><input type="date" name="de" value="${esc(filtro.de)}"></div>
                <div class="field"><label>Saída até</label><input type="date" name="ate" value="${esc(filtro.ate)}"></div>
                <div class="actions-row" style="margin:0;"><button class="btn btn-sm">Aplicar</button><a class="btn btn-sm btn-secondary" href="/frota/faturamento-mensal">Limpar filtros</a></div>
              </form>
            </details>
            <details style="position:relative;"><summary class="btn btn-sm btn-secondary" style="list-style:none;">Colunas</summary>
              <div class="card" style="position:absolute;right:0;z-index:20;width:200px;margin-top:6px;">
                ${COLS.map(([k, l]) => `<label style="display:flex;gap:8px;align-items:center;font-weight:normal;margin:4px 0;"><input type="checkbox" checked style="width:auto;" onchange="document.querySelectorAll('#tab-fat [data-c=${k}]').forEach(function(e){e.style.display=this.checked?'':'none'}.bind(this))"> ${l}</label>`).join('')}
              </div>
            </details>
            <a class="btn btn-sm btn-secondary" href="/frota/faturamento-mensal.csv${esc(qs)}">Exportar</a>
            <button type="button" class="btn btn-sm" onclick="window.print()">PDF</button>
          </div>
        </div>
        ${linhas.length ? `<div style="overflow-x:auto;"><table id="tab-fat"><thead><tr>${COLS.map(([k, l]) => `<th data-c="${k}">${l}</th>`).join('')}</tr></thead><tbody>${linDet}</tbody></table></div>` : '<div class="empty">Sem registros.</div>'}
      </div>`,
  });
}

function importarPage({ user, flash, csrfToken, relatorio, erroImp, modo, dadosTexto }) {
  const r = relatorio;
  const linha = (rot, obj) => `<tr><td><strong>${rot}</strong></td><td>${Object.entries(obj).map(([k, v]) => `${esc(k.replace(/_/g, ' '))}: <strong>${esc(typeof v === 'number' && /valor/.test(k) ? money(v) : v)}</strong>`).join(' · ')}</td></tr>`;
  const res = r
    ? `<div class="card" style="border:2px solid ${modo === 'importar' ? '#1b7a43' : '#8a6d00'};">
        <h2 style="margin-top:0;">${modo === 'importar' ? 'Importação concluída' : 'Simulação (nada foi gravado)'}</h2>
        <table><tbody>
          ${linha('Clientes', r.clientes)}${linha('Modelos', r.modelos)}${linha('Motos', r.motos)}${linha('Locações', r.locacoes)}${linha('Parcelas', r.parcelas)}
          <tr><td><strong>Ocorrências</strong></td><td><strong>${r.ocorrencias}</strong></td></tr>
        </tbody></table>
        ${r.avisos.length ? `<h3>Avisos</h3><ul>${r.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      </div>`
    : '';
  return page({
    title: 'Importar do WSYS',
    user,
    flash,
    ativo: 'frota',
    header: 'Cole o pacote exportado do WSYS. Rode "Simular" primeiro; dá pra importar de novo sem duplicar (cada registro guarda o id de origem).',
    children: `
      ${erroImp ? `<div class="card" style="border:2px solid #a1352a;"><strong>Erro:</strong> ${esc(erroImp)}</div>` : ''}
      ${res}
      <div class="card">
        <form method="POST" action="/frota/importar" enctype="multipart/form-data">${csrfInput(csrfToken)}
          <div class="field full"><label>Pacote do WSYS (JSON)</label>
            <textarea name="dados" id="dados" rows="10" style="font-family:monospace;font-size:12px;" placeholder='{"clientes":[...],"veiculos":[...],"locacoes":[...],"recebimentos":[...]}'>${esc(dadosTexto || '')}</textarea></div>
          <div class="actions-row">
            <button class="btn btn-secondary" name="modo" value="simular">Simular</button>
            <button class="btn" name="modo" value="importar" onclick="return confirm('Gravar a importação no sistema?');">Importar de verdade</button>
          </div>
        </form>
      </div>`,
  });
}

// ---------------------------------------------------------------- REVISÕES
function waRevisao(tel, nome, prox, vencida) {
  let d = String(tel || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 11) d = '55' + d;
  const primeiro = String(nome || '').split(' ')[0];
  const msg = vencida
    ? `Olá ${primeiro}! Aqui é da Golden Motors. A revisão periódica da sua moto venceu em ${prox}. Ela é obrigatória a cada 90 dias para manter a garantia. Podemos agendar? Loja na Barra Olímpica.`
    : `Olá ${primeiro}! Aqui é da Golden Motors. A revisão periódica da sua moto vence em ${prox} (obrigatória a cada 90 dias para manter a garantia). Quer agendar? Loja na Barra Olímpica.`;
  return `<a class="btn btn-sm btn-secondary" target="_blank" href="https://wa.me/${d}?text=${encodeURIComponent(msg)}">WhatsApp</a>`;
}
function revisoesPage({ user, flash, lista, total, filtro, csrfToken }) {
  const linhas = lista.map((x) => {
    const st = x.dias < 0 ? badge(`vencida há ${-x.dias}d`, 'vermelho') : x.dias <= 7 ? badge(`em ${x.dias}d`, 'amarelo') : badge(`em ${x.dias}d`, 'verde');
    const de = x.origem === 'revisao' ? 'última revisão' : x.tipo === 'venda' ? 'data da venda' : '1º dia locada';
    return [
      x.tipo === 'venda' ? badge('vendida', 'cinza') : badge('locação', 'amarelo'),
      esc(x.cliente || '—'),
      esc(x.modelo || ''),
      esc(x.chassi || ''),
      `${dt(x.prox)} ${st}<br><small class="muted">conta de ${de} (${dt(x.base)})</small>`,
      `<div style="display:flex;gap:6px;flex-wrap:wrap;">${waRevisao(x.telefone, x.cliente, dt(x.prox), x.dias < 0)}
        <form method="POST" action="/frota/revisoes/${x.tipo}/${x.id}/feita" style="margin:0;display:flex;gap:4px;">${csrfInput(csrfToken)}<input type="hidden" name="ver" value="${esc(filtro)}">
          <input type="date" name="data" value="${new Date().toLocaleDateString('en-CA')}" style="width:auto;"><button class="btn btn-sm">Revisão feita</button></form></div>`,
    ];
  });
  return page({
    title: 'Revisões a cada 90 dias',
    user,
    flash,
    ativo: 'revisoes',
    header: 'Motos da locação (contam do 1º dia locada) e motos vendidas na garantia (contam da data da venda). Depois de uma revisão, contam dela.',
    children: `
      <div class="actions-row" style="margin-bottom:10px;">
        <a class="btn btn-sm ${filtro === 'proximas' ? '' : 'btn-secondary'}" href="/frota/revisoes">Vencidas e próximos 15 dias</a>
        <a class="btn btn-sm ${filtro === 'todas' ? '' : 'btn-secondary'}" href="/frota/revisoes?ver=todas">Todas (${total})</a>
      </div>
      <div class="card">${tabela(['Tipo', 'Cliente', 'Modelo', 'Chassi', 'Próxima revisão', ''], linhas, 'Nenhuma revisão vencida ou para os próximos 15 dias.')}</div>
      <p class="muted">Moto vendida entra aqui quando a garantia dela está cadastrada (menu Garantias) com o chassi e a data da venda. Uma O.S. concluída para o mesmo chassi conta como revisão.</p>`,
  });
}

function agendaCobrancaPage({ user, flash, parcelas, hoje, empresa, csrfToken }) {
  const diff = (venc) => {
    const d = new Date(String(venc).slice(0, 10) + 'T00:00:00');
    const h = new Date(String(hoje).slice(0, 10) + 'T00:00:00');
    return Math.round((d - h) / 86400000);
  };
  const vencidas = [], hojeArr = [], aVencer = [];
  (parcelas || []).forEach((p) => {
    const d = diff(p.vencimento);
    if (d < 0) vencidas.push({ ...p, d });
    else if (d === 0) hojeArr.push({ ...p, d });
    else if (d <= 7) aVencer.push({ ...p, d });
  });
  vencidas.sort((a, b) => a.d - b.d);
  aVencer.sort((a, b) => a.d - b.d);
  const dataBR = (v) => String(v).slice(0, 10).split('-').reverse().join('/');
  const waLink = (p, tipo) => {
    const tel = String(p.cliente_telefone || '').replace(/\D/g, '');
    if (!tel) return null;
    const num = tel.length >= 12 ? tel : '55' + tel;
    const nome = String(p.cliente_nome || 'cliente').split(' ')[0];
    const valor = money(p.valor);
    const data = dataBR(p.vencimento);
    const modelo = p.modelo || '';
    let msg;
    if (tipo === 'vencida') msg = `Olá ${nome}! Aqui é da ${empresa}. Sua parcela de ${valor} (locação ${modelo}) venceu dia ${data} e está em aberto. Consegue acertar pra gente? Qualquer coisa me chama por aqui.`;
    else if (tipo === 'hoje') msg = `Olá ${nome}! Aqui é da ${empresa}. Passando pra lembrar que sua parcela de ${valor} (locação ${modelo}) vence hoje (${data}). Qualquer dúvida, é só chamar.`;
    else msg = `Olá ${nome}! Aqui é da ${empresa}. Passando pra lembrar que sua parcela de ${valor} (locação ${modelo}) vence dia ${data}. Qualquer dúvida, é só chamar.`;
    return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
  };
  const linha = (p, tipo) => {
    const wa = waLink(p, tipo);
    const waBtn = wa
      ? `<a class="btn btn-sm" style="background:#25D366;border-color:#25D366;color:#fff;" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>`
      : '<span style="font-size:12px;color:#a1352a;">sem telefone</span>';
    const receber = `<form method="POST" action="/parcelas/${p.id}/pagar" style="margin:0;display:inline-flex;gap:4px;vertical-align:middle;">${csrfInput(csrfToken)}<input type="hidden" name="voltar" value="agenda"><select name="forma_pagamento" style="width:auto;">${FORMAS_PGTO.map((f) => `<option>${f}</option>`).join('')}</select><button class="btn btn-sm btn-secondary" type="submit">Receber</button></form>`;
    const dia = tipo === 'vencida' ? badge(`${-p.d}d atraso`, 'vermelho') : tipo === 'hoje' ? badge('hoje', 'amarelo') : badge(`em ${p.d}d`, 'cinza');
    return `<tr><td><a class="link-btn" href="/locacoes/${p.locacao_id}">#${p.locacao_id}</a></td><td>${esc(p.cliente_nome || '—')}</td><td>${esc(p.cliente_telefone || '—')}</td><td>${esc(p.modelo || '')}</td><td>${dataBR(p.vencimento)} ${dia}</td><td style="text-align:right;">${money(p.valor)}</td><td style="white-space:nowrap;">${waBtn} ${receber}</td></tr>`;
  };
  const bloco = (titulo, arr, tipo) => {
    const total = arr.reduce((s, p) => s + (Number(p.valor) || 0), 0);
    return `<div class="card" style="margin-top:12px;"><h2 style="margin:0 0 10px;">${titulo} <span style="font-size:13px;color:#8a7f6d;font-weight:normal;">${arr.length} parcela(s) · ${money(total)}</span></h2>${
      arr.length
        ? `<div style="overflow-x:auto;"><table><thead><tr><th>Loc.</th><th>Cliente</th><th>Telefone</th><th>Modelo</th><th>Vencimento</th><th style="text-align:right;">Valor</th><th>Ações</th></tr></thead><tbody>${arr.map((p) => linha(p, tipo)).join('')}</tbody></table></div>`
        : '<p class="muted" style="margin:0;">Nada aqui.</p>'
    }</div>`;
  };
  return page({
    title: 'Agenda de cobrança',
    user,
    flash,
    ativo: 'agenda-cobranca',
    header: 'Quem cobrar — clique no WhatsApp e a mensagem já abre pronta pro cliente.',
    children: `${bloco('Vencidas', vencidas, 'vencida')}${bloco('Vence hoje', hojeArr, 'hoje')}${bloco('A vencer (próximos 7 dias)', aVencer, 'avencer')}`,
  });
}

module.exports = {
  agendaCobrancaPage,
  revisoesPage,
  importarPage,
  painelLocacaoPage,
  unidadesPage,
  unidadeEditarPage,
  locacoesListPage,
  locacaoDetalhePage,
  despesasPage,
  agendamentosPage,
  contratoModelosPage,
  contratoModeloFormPage,
  contratoImpressaoPage,
  relatoriosLocacaoPage,
  documentosPage,
  TIPOS_DOCUMENTO,
  faturamentoMensalPage,
  TIPOS_OCORRENCIA,
};
