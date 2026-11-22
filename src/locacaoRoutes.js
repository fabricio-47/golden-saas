'use strict';

// Rotas da "Locação Pro" (paridade com o WSYS Locar). Chamado pelo handler
// principal ANTES do bloco /frota antigo; devolve true quando atendeu a rota.

const { db } = require('./db');
const { LOGO_DATA_URI } = require('./assets/logo');
const { escapeHtml, formatMoney } = require('./utils');
const V = require('./views/locacaoPro');

const hoje = () => new Date().toISOString().slice(0, 10);
const txt = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
const num = (v) => {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const int = (v) => {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
};
const chk = (v) => (v === '1' || v === 'on' || v === 'true' ? 1 : 0);

// Uma moto (unidade) está locada se há locação ativa ligada a ela — ou, pra
// locações antigas sem vínculo, com o mesmo chassi.
const SQL_LOC_ATIVA_DA_UNIDADE = `(SELECT l.id FROM locacoes l WHERE l.status='ativa'
  AND (l.unidade_id = u.id OR (l.unidade_id IS NULL AND UPPER(TRIM(l.chassi)) = UPPER(TRIM(u.chassi)))) LIMIT 1)`;

// Com motos cadastradas, quantidade e manutenção do modelo vêm delas (mantém o
// resto do sistema, que trabalha no modo "pool", funcionando sem mudança).
function syncModelo(frotaId) {
  const r = db.prepare('SELECT COUNT(*) c, COALESCE(SUM(em_manutencao),0) m FROM frota_unidades WHERE frota_id=? AND ativo=1').get(frotaId);
  if (r.c > 0) db.prepare('UPDATE frota SET quantidade_total=?, em_manutencao=? WHERE id=?').run(r.c, r.m, frotaId);
}
function syncTodos() {
  for (const f of db.prepare('SELECT DISTINCT frota_id FROM frota_unidades').all()) syncModelo(f.frota_id);
}

function unidadesComStatus(where = '1=1', params = []) {
  return db
    .prepare(
      `SELECT u.*, f.identificacao AS modelo, ${SQL_LOC_ATIVA_DA_UNIDADE} AS locacao_id,
         (SELECT MIN(l.data_saida) FROM locacoes l WHERE l.unidade_id = u.id
            OR (l.unidade_id IS NULL AND UPPER(TRIM(l.chassi)) = UPPER(TRIM(u.chassi)))) AS primeira_locacao,
         (SELECT c.nome FROM locacoes l JOIN clientes c ON c.id=l.cliente_id WHERE l.id = ${SQL_LOC_ATIVA_DA_UNIDADE}) AS cliente_nome
       FROM frota_unidades u JOIN frota f ON f.id = u.frota_id
       WHERE ${where} ORDER BY f.identificacao, u.placa, u.chassi`
    )
    .all(...params);
}

// Revisão periódica (garantia): conta a partir da última revisão registrada; sem revisão,
// a partir do primeiro dia em que a moto foi locada. Moto nunca locada não entra no alerta.
function proximaRevisao(u) {
  const base = u.data_ultima_revisao || u.primeira_locacao || null;
  if (!base) return null;
  const d = new Date(String(base).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + (u.intervalo_revisao_dias || 90));
  const prox = d.toISOString().slice(0, 10);
  const hoje0 = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00');
  const dias = Math.round((d - hoje0) / 86400000);
  return { base: String(base).slice(0, 10), origem: u.data_ultima_revisao ? 'revisao' : 'locacao', prox, dias };
}

// ------------------------------------------------------------ chassi
// Chassi "limpo": só letras e números, em maiúsculas. Tudo depois de "#" é
// número interno da moto (ex.: "R3TDR1AW1N1222158 #16") e não faz parte do chassi.
function separarChassi(v) {
  const bruto = String(v || '').toUpperCase();
  const i = bruto.indexOf('#');
  const chassi = (i >= 0 ? bruto.slice(0, i) : bruto).replace(/[^A-Z0-9]/g, '');
  const interno = i >= 0 ? bruto.slice(i + 1).replace(/[^A-Z0-9]/g, '') : '';
  return { chassi: chassi || null, interno: interno || null };
}
const normChassi = (v) => separarChassi(v).chassi;
const CHASSI_MIN = 8;

// Procura moto já cadastrada com o mesmo chassi (comparando a versão limpa),
// em qualquer modelo e incluindo as desativadas.
function acharChassiDuplicado(chassi, ignorarId = null) {
  const alvo = normChassi(chassi);
  if (!alvo) return null;
  const todas = db
    .prepare('SELECT u.id, u.chassi, u.ativo, u.frota_id, f.identificacao AS modelo FROM frota_unidades u LEFT JOIN frota f ON f.id=u.frota_id')
    .all();
  return todas.find((u) => u.id !== ignorarId && normChassi(u.chassi) === alvo) || null;
}
function msgDuplicado(d) {
  return `Já existe moto com esse chassi: #${d.id} (${d.chassi}) no modelo ${d.modelo || '?'}${d.ativo ? '' : ', desativada — exclua ou reative ela'}.`;
}

function unidadeDoBody(body) {
  const { chassi, interno } = separarChassi(body.chassi);
  let obs = txt(body.observacoes);
  if (interno && !(obs || '').includes('#' + interno)) obs = `Nº interno #${interno}` + (obs ? `\n${obs}` : '');
  let placa = txt(body.placa) ? txt(body.placa).toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
  if (placa && chassi && placa === chassi) placa = null; // chassi digitado no campo placa
  return [
    int(body.frota_id), placa || null, chassi,
    txt(body.renavam), txt(body.cor), int(body.ano), int(body.km_atual), txt(body.data_compra), num(body.valor_compra),
    chk(body.em_manutencao), chk(body.ativo), txt(body.data_ultima_revisao), int(body.intervalo_revisao_dias) || 90,
    int(body.km_prox_pastilha), int(body.km_prox_pneu), obs,
  ];
}

// Entrada em lote: uma moto por linha — "CHASSI [#interno] [cor]".
function analisarLote(texto) {
  const vistos = new Set();
  const linhas = [];
  for (const bruta of String(texto || '').split(/\r?\n/)) {
    const l = bruta.trim();
    if (!l) continue;
    const partes = l.split(/[\s;,\t]+/).filter(Boolean);
    let chassiTxt = partes.shift() || '';
    if (partes[0] && partes[0].startsWith('#')) chassiTxt += ' ' + partes.shift();
    const { chassi, interno } = separarChassi(chassiTxt);
    const cor = partes.join(' ') || null;
    const item = { linha: l, chassi, interno, cor, status: 'nova', motivo: '' };
    if (!chassi || chassi.length < CHASSI_MIN) {
      item.status = 'invalida';
      item.motivo = `chassi com menos de ${CHASSI_MIN} letras/números`;
    } else if (vistos.has(chassi)) {
      item.status = 'repetida';
      item.motivo = 'repetido nesta lista';
    } else {
      const d = acharChassiDuplicado(chassi);
      if (d) {
        item.status = 'existe';
        item.motivo = `já cadastrada: #${d.id} no modelo ${d.modelo || '?'}${d.ativo ? '' : ' (desativada)'}`;
      }
    }
    vistos.add(chassi);
    linhas.push(item);
  }
  return linhas;
}

function locacaoCompleta(id) {
  return db
    .prepare(
      `SELECT l.*, c.nome AS cliente_nome, f.identificacao AS modelo, f.modelo AS modelo_detalhe, f.marca AS marca,
         u.renavam AS u_renavam, u.ano AS u_ano, u.placa AS u_placa
       FROM locacoes l LEFT JOIN clientes c ON c.id = l.cliente_id
       LEFT JOIN frota f ON f.id = l.frota_id LEFT JOIN frota_unidades u ON u.id = l.unidade_id
       WHERE l.id = ?`
    )
    .get(id);
}

// ------------------------------------------------------------ contrato
function fmtCpfCnpj(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v || '';
}
// Valor sem o símbolo: os modelos do WSYS já trazem "R$" no texto (ex.: "Valor da Parcela R$: {{ $valor... }}").
const valorBR = (v) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function diasEntre(a, b) {
  if (!a || !b) return null;
  const d = (new Date(b + 'T00:00:00') - new Date(String(a).slice(0, 10) + 'T00:00:00')) / 86400000;
  return Number.isFinite(d) ? Math.max(0, Math.round(d)) : null;
}

function variaveisContrato(locId) {
  const l = locacaoCompleta(locId);
  if (!l) return null;
  const c = (l.cliente_id && db.prepare('SELECT * FROM clientes WHERE id=?').get(l.cliente_id)) || {};
  const ps = db.prepare('SELECT * FROM locacao_parcelas WHERE locacao_id=? AND origem IS NULL ORDER BY numero').all(locId);
  const total = ps.reduce((s, p) => s + (Number(p.valor) || 0), 0) + (Number(l.desconto) || 0);
  // Valor da parcela "cheia" = o valor que mais se repete (a 1ª pode ter desconto/abatimento).
  const freq = {};
  for (const p of ps) freq[p.valor] = (freq[p.valor] || 0) + 1;
  const valorParcela = Object.keys(freq).sort((a, b) => freq[b] - freq[a] || b - a)[0];
  const endereco = c.endereco || [c.logradouro, c.numero, c.complemento, c.bairro, c.municipio && c.uf ? `${c.municipio}/${c.uf}` : c.municipio, c.cep].filter(Boolean).join(', ');
  const dias = diasEntre(l.data_saida, l.devolucao_prevista);
  const d = new Date();
  return {
    data_hoje: brData(hoje()),
    data_hoje_extenso: `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`,
    cliente_nome: c.nome, cpfCnpj: fmtCpfCnpj(c.cpf_cnpj), cliente_cpf_cnpj: c.cpf_cnpj,
    cliente_endereco: endereco, cliente_cidade: c.municipio, cliente_estado: c.uf,
    cliente_telefone_1: c.telefone, cliente_telefone_2: c.telefone2, telefone_1: c.telefone, telefone_2: c.telefone2,
    cliente_email: c.email, cliente_rede_social: c.rede_social, cliente_cnh: c.cnh, cliente_validade_cnh: brData(c.cnh_validade),
    cliente_rg: c.rg, cliente_orgao_emissor: c.rg_orgao, cliente_uf_rg: c.rg_uf, cliente_data_nascimento: brData(c.data_nascimento),
    veiculo_marca: l.marca, veiculo_modelo: [l.modelo, l.modelo_detalhe].filter(Boolean).join(' '), veiculo_placa: l.placa || l.u_placa,
    veiculo_ano: l.u_ano, veiculo_cor: l.cor, veiculo_chassi: l.chassi, veiculo_renavam: l.u_renavam, veiculo_km_saida: l.km_saida,
    data_saida: brData(l.data_saida), hora_saida: l.hora_saida, data_retorno: brData(l.devolucao_prevista), hora_retorno: l.hora_retorno,
    qtd_diarias: dias, qtd_semanas: l.periodo === 'semanal' && l.qtd_periodos ? l.qtd_periodos : dias !== null ? Math.round(dias / 7) : null,
    qtd_periodos: l.qtd_periodos, periodo: l.periodo,
    valor_total: valorBR(total), valor_desconto: valorBR(l.desconto || 0), valor_total_desconto: valorBR(total - (Number(l.desconto) || 0)),
    valor_caucao: valorBR(l.valor_caucao || 0), valor_entrada: valorBR(l.valor_caucao || 0), parcelas_financeiro: ps.length, valor_parcela_financeiro: valorParcela !== undefined ? valorBR(Number(valorParcela)) : '',
    observacoes: l.observacoes,
    testemunha_1: l.testemunha1_nome, testemunha_1_rg: l.testemunha1_rg, testemunha_2: l.testemunha2_nome, testemunha_2_rg: l.testemunha2_rg,
    fiador: l.fiador_nome, dados_fiador: l.fiador_dados,
  };
}

function renderContrato(corpo, vars) {
  let html = String(corpo || '');
  if (!/<[a-z][\s\S]*>/i.test(html)) html = escapeHtml(html).replace(/\n/g, '<br>');
  // {!! ... !!}: só a logo é aceita (o WSYS usava PHP aqui; não executamos código).
  html = html.replace(/\{!!([\s\S]*?)!!\}/g, (_, dentro) =>
    /logo_raw/.test(dentro) ? `<img src="${LOGO_DATA_URI}" style="height:55px;width:auto;">` : ''
  );
  html = html.replace(/\{\{\s*\$([A-Za-z0-9_]+)\s*\}\}/g, (_, nome) => {
    const v = vars[nome];
    return v === undefined || v === null ? '' : escapeHtml(String(v));
  });
  // Remove scripts/handlers de eventos colados por engano no modelo.
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');
}

// ------------------------------------------------------------ handler
async function handleLocacaoPro(ctx) {
  const { req, res, url, pathname, method, body, user, session, h } = ctx;
  const { send, redirect, setFlash, takeFlash, hasManagementAccess, forbidden, notFound, matchRoute, enviarCsv, locacaoAtiva } = h;

  const ehLocacao =
    pathname === '/locacao' || pathname === '/locacoes' || pathname.startsWith('/locacoes/') || pathname.startsWith('/frota') || pathname.startsWith('/parcelas/');
  if (!ehLocacao) return false;
  if (!locacaoAtiva()) {
    notFound(res);
    return true;
  }
  const flash = () => takeFlash(session.sessionId);
  const ok = (msg) => setFlash(session.sessionId, 'success', msg);
  const erro = (msg) => setFlash(session.sessionId, 'error', msg);
  const ger = hasManagementAccess(user);
  const csrfToken = session.csrfToken;
  const done = (fn) => {
    fn();
    return true;
  };
  let m;

  // Mantém a quantidade do modelo coerente com as motos cadastradas, depois segue pro painel antigo.
  if (pathname === '/frota' && method === 'GET') {
    syncTodos();
    return false;
  }

  // ---------------- painel
  if (pathname === '/locacao' && method === 'GET') {
    syncTodos();
    const t = hoje();
    const mes = t.slice(0, 7);
    const fr = db.prepare('SELECT COALESCE(SUM(quantidade_total),0) q, COALESCE(SUM(em_manutencao),0) m FROM frota WHERE ativo=1').get();
    const locadas = db.prepare("SELECT COUNT(*) c FROM locacoes WHERE status='ativa'").get().c;
    const atrasadas = db.prepare("SELECT COUNT(*) c FROM locacoes WHERE status='ativa' AND devolucao_prevista IS NOT NULL AND devolucao_prevista < ?").get(t).c;
    const soma = (sql, ...p) => db.prepare(sql).get(...p).v || 0;
    const k = {
      csrf: csrfToken,
      ativas: fr.q,
      locadas,
      manutencao: fr.m,
      disponiveis: Math.max(0, fr.q - locadas - fr.m),
      atrasadas,
      ocupacao: fr.q ? Math.round((locadas / fr.q) * 100) : 0,
      recebidoHoje: soma('SELECT SUM(valor) v FROM locacao_parcelas WHERE pago=1 AND data_pagamento=?', t),
      recebidoMes: soma("SELECT SUM(valor) v FROM locacao_parcelas WHERE pago=1 AND substr(data_pagamento,1,7)=?", mes),
      vencido: soma('SELECT SUM(valor) v FROM locacao_parcelas WHERE pago=0 AND valor > 0 AND vencimento < ?', t),
      qtdVencido: soma('SELECT COUNT(*) v FROM locacao_parcelas WHERE pago=0 AND valor > 0 AND vencimento < ?', t),
      despesasMes: soma('SELECT SUM(valor) v FROM frota_despesas WHERE substr(data,1,7)=?', mes),
      carteira: soma('SELECT SUM(valor) v FROM locacao_parcelas WHERE pago=0 AND valor > 0'),
    };
    k.resultadoMes = k.recebidoMes - k.despesasMes;
    const retornos = db
      .prepare(
        `SELECT l.*, c.nome cliente_nome, f.identificacao modelo FROM locacoes l
         LEFT JOIN clientes c ON c.id=l.cliente_id LEFT JOIN frota f ON f.id=l.frota_id
         WHERE l.status='ativa' ORDER BY (l.devolucao_prevista IS NULL), l.devolucao_prevista LIMIT 15`
      )
      .all();
    const receber = db
      .prepare(
        `SELECT p.*, c.nome cliente_nome, (SELECT COUNT(*) FROM locacao_parcelas x WHERE x.locacao_id=p.locacao_id) total
         FROM locacao_parcelas p JOIN locacoes l ON l.id=p.locacao_id LEFT JOIN clientes c ON c.id=l.cliente_id
         WHERE p.pago=0 AND p.valor > 0 AND p.vencimento <= ? ORDER BY p.vencimento LIMIT 50`
      )
      .all(t);
    const ocorrencias = db
      .prepare(
        `SELECT o.*, c.nome cliente_nome FROM locacao_ocorrencias o JOIN locacoes l ON l.id=o.locacao_id
         LEFT JOIN clientes c ON c.id=l.cliente_id WHERE o.concluido=0 ORDER BY o.created_at DESC LIMIT 30`
      )
      .all();
    const alertas = [];
    for (const u of unidadesComStatus('u.ativo=1')) {
      const motivos = [];
      const rv = proximaRevisao(u);
      if (rv && rv.dias < 0) motivos.push(`revisão vencida há ${-rv.dias}d (${brData(rv.prox)})`);
      else if (rv && rv.dias <= 7) motivos.push(`revisão em ${rv.dias}d (${brData(rv.prox)})`);
      if (u.km_prox_pastilha && u.km_atual != null && u.km_atual >= u.km_prox_pastilha - 200) motivos.push('pastilha');
      if (u.km_prox_pneu && u.km_atual != null && u.km_atual >= u.km_prox_pneu - 200) motivos.push('pneu');
      if (motivos.length) alertas.push({ ...u, motivos });
    }
    return done(() => send(res, 200, V.painelLocacaoPage({ user, flash: flash(), k, retornos, receber: ger ? receber : [], ocorrencias, alertas, podeGerenciar: ger })));
  }

  // ---------------- unidades (motos individuais)
  if ((m = matchRoute('/frota/:id/unidades', pathname)) && method === 'GET') {
    const modelo = db.prepare('SELECT * FROM frota WHERE id=?').get(m.id);
    if (!modelo) return done(() => notFound(res));
    const outros = db.prepare('SELECT id, identificacao FROM frota WHERE id<>? ORDER BY identificacao').all(m.id);
    const unidades = unidadesComStatus('u.frota_id=?', [m.id]).map((u) => ({ ...u, revisao: proximaRevisao(u) }));
    return done(() => send(res, 200, V.unidadesPage({ user, flash: flash(), modelo, unidades, csrfToken, outros, podeGerenciar: ger })));
  }
  // Juntar dois modelos (ex.: "X13" e "X13 GOLD" são a mesma moto): move tudo para o destino e apaga a origem.
  if ((m = matchRoute('/frota/:id/juntar', pathname)) && method === 'POST') {
    if (!ger) return done(() => forbidden(res));
    const origem = db.prepare('SELECT * FROM frota WHERE id=?').get(m.id);
    const destino = db.prepare('SELECT * FROM frota WHERE id=?').get(int(body.destino));
    if (!origem || !destino || origem.id === destino.id) {
      erro('Escolha um modelo de destino diferente.');
      return done(() => redirect(res, `/frota/${m.id}/unidades`));
    }
    db.exec('BEGIN');
    try {
      const mov = {};
      for (const tab of ['frota_unidades', 'locacoes', 'locacao_agendamentos', 'frota_despesas']) {
        mov[tab] = db.prepare(`UPDATE ${tab} SET frota_id=? WHERE frota_id=?`).run(destino.id, origem.id).changes;
      }
      const qtdOrigemSemUnidade = mov.frota_unidades ? 0 : origem.quantidade_total || 0;
      db.prepare('UPDATE frota SET quantidade_total = quantidade_total + ? WHERE id=?').run(qtdOrigemSemUnidade, destino.id);
      db.prepare('DELETE FROM frota WHERE id=?').run(origem.id);
      db.exec('COMMIT');
      syncModelo(destino.id);
      ok(`Modelo "${origem.identificacao}" juntado em "${destino.identificacao}": ${mov.frota_unidades} moto(s) e ${mov.locacoes} locação(ões) movidas.`);
    } catch (e) {
      db.exec('ROLLBACK');
      erro('Não foi possível juntar: ' + e.message);
      return done(() => redirect(res, `/frota/${m.id}/unidades`));
    }
    return done(() => redirect(res, `/frota/${destino.id}/unidades`));
  }

  // Entrada em lote: cola vários chassis, confere (prévia) e cadastra de uma vez.
  if ((m = matchRoute('/frota/:id/lote', pathname)) && method === 'POST') {
    if (!ger) return done(() => forbidden(res));
    const modelo = db.prepare('SELECT * FROM frota WHERE id=?').get(m.id);
    if (!modelo) return done(() => notFound(res));
    const itens = analisarLote(body.chassis);
    const comum = {
      cor: txt(body.cor), ano: int(body.ano), data_compra: txt(body.data_compra), valor_compra: num(body.valor_compra),
      intervalo_revisao_dias: int(body.intervalo_revisao_dias) || 90, observacoes: txt(body.observacoes),
    };
    if (!itens.length) {
      erro('Cole pelo menos um chassi (um por linha).');
      return done(() => redirect(res, `/frota/${m.id}/unidades`));
    }
    const novas = itens.filter((i) => i.status === 'nova');
    if (body.modo === 'gravar') {
      if (!novas.length) {
        erro('Nenhuma moto nova para cadastrar nessa lista.');
        return done(() => redirect(res, `/frota/${m.id}/unidades`));
      }
      const ins = db.prepare(
        `INSERT INTO frota_unidades (frota_id, placa, chassi, renavam, cor, ano, km_atual, data_compra, valor_compra, em_manutencao, ativo,
          data_ultima_revisao, intervalo_revisao_dias, km_prox_pastilha, km_prox_pneu, observacoes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      );
      db.exec('BEGIN');
      try {
        for (const i of novas) {
          if (acharChassiDuplicado(i.chassi)) throw new Error(`chassi ${i.chassi} foi cadastrado enquanto você conferia`);
          const obs = [i.interno ? `Nº interno #${i.interno}` : null, comum.observacoes].filter(Boolean).join('\n') || null;
          ins.run(m.id, null, i.chassi, null, i.cor || comum.cor || modelo.cor || null, comum.ano, 0, comum.data_compra, comum.valor_compra,
            0, 1, null, comum.intervalo_revisao_dias, null, null, obs);
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        erro('Nada foi cadastrado: ' + e.message);
        return done(() => redirect(res, `/frota/${m.id}/unidades`));
      }
      syncModelo(m.id);
      const pulados = itens.length - novas.length;
      ok(`${novas.length} moto(s) cadastrada(s) em ${modelo.identificacao}.` + (pulados ? ` ${pulados} linha(s) ignorada(s) (duplicada ou inválida).` : ''));
      return done(() => redirect(res, `/frota/${m.id}/unidades`));
    }
    // prévia
    const outros = db.prepare('SELECT id, identificacao FROM frota WHERE id<>? ORDER BY identificacao').all(m.id);
    const unidades = unidadesComStatus('u.frota_id=?', [m.id]).map((u) => ({ ...u, revisao: proximaRevisao(u) }));
    const lote = { itens, comum, texto: body.chassis || '' };
    return done(() => send(res, 200, V.unidadesPage({ user, flash: flash(), modelo, unidades, csrfToken, outros, podeGerenciar: ger, lote })));
  }

  if (pathname === '/frota/unidades' && method === 'POST') {
    if (!ger) return done(() => forbidden(res));
    const vals = unidadeDoBody(body);
    if (!vals[0] || !vals[2]) {
      erro('Informe o modelo e o chassi.');
      return done(() => redirect(res, vals[0] ? `/frota/${vals[0]}/unidades` : '/frota'));
    }
    if (vals[2].length < CHASSI_MIN) {
      erro(`Chassi inválido: precisa ter pelo menos ${CHASSI_MIN} letras/números.`);
      return done(() => redirect(res, `/frota/${vals[0]}/unidades`));
    }
    const dup = acharChassiDuplicado(vals[2]);
    if (dup) {
      erro(msgDuplicado(dup));
      return done(() => redirect(res, `/frota/${vals[0]}/unidades`));
    }
    db.prepare(
      `INSERT INTO frota_unidades (frota_id, placa, chassi, renavam, cor, ano, km_atual, data_compra, valor_compra, em_manutencao, ativo,
        data_ultima_revisao, intervalo_revisao_dias, km_prox_pastilha, km_prox_pneu, observacoes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(...vals);
    syncModelo(vals[0]);
    ok('Moto cadastrada.');
    return done(() => redirect(res, `/frota/${vals[0]}/unidades`));
  }
  if ((m = matchRoute('/frota/unidades/:id/editar', pathname)) && method === 'GET') {
    const u = db.prepare('SELECT * FROM frota_unidades WHERE id=?').get(m.id);
    if (!u) return done(() => notFound(res));
    const modelos = db.prepare('SELECT id, identificacao FROM frota ORDER BY identificacao').all();
    const despesas = db.prepare('SELECT * FROM frota_despesas WHERE unidade_id=? ORDER BY data DESC').all(m.id);
    const locacoes = db
      .prepare(
        `SELECT l.*, c.nome cliente_nome FROM locacoes l LEFT JOIN clientes c ON c.id=l.cliente_id
         WHERE l.unidade_id=? OR (l.unidade_id IS NULL AND UPPER(TRIM(l.chassi))=UPPER(TRIM(?))) ORDER BY l.data_saida DESC`
      )
      .all(m.id, u.chassi);
    return done(() => send(res, 200, V.unidadeEditarPage({ user, flash: flash(), u, modelos, despesas, locacoes, csrfToken })));
  }
  if ((m = matchRoute('/frota/unidades/:id/excluir', pathname)) && method === 'POST') {
    if (!ger) return done(() => forbidden(res));
    const u = db.prepare('SELECT * FROM frota_unidades WHERE id=?').get(m.id);
    if (!u) return done(() => notFound(res));
    db.prepare('DELETE FROM frota_unidades WHERE id=?').run(m.id);
    syncModelo(u.frota_id);
    ok('Moto excluída.');
    return done(() => redirect(res, `/frota/${u.frota_id}/unidades`));
  }
  if ((m = matchRoute('/frota/unidades/:id', pathname)) && method === 'POST') {
    if (!ger) return done(() => forbidden(res));
    const u = db.prepare('SELECT * FROM frota_unidades WHERE id=?').get(m.id);
    if (!u) return done(() => notFound(res));
    const vals = unidadeDoBody(body);
    if (!vals[0] || !vals[2]) {
      erro('Informe o modelo e o chassi.');
      return done(() => redirect(res, `/frota/unidades/${m.id}/editar`));
    }
    if (vals[2].length < CHASSI_MIN) {
      erro(`Chassi inválido: precisa ter pelo menos ${CHASSI_MIN} letras/números.`);
      return done(() => redirect(res, `/frota/unidades/${m.id}/editar`));
    }
    const dupE = acharChassiDuplicado(vals[2], u.id);
    if (dupE) {
      erro(msgDuplicado(dupE));
      return done(() => redirect(res, `/frota/unidades/${m.id}/editar`));
    }
    // Locações antigas sem vínculo apontam para a moto pelo texto do chassi. Antes de
    // trocar o chassi, grava o vínculo nelas para não perderem a moto.
    if (vals[2] !== u.chassi) {
      db.prepare('UPDATE locacoes SET unidade_id=? WHERE unidade_id IS NULL AND UPPER(TRIM(chassi))=UPPER(TRIM(?))').run(u.id, u.chassi);
    }
    db.prepare(
      `UPDATE frota_unidades SET frota_id=?, placa=?, chassi=?, renavam=?, cor=?, ano=?, km_atual=?, data_compra=?, valor_compra=?, em_manutencao=?, ativo=?,
        data_ultima_revisao=?, intervalo_revisao_dias=?, km_prox_pastilha=?, km_prox_pneu=?, observacoes=? WHERE id=?`
    ).run(...vals, m.id);
    syncModelo(u.frota_id);
    syncModelo(vals[0]);
    ok('Moto atualizada.');
    return done(() => redirect(res, `/frota/${vals[0]}/unidades`));
  }

  // ---------------- lista de locações
  if ((pathname === '/locacoes' || pathname === '/locacoes/exportar.csv') && method === 'GET') {
    const filtro = {
      status: url.searchParams.get('status') || 'ativa',
      q: url.searchParams.get('q') || '',
      de: url.searchParams.get('de') || '',
      ate: url.searchParams.get('ate') || '',
    };
    const w = [];
    const p = [];
    if (filtro.status !== 'todas') {
      w.push('l.status = ?');
      p.push(filtro.status);
    }
    if (filtro.q) {
      w.push('(c.nome LIKE ? OR l.placa LIKE ? OR l.chassi LIKE ?)');
      p.push(`%${filtro.q}%`, `%${filtro.q}%`, `%${filtro.q}%`);
    }
    if (filtro.de) {
      w.push('l.data_saida >= ?');
      p.push(filtro.de);
    }
    if (filtro.ate) {
      w.push('l.data_saida <= ?');
      p.push(filtro.ate);
    }
    const locacoes = db
      .prepare(
        `SELECT l.*, c.nome cliente_nome, f.identificacao modelo,
           (SELECT COALESCE(SUM(valor),0) FROM locacao_parcelas p WHERE p.locacao_id=l.id AND p.pago=0) aberto,
           (SELECT COUNT(*) FROM locacao_ocorrencias o WHERE o.locacao_id=l.id AND o.concluido=0) oc_pendentes
         FROM locacoes l LEFT JOIN clientes c ON c.id=l.cliente_id LEFT JOIN frota f ON f.id=l.frota_id
         ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY l.id DESC`
      )
      .all(...p);
    if (pathname.endsWith('.csv')) {
      return done(() =>
        enviarCsv(
          res,
          `locacoes-${hoje()}.csv`,
          ['ID', 'Cliente', 'Modelo', 'Placa', 'Chassi', 'Saída', 'Retorno previsto', 'Devolução', 'Valor total', 'Em aberto', 'Entrada', 'Status'],
          locacoes.map((l) => [l.id, l.cliente_nome, l.modelo, l.placa, l.chassi, l.data_saida, l.devolucao_prevista, l.data_devolucao, l.valor_combinado, l.aberto, l.valor_caucao, l.status])
        )
      );
    }
    return done(() => send(res, 200, V.locacoesListPage({ user, flash: flash(), locacoes, filtro })));
  }

  // ---------------- detalhe da locação
  if ((m = matchRoute('/locacoes/:id', pathname)) && method === 'GET' && /^\d+$/.test(m.id)) {
    const loc = locacaoCompleta(m.id);
    if (!loc) return done(() => notFound(res));
    const parcelas = db.prepare('SELECT * FROM locacao_parcelas WHERE locacao_id=? ORDER BY numero').all(m.id);
    const ocorrencias = db.prepare('SELECT * FROM locacao_ocorrencias WHERE locacao_id=? ORDER BY created_at DESC').all(m.id);
    const modelosContrato = db.prepare('SELECT id, titulo FROM contrato_modelos ORDER BY titulo').all();
    return done(() => send(res, 200, V.locacaoDetalhePage({ user, flash: flash(), loc, parcelas, ocorrencias, modelosContrato, csrfToken, podeGerenciar: ger })));
  }
  if ((m = matchRoute('/locacoes/:id/dados', pathname)) && method === 'POST') {
    if (!ger) return done(() => forbidden(res));
    if (!db.prepare('SELECT id FROM locacoes WHERE id=?').get(m.id)) return done(() => notFound(res));
    db.prepare(
      `UPDATE locacoes SET data_saida=COALESCE(?, data_saida), hora_saida=?, devolucao_prevista=?, hora_retorno=?, km_saida=?, valor_caucao=?,
        testemunha1_nome=?, testemunha1_rg=?, testemunha2_nome=?, testemunha2_rg=?, fiador_nome=?, fiador_dados=?, compra_garantida=?, observacoes=? WHERE id=?`
    ).run(
      txt(body.data_saida), txt(body.hora_saida), txt(body.devolucao_prevista), txt(body.hora_retorno), int(body.km_saida), num(body.valor_caucao),
      txt(body.testemunha1_nome), txt(body.testemunha1_rg), txt(body.testemunha2_nome), txt(body.testemunha2_rg), txt(body.fiador_nome), txt(body.fiador_dados),
      chk(body.compra_garantida), txt(body.observacoes), m.id
    );
    // Mantém a parcela de entrada coerente com o valor informado.
    const entrada = num(body.valor_caucao) || 0;
    const pe = db.prepare("SELECT * FROM locacao_parcelas WHERE locacao_id=? AND origem='entrada'").get(m.id);
    let avisoEntrada = '';
    if (pe && !pe.pago) {
      if (entrada > 0) db.prepare('UPDATE locacao_parcelas SET valor=? WHERE id=?').run(entrada, pe.id);
      else db.prepare('DELETE FROM locacao_parcelas WHERE id=?').run(pe.id);
    } else if (pe && pe.pago && Math.abs(entrada - pe.valor) > 0.009) {
      avisoEntrada = ' A entrada já está paga com outro valor: desfaça o pagamento dela na lista de parcelas antes de mudar.';
      db.prepare('UPDATE locacoes SET valor_caucao=? WHERE id=?').run(pe.valor, m.id);
    } else if (!pe && entrada > 0) {
      db.prepare("INSERT INTO locacao_parcelas (locacao_id, numero, valor, vencimento, origem) VALUES (?, 0, ?, date('now'), 'entrada')").run(m.id, entrada);
    }
    db.prepare('UPDATE locacoes SET valor_combinado = (SELECT SUM(valor) FROM locacao_parcelas WHERE locacao_id=?) WHERE id=?').run(m.id, m.id);
    ok('Dados da locação salvos.' + avisoEntrada);
    return done(() => redirect(res, `/locacoes/${m.id}`));
  }
  if ((m = matchRoute('/locacoes/:id/devolver', pathname)) && method === 'POST') {
    const loc = db.prepare('SELECT * FROM locacoes WHERE id=?').get(m.id);
    if (!loc) return done(() => notFound(res));
    const km = int(body.km_retorno);
    db.prepare("UPDATE locacoes SET status='devolvida', data_devolucao=date('now'), km_retorno=COALESCE(?, km_retorno), caucao_devolvida=? WHERE id=?").run(
      km, chk(body.caucao_devolvida), m.id
    );
    if (km !== null && loc.unidade_id) db.prepare('UPDATE frota_unidades SET km_atual=? WHERE id=?').run(km, loc.unidade_id);
    const aberto = db.prepare('SELECT COALESCE(SUM(valor),0) v FROM locacao_parcelas WHERE locacao_id=? AND pago=0').get(m.id).v;
    ok('Devolução registrada — moto disponível de novo.' + (aberto > 0 ? ` Atenção: ${formatMoney(aberto)} ainda em aberto nesta locação.` : ''));
    return done(() => redirect(res, body.voltar === 'frota' ? '/frota' : `/locacoes/${m.id}`));
  }
  if ((m = matchRoute('/locacoes/:id/parcela-avulsa', pathname)) && method === 'POST') {
    if (!ger) return done(() => forbidden(res));
    const valor = num(body.valor);
    if (!valor || valor <= 0) {
      erro('Informe o valor.');
      return done(() => redirect(res, `/locacoes/${m.id}`));
    }
    adicionarParcela(m.id, valor, txt(body.vencimento) || hoje());
    ok('Cobrança adicionada.');
    return done(() => redirect(res, `/locacoes/${m.id}`));
  }
  if ((m = matchRoute('/locacoes/:id/ocorrencias', pathname)) && method === 'POST') {
    if (!db.prepare('SELECT id FROM locacoes WHERE id=?').get(m.id)) return done(() => notFound(res));
    const tipo = V.TIPOS_OCORRENCIA[body.tipo] ? body.tipo : 'outros';
    const valor = num(body.valor);
    db.prepare('INSERT INTO locacao_ocorrencias (locacao_id, tipo, data_hora, valor, descricao, cobrar_cliente) VALUES (?,?,?,?,?,?)').run(
      m.id, tipo, txt(body.data_hora), valor, txt(body.descricao), body.acao_valor === 'cobrar' ? 1 : 0
    );
    let extra = '';
    if (valor && valor > 0 && ger && body.acao_valor === 'cobrar') {
      adicionarParcela(m.id, valor, hoje(), 'ocorrencia:' + tipo);
      extra = ' Cobrança gerada.';
    } else if (valor && valor > 0 && ger && body.acao_valor === 'abater') {
      extra = abaterDasParcelas(m.id, valor);
    } else if (valor && !ger && body.acao_valor) {
      extra = ' (Só a gerência pode mexer nas parcelas — valor apenas registrado.)';
    }
    ok('Ocorrência registrada.' + extra);
    return done(() => redirect(res, `/locacoes/${m.id}`));
  }
  if ((m = matchRoute('/locacoes/ocorrencias/:id/concluir', pathname)) && method === 'POST') {
    const o = db.prepare('SELECT * FROM locacao_ocorrencias WHERE id=?').get(m.id);
    if (!o) return done(() => notFound(res));
    db.prepare('UPDATE locacao_ocorrencias SET concluido=1 WHERE id=?').run(m.id);
    ok('Ocorrência concluída.');
    return done(() => redirect(res, `/locacoes/${o.locacao_id}`));
  }
  if ((m = matchRoute('/locacoes/:id/contrato', pathname)) && method === 'GET') {
    const modelo = db.prepare('SELECT * FROM contrato_modelos WHERE id=?').get(url.searchParams.get('modelo'));
    const vars = variaveisContrato(m.id);
    if (!modelo || !vars) return done(() => notFound(res));
    return done(() => send(res, 200, V.contratoImpressaoPage({ titulo: `${modelo.titulo} — ${vars.cliente_nome || ''}`, corpoHtml: renderContrato(modelo.corpo, vars) })));
  }

  // ---------------- parcelas (pagar/estornar com volta pra tela certa)
  if ((m = matchRoute('/parcelas/:id/:acao', pathname)) && method === 'POST' && (m.acao === 'pagar' || m.acao === 'estornar')) {
    if (!ger) return done(() => forbidden(res));
    const pc = db.prepare('SELECT * FROM locacao_parcelas WHERE id=?').get(m.id);
    if (!pc) return done(() => notFound(res));
    if (m.acao === 'pagar') {
      db.prepare("UPDATE locacao_parcelas SET pago=1, data_pagamento=date('now'), forma_pagamento=? WHERE id=?").run(txt(body.forma_pagamento), m.id);
      const loc = db.prepare('SELECT * FROM locacoes WHERE id=?').get(pc.locacao_id);
      const falta = db.prepare('SELECT COUNT(*) c FROM locacao_parcelas WHERE locacao_id=? AND pago=0').get(pc.locacao_id).c;
      let extra = '';
      if (loc && loc.compra_garantida && loc.status === 'ativa' && falta === 0) {
        // Compra garantida quitada: a moto sai da frota e a locação é encerrada.
        if (loc.unidade_id) {
          const cli = db.prepare('SELECT nome FROM clientes WHERE id=?').get(loc.cliente_id) || {};
          db.prepare("UPDATE frota_unidades SET ativo=0, observacoes=TRIM(COALESCE(observacoes,'') || ' ' || ?) WHERE id=?").run(
            `[Transferida a ${cli.nome || 'cliente'} em ${brData(hoje())} — compra garantida quitada, locação #${loc.id}]`, loc.unidade_id
          );
          const u = db.prepare('SELECT frota_id FROM frota_unidades WHERE id=?').get(loc.unidade_id);
          if (u) syncModelo(u.frota_id);
        }
        db.prepare("UPDATE locacoes SET status='quitada', data_devolucao=date('now') WHERE id=?").run(loc.id);
        extra = ' Todas as parcelas quitadas: a moto agora é do cliente (compra garantida) e saiu da frota.' + (loc.unidade_id ? '' : ' Esta locação não tinha moto cadastrada vinculada; ajuste a quantidade do modelo.');
      }
      ok('Parcela recebida.' + extra);
    } else {
      db.prepare('UPDATE locacao_parcelas SET pago=0, data_pagamento=NULL, forma_pagamento=NULL WHERE id=?').run(m.id);
      ok('Pagamento da parcela desfeito.');
    }
    const v = String(body.voltar || '');
    const dest = v === 'cobranca' ? '/frota/cobranca' : v.startsWith('loc') ? `/locacoes/${int(v.slice(3))}` : v === 'painel' ? '/locacao' : '/frota';
    return done(() => redirect(res, dest));
  }

  // ---------------- despesas
  if (pathname === '/frota/despesas' && method === 'GET') {
    if (!ger) return done(() => forbidden(res));
    const t = hoje();
    const filtro = { de: url.searchParams.get('de') || t.slice(0, 8) + '01', ate: url.searchParams.get('ate') || t };
    const despesas = db
      .prepare(
        `SELECT d.*, u.placa, u.chassi, f.identificacao modelo, fo.nome fornecedor_nome FROM frota_despesas d
         LEFT JOIN frota_unidades u ON u.id=d.unidade_id LEFT JOIN frota f ON f.id=COALESCE(d.frota_id,u.frota_id)
         LEFT JOIN fornecedores fo ON fo.id=d.fornecedor_id WHERE d.data BETWEEN ? AND ? ORDER BY d.data DESC, d.id DESC`
      )
      .all(filtro.de, filtro.ate);
    const total = despesas.reduce((s, d) => s + (Number(d.valor) || 0), 0);
    const unidades = unidadesComStatus('u.ativo=1');
    const fornecedores = db.prepare('SELECT id, nome FROM fornecedores WHERE ativo=1 ORDER BY nome').all();
    return done(() =>
      send(res, 200, V.despesasPage({ user, flash: flash(), despesas, unidades, fornecedores, filtro, total, csrfToken, preUnidade: url.searchParams.get('unidade') }))
    );
  }
  if (pathname === '/frota/despesas' && method === 'POST') {
    if (!ger) return done(() => forbidden(res));
    const valor = num(body.valor);
    if (!valor || valor <= 0 || !txt(body.data)) {
      erro('Informe data e valor.');
      return done(() => redirect(res, '/frota/despesas'));
    }
    const unidadeId = int(body.unidade_id);
    const u = unidadeId ? db.prepare('SELECT * FROM frota_unidades WHERE id=?').get(unidadeId) : null;
    const fornecedorId = int(body.fornecedor_id);
    let contaId = null;
    if (chk(body.lancar_financeiro)) {
      const desc = `Frota: ${txt(body.categoria) || 'despesa'}${u ? ' — ' + (u.placa || u.chassi) : ''}${txt(body.descricao) ? ' — ' + txt(body.descricao) : ''}`;
      contaId = db
        .prepare("INSERT INTO contas_pagar (descricao, valor, vencimento, status, fornecedor_id, loja_id) VALUES (?, ?, ?, 'pendente', ?, ?)")
        .run(desc, valor, txt(body.data), fornecedorId, user.loja_id || null).lastInsertRowid;
    }
    db.prepare('INSERT INTO frota_despesas (unidade_id, frota_id, fornecedor_id, categoria, data, km, descricao, valor, conta_pagar_id) VALUES (?,?,?,?,?,?,?,?,?)').run(
      unidadeId, u ? u.frota_id : null, fornecedorId, txt(body.categoria), txt(body.data), int(body.km), txt(body.descricao), valor, contaId
    );
    if (u) {
      const km = int(body.km);
      if (km !== null && (u.km_atual === null || km > u.km_atual)) db.prepare('UPDATE frota_unidades SET km_atual=? WHERE id=?').run(km, u.id);
      if (chk(body.registrar_revisao)) db.prepare('UPDATE frota_unidades SET data_ultima_revisao=? WHERE id=?').run(txt(body.data), u.id);
    }
    ok('Despesa lançada.' + (contaId ? ' Também foi pra Contas a Pagar.' : ''));
    return done(() => redirect(res, '/frota/despesas'));
  }
  if ((m = matchRoute('/frota/despesas/:id/excluir', pathname)) && method === 'POST') {
    if (!ger) return done(() => forbidden(res));
    db.prepare('DELETE FROM frota_despesas WHERE id=?').run(m.id);
    ok('Despesa excluída (se foi pra Contas a Pagar, exclua lá também).');
    return done(() => redirect(res, '/frota/despesas'));
  }

  // ---------------- agendamentos
  if (pathname === '/frota/agendamentos' && method === 'GET') {
    const agendamentos = db
      .prepare(
        `SELECT a.*, c.nome cliente_nome, f.identificacao modelo FROM locacao_agendamentos a
         LEFT JOIN clientes c ON c.id=a.cliente_id LEFT JOIN frota f ON f.id=a.frota_id
         ORDER BY (a.status<>'agendado'), a.data_saida ASC LIMIT 200`
      )
      .all();
    const modelos = db.prepare('SELECT id, identificacao FROM frota WHERE ativo=1 ORDER BY identificacao').all();
    const clientes = db.prepare('SELECT id, nome FROM clientes ORDER BY nome').all();
    return done(() => send(res, 200, V.agendamentosPage({ user, flash: flash(), agendamentos, modelos, clientes, csrfToken })));
  }
  if (pathname === '/frota/agendamentos' && method === 'POST') {
    if (!int(body.cliente_id) || !int(body.frota_id) || !txt(body.data_saida)) {
      erro('Cliente, modelo e data de saída são obrigatórios.');
      return done(() => redirect(res, '/frota/agendamentos'));
    }
    db.prepare(
      `INSERT INTO locacao_agendamentos (frota_id, cliente_id, data_saida, hora_saida, data_retorno, hora_retorno, valor_total, desconto, valor_pago, observacoes)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(int(body.frota_id), int(body.cliente_id), txt(body.data_saida), txt(body.hora_saida), txt(body.data_retorno), txt(body.hora_retorno),
      num(body.valor_total), num(body.desconto) || 0, num(body.valor_pago) || 0, txt(body.observacoes));
    ok('Agendamento criado.');
    return done(() => redirect(res, '/frota/agendamentos'));
  }
  if ((m = matchRoute('/frota/agendamentos/:id/cancelar', pathname)) && method === 'POST') {
    db.prepare("UPDATE locacao_agendamentos SET status='cancelado' WHERE id=? AND status='agendado'").run(m.id);
    ok('Agendamento cancelado.');
    return done(() => redirect(res, '/frota/agendamentos'));
  }

  // ---------------- modelos de contrato
  if (pathname.startsWith('/frota/contratos-modelos') && !ger) return done(() => forbidden(res));
  if (pathname === '/frota/contratos-modelos' && method === 'GET') {
    const modelos = db.prepare('SELECT * FROM contrato_modelos ORDER BY titulo').all();
    return done(() => send(res, 200, V.contratoModelosPage({ user, flash: flash(), modelos, csrfToken })));
  }
  if (pathname === '/frota/contratos-modelos/novo' && method === 'GET') {
    return done(() => send(res, 200, V.contratoModeloFormPage({ user, flash: flash(), modelo: null, csrfToken })));
  }
  if (pathname === '/frota/contratos-modelos' && method === 'POST') {
    if (!txt(body.titulo)) {
      erro('Informe o título.');
      return done(() => redirect(res, '/frota/contratos-modelos/novo'));
    }
    db.prepare('INSERT INTO contrato_modelos (titulo, corpo) VALUES (?, ?)').run(txt(body.titulo), body.corpo || '');
    ok('Modelo salvo.');
    return done(() => redirect(res, '/frota/contratos-modelos'));
  }
  if ((m = matchRoute('/frota/contratos-modelos/:id/editar', pathname)) && method === 'GET') {
    const modelo = db.prepare('SELECT * FROM contrato_modelos WHERE id=?').get(m.id);
    if (!modelo) return done(() => notFound(res));
    return done(() => send(res, 200, V.contratoModeloFormPage({ user, flash: flash(), modelo, csrfToken })));
  }
  if ((m = matchRoute('/frota/contratos-modelos/:id/excluir', pathname)) && method === 'POST') {
    db.prepare('DELETE FROM contrato_modelos WHERE id=?').run(m.id);
    ok('Modelo excluído.');
    return done(() => redirect(res, '/frota/contratos-modelos'));
  }
  if ((m = matchRoute('/frota/contratos-modelos/:id', pathname)) && method === 'POST') {
    if (!txt(body.titulo)) {
      erro('Informe o título.');
      return done(() => redirect(res, `/frota/contratos-modelos/${m.id}/editar`));
    }
    db.prepare("UPDATE contrato_modelos SET titulo=?, corpo=?, updated_at=datetime('now') WHERE id=?").run(txt(body.titulo), body.corpo || '', m.id);
    ok('Modelo atualizado.');
    return done(() => redirect(res, '/frota/contratos-modelos'));
  }

  // ---------------- revisões (frota da locação + motos vendidas)
  if (pathname === '/frota/revisoes' && method === 'GET') {
    const lista = [];
    for (const u of unidadesComStatus('u.ativo=1')) {
      const rv = proximaRevisao(u);
      if (!rv) continue;
      const cli = u.locacao_id
        ? db.prepare('SELECT c.nome, c.telefone FROM locacoes l JOIN clientes c ON c.id=l.cliente_id WHERE l.id=?').get(u.locacao_id)
        : null;
      lista.push({ tipo: 'locacao', id: u.id, modelo: u.modelo, chassi: u.placa || u.chassi, cliente: cli && cli.nome, telefone: cli && cli.telefone, ...rv });
    }
    // Vendidas: base = última revisão (botão ou O.S. concluída do mesmo chassi) ou data da venda.
    const gs = db
      .prepare(
        `SELECT g.*, c.nome AS cliente_nome, c.telefone AS cliente_tel,
           (SELECT MAX(substr(o.data_conclusao,1,10)) FROM ordens_servico o JOIN bicicletas b ON b.id=o.bicicleta_id
             WHERE o.status='concluida' AND g.chassi_numero IS NOT NULL AND g.chassi_numero<>''
               AND UPPER(TRIM(b.chassi_numero))=UPPER(TRIM(g.chassi_numero))) AS ultima_os
         FROM garantias g LEFT JOIN clientes c ON c.id=g.cliente_id`
      )
      .all();
    for (const g of gs) {
      const ultima = [g.data_ultima_revisao, g.ultima_os].filter(Boolean).sort().pop() || null;
      const rv = proximaRevisao({ data_ultima_revisao: ultima, primeira_locacao: g.data_venda, intervalo_revisao_dias: 90 });
      if (!rv) continue;
      // Garantia de 24 meses: depois disso não precisa mais de alerta.
      const fimGarantia = new Date(String(g.data_venda).slice(0, 10) + 'T00:00:00');
      fimGarantia.setMonth(fimGarantia.getMonth() + (g.meses_geral || Math.max(g.meses_motor || 0, g.meses_bateria || 0, g.meses_controladora || 0) || 24));
      if (fimGarantia.toISOString().slice(0, 10) < hoje()) continue;
      lista.push({ tipo: 'venda', id: g.id, modelo: g.descricao_produto, chassi: g.chassi_numero, cliente: g.cliente_nome, telefone: g.cliente_tel, ...rv, origem: ultima ? 'revisao' : 'venda' });
    }
    lista.sort((a, b) => a.dias - b.dias);
    const filtro = url.searchParams.get('ver') || 'proximas';
    const mostrar = filtro === 'todas' ? lista : lista.filter((x) => x.dias <= 15);
    return done(() => send(res, 200, V.revisoesPage({ user, flash: flash(), lista: mostrar, total: lista.length, filtro, csrfToken })));
  }
  if ((m = matchRoute('/frota/revisoes/:tipo/:id/feita', pathname)) && method === 'POST') {
    const data = txt(body.data) || hoje();
    if (m.tipo === 'venda') db.prepare('UPDATE garantias SET data_ultima_revisao=? WHERE id=?').run(data, m.id);
    else if (m.tipo === 'locacao') db.prepare('UPDATE frota_unidades SET data_ultima_revisao=? WHERE id=?').run(data, m.id);
    ok('Revisão registrada — próxima em 90 dias.');
    return done(() => redirect(res, '/frota/revisoes' + (body.ver === 'todas' ? '?ver=todas' : '')));
  }

  // ---------------- importação do WSYS
  if (pathname === '/frota/importar' && (method === 'GET' || method === 'POST')) {
    if (!ger) return done(() => forbidden(res));
    let relatorio = null;
    let erroImp = null;
    let modo = null;
    if (method === 'POST') {
      modo = body.modo === 'importar' ? 'importar' : 'simular';
      try {
        const dados = JSON.parse(body.dados || '{}');
        relatorio = require('./importWsys').importar(dados, { simular: modo !== 'importar' });
      } catch (e) {
        erroImp = String(e && e.message ? e.message : e);
      }
    }
    return done(() => send(res, 200, V.importarPage({ user, flash: flash(), csrfToken, relatorio, erroImp, modo, dadosTexto: method === 'POST' && modo !== 'importar' ? body.dados || '' : '' })));
  }

  // ---------------- relatórios
  if (pathname === '/frota/relatorios' && method === 'GET') {
    if (!ger) return done(() => forbidden(res));
    const filtro = { de: url.searchParams.get('de') || '2000-01-01', ate: url.searchParams.get('ate') || hoje() };
    const porMoto = unidadesComStatus('1=1').map((u) => {
      const r = db
        .prepare(
          `SELECT COALESCE(SUM(p.valor),0) v FROM locacao_parcelas p JOIN locacoes l ON l.id=p.locacao_id
           WHERE p.pago=1 AND p.data_pagamento BETWEEN ? AND ?
             AND (l.unidade_id=? OR (l.unidade_id IS NULL AND UPPER(TRIM(l.chassi))=UPPER(TRIM(?))))`
        )
        .get(filtro.de, filtro.ate, u.id, u.chassi).v;
      const q = db
        .prepare('SELECT COUNT(*) c FROM locacoes l WHERE l.unidade_id=? OR (l.unidade_id IS NULL AND UPPER(TRIM(l.chassi))=UPPER(TRIM(?)))')
        .get(u.id, u.chassi).c;
      const d = db.prepare('SELECT COALESCE(SUM(valor),0) v FROM frota_despesas WHERE unidade_id=? AND data BETWEEN ? AND ?').get(u.id, filtro.de, filtro.ate).v;
      return { ...u, receita: r, despesas: d, resultado: r - d, qtd_locacoes: q };
    });
    // Receita de locações sem moto cadastrada + despesas gerais, pra o total bater.
    const semMotoR = db
      .prepare(
        `SELECT COALESCE(SUM(p.valor),0) v FROM locacao_parcelas p JOIN locacoes l ON l.id=p.locacao_id
         WHERE p.pago=1 AND p.data_pagamento BETWEEN ? AND ? AND l.unidade_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM frota_unidades u WHERE UPPER(TRIM(u.chassi))=UPPER(TRIM(l.chassi)))`
      )
      .get(filtro.de, filtro.ate).v;
    const geralD = db.prepare('SELECT COALESCE(SUM(valor),0) v FROM frota_despesas WHERE unidade_id IS NULL AND data BETWEEN ? AND ?').get(filtro.de, filtro.ate).v;
    if (semMotoR || geralD) porMoto.push({ modelo: '(sem moto cadastrada / despesas gerais)', placa: '—', receita: semMotoR, despesas: geralD, resultado: semMotoR - geralD, qtd_locacoes: '—' });
    porMoto.sort((a, b) => b.resultado - a.resultado);
    const porMes = [];
    const d0 = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(d0.getFullYear(), d0.getMonth() - i, 1);
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const g = (sql) => db.prepare(sql).get(mes).v || 0;
      porMes.push({
        mes: `${MESES[d.getMonth()].slice(0, 3)}/${d.getFullYear()}`,
        previsto: g('SELECT SUM(valor) v FROM locacao_parcelas WHERE substr(vencimento,1,7)=?'),
        recebido: g('SELECT SUM(valor) v FROM locacao_parcelas WHERE pago=1 AND substr(data_pagamento,1,7)=?'),
        despesas: g('SELECT SUM(valor) v FROM frota_despesas WHERE substr(data,1,7)=?'),
      });
    }
    return done(() => send(res, 200, V.relatoriosLocacaoPage({ user, flash: flash(), porMoto, porMes, filtro })));
  }

  return false;
}

function adicionarParcela(locId, valor, vencimento, origem = 'avulsa') {
  const n = db.prepare('SELECT COALESCE(MAX(numero),0)+1 n FROM locacao_parcelas WHERE locacao_id=?').get(locId).n;
  db.prepare('INSERT INTO locacao_parcelas (locacao_id, numero, valor, vencimento, origem) VALUES (?,?,?,?,?)').run(locId, n, valor, vencimento, origem);
  db.prepare('UPDATE locacoes SET valor_combinado = (SELECT SUM(valor) FROM locacao_parcelas WHERE locacao_id=?) WHERE id=?').run(locId, locId);
}

// Abate um valor das parcelas em aberto (da mais próxima pra frente).
function abaterDasParcelas(locId, valor) {
  let resta = valor;
  const ps = db.prepare('SELECT * FROM locacao_parcelas WHERE locacao_id=? AND pago=0 AND origem IS NULL ORDER BY vencimento, numero').all(locId);
  for (const p of ps) {
    if (resta <= 0) break;
    const tira = Math.min(resta, Number(p.valor) || 0);
    db.prepare('UPDATE locacao_parcelas SET valor=? WHERE id=?').run(Math.round(((Number(p.valor) || 0) - tira) * 100) / 100, p.id);
    resta -= tira;
  }
  db.prepare('UPDATE locacoes SET valor_combinado = (SELECT SUM(valor) FROM locacao_parcelas WHERE locacao_id=?) WHERE id=?').run(locId, locId);
  return resta > 0.009 ? ` Abatido ${formatMoney(valor - resta)} (não havia parcela em aberto pro restante).` : ` Abatido ${formatMoney(valor)} das próximas parcelas.`;
}

module.exports = { handleLocacaoPro, syncModelo, SQL_LOC_ATIVA_DA_UNIDADE, normChassi };
