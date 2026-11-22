'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatMoney, formatDateOnly } = require('../utils');

function diasAteHoje(dataIso) {
  if (!dataIso) return null;
  const base = String(dataIso).length <= 10 ? dataIso + 'T00:00:00' : dataIso;
  const d = new Date(base);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((d - hoje) / 86400000);
}

// Monta o texto de uma locação ativa (quem está com a moto + status de devolução).
function textoLocacao(loc) {
  let texto = loc.cliente_nome ? 'com <strong>' + escapeHtml(loc.cliente_nome) + '</strong>' : 'locada';
  let atrasada = false;
  if (loc.devolucao_prevista) {
    const dias = diasAteHoje(loc.devolucao_prevista);
    if (dias < 0) {
      texto += ' — <span style="color:#a1352a;font-weight:600;">atrasada ' + Math.abs(dias) + ' dia(s)</span> (previsto ' + formatDateOnly(loc.devolucao_prevista) + ')';
      atrasada = true;
    } else if (dias === 0) {
      texto += ' — <strong>devolve hoje</strong>';
    } else {
      texto += ' — devolve ' + formatDateOnly(loc.devolucao_prevista) + ' (' + dias + ' dia(s))';
    }
  }
  return { texto, atrasada };
}

// Badge de status de pagamento de uma locação: Pago (verde), Vencido (vermelho,
// quando passou do vencimento sem pagar) ou Pendente (amarelo).
function pagamentoBadge(loc) {
  if (loc.pago) return '<span style="font-size:12px;padding:2px 8px;border-radius:10px;background:rgba(27,122,67,0.12);color:#1b7a43;">Pago</span>';
  const d = diasAteHoje(loc.vencimento);
  if (loc.vencimento && d !== null && d < 0) {
    return '<span style="font-size:12px;padding:2px 8px;border-radius:10px;background:rgba(161,53,42,0.12);color:#a1352a;">Vencido</span>';
  }
  return '<span style="font-size:12px;padding:2px 8px;border-radius:10px;background:rgba(176,137,0,0.16);color:#8a6d00;">Pendente</span>';
}

// Opções de período com a tarifa do modelo embutida (pra o JS calcular o valor).
function periodoOpcoes(modelo) {
  const o = [];
  if (modelo && modelo.valor_diaria != null) o.push(`<option value="diaria" data-rate="${modelo.valor_diaria}" data-dias="1">Diária (${formatMoney(modelo.valor_diaria)})</option>`);
  if (modelo && modelo.valor_semanal != null) o.push(`<option value="semanal" data-rate="${modelo.valor_semanal}" data-dias="7" selected>Semana (${formatMoney(modelo.valor_semanal)})</option>`);
  if (modelo && modelo.valor_mensal != null) o.push(`<option value="mensal" data-rate="${modelo.valor_mensal}" data-dias="30">Mês (${formatMoney(modelo.valor_mensal)})</option>`);
  return o.join('');
}
// Bloco período + quantidade. Só aparece se o modelo tiver pelo menos uma tarifa.
function periodoBloco(modelo, baseDate) {
  const opts = periodoOpcoes(modelo);
  if (!opts) return '';
  return `
    <div class="form-grid loc-periodo-wrap" data-base="${baseDate || ''}">
      <div class="field">
        <label>Período (gera as parcelas)</label>
        <select class="loc-periodo" name="periodo"><option value="">(digitar valor manual)</option>${opts}</select>
      </div>
      <div class="field">
        <label>Quantas? (ex: 4 semanas = 4 parcelas)</label>
        <input type="number" class="loc-qtd" name="quantas" min="1" step="1" placeholder="Ex: 4">
      </div>
    </div>`;
}
const PERIODO_SCRIPT = `
  function frPeriodoCalc(wrap){
    var sel=wrap.querySelector('.loc-periodo'), qtd=wrap.querySelector('.loc-qtd');
    if(!sel||!qtd) return;
    var form=wrap.closest('form');
    var valor=form&&form.querySelector('input[name=valor_combinado]');
    var dev=form&&form.querySelector('input[name=devolucao_prevista]');
    var opt=sel.options[sel.selectedIndex];
    var rate=opt?parseFloat(opt.getAttribute('data-rate')):NaN;
    var dias=opt?parseInt(opt.getAttribute('data-dias'),10):NaN;
    var n=parseInt(qtd.value,10);
    if(sel.value&&!isNaN(rate)&&!isNaN(n)&&n>0){
      if(valor) valor.value=(rate*n).toFixed(2);
      if(dev&&!isNaN(dias)){
        var base=wrap.getAttribute('data-base');
        var d=base?new Date(base+'T00:00:00'):new Date();
        d.setDate(d.getDate()+dias*n);
        dev.value=d.toISOString().slice(0,10);
      }
    }
  }
  function frPeriodoInit(){
    document.querySelectorAll('.loc-periodo-wrap').forEach(function(w){
      var s=w.querySelector('.loc-periodo'), q=w.querySelector('.loc-qtd');
      if(s) s.addEventListener('change',function(){frPeriodoCalc(w);});
      if(q) q.addEventListener('input',function(){frPeriodoCalc(w);});
    });
  }
  if(document.readyState!=='loading') frPeriodoInit(); else document.addEventListener('DOMContentLoaded', frPeriodoInit);
`;

function frotaPainelPage({ user, flash, modelos, clientes, csrfToken, podeGerenciar = true, totalReceber = 0, qtdPendentes = 0, prefill = null }) {
  const hojeStr = new Date().toISOString().slice(0, 10);
  modelos = modelos || [];
  // Calcula aqui, a partir das locações ativas, pra o contador grande bater
  // sempre com as linhas de cada moto (mesma base de data do navegador).
  modelos.forEach((m) => {
    const locs = m.locacoes || [];
    m.alugadas = locs.length;
    m.atrasadas = locs.filter((l) => {
      const d = diasAteHoje(l.devolucao_prevista);
      return d !== null && d < 0;
    }).length;
    m.em_manutencao = m.em_manutencao || 0;
    m.disponiveis = Math.max(0, (m.quantidade_total || 0) - m.alugadas - m.em_manutencao);
  });
  const totDisp = modelos.reduce((s, m) => s + m.disponiveis, 0);
  const totAlug = modelos.reduce((s, m) => s + m.alugadas, 0);
  const totManut = modelos.reduce((s, m) => s + m.em_manutencao, 0);
  const totAtras = modelos.reduce((s, m) => s + m.atrasadas, 0);

  const clienteOptions = (clientes || []).map((c) => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');

  const cards = modelos
    .map((m) => {
      const valores = [
        m.valor_diaria != null ? 'Diária ' + formatMoney(m.valor_diaria) : null,
        m.valor_semanal != null ? 'Semana ' + formatMoney(m.valor_semanal) : null,
        m.valor_mensal != null ? 'Mês ' + formatMoney(m.valor_mensal) : null,
      ].filter(Boolean).join(' · ');

      const dispBadge = m.disponiveis > 0 ? 'badge-ok' : 'badge-desativada';

      // Linhas das locações ativas deste modelo
      const locacoesHtml = (m.locacoes || [])
        .map((loc) => {
          const t = textoLocacao(loc);
          const ident = [loc.chassi ? 'chassi ' + escapeHtml(loc.chassi) : null, loc.placa ? 'placa ' + escapeHtml(loc.placa) : null, loc.cor ? escapeHtml(loc.cor) : null].filter(Boolean).join(' · ');
          const fotos = [
            loc.foto_moto_caminho ? `<a class="link-btn" href="/uploads/${escapeHtml(loc.foto_moto_caminho)}" target="_blank">foto 1</a>` : null,
            loc.foto_moto2_caminho ? `<a class="link-btn" href="/uploads/${escapeHtml(loc.foto_moto2_caminho)}" target="_blank">foto 2</a>` : null,
            loc.foto_moto3_caminho ? `<a class="link-btn" href="/uploads/${escapeHtml(loc.foto_moto3_caminho)}" target="_blank">foto 3</a>` : null,
            loc.foto_moto4_caminho ? `<a class="link-btn" href="/uploads/${escapeHtml(loc.foto_moto4_caminho)}" target="_blank">foto 4</a>` : null,
            loc.foto_cnh_caminho ? `<a class="link-btn" href="/uploads/${escapeHtml(loc.foto_cnh_caminho)}" target="_blank">CNH</a>` : null,
          ].filter(Boolean).join(' · ');
          const nParc = loc.parcelas_total || 0;
          const allPaid = nParc > 0 && (loc.parcelas_pagas || 0) >= nParc;
          const pagItems = nParc > 0
            ? (allPaid
                ? '<strong>' + formatMoney(loc.valor_total || 0) + '</strong> ' + pagamentoBadge({ pago: 1 })
                : '<strong>' + formatMoney(loc.valor_total || 0) + '</strong> ' + pagamentoBadge({ pago: 0, vencimento: loc.proxima_venc }) +
                  (nParc > 1 ? ' <span class="muted">' + (loc.parcelas_pagas || 0) + '/' + nParc + ' parcelas pagas · falta ' + formatMoney(loc.valor_aberto || 0) + '</span>' : '') +
                  (loc.proxima_venc ? ' <span class="muted">próx. venc. ' + formatDateOnly(loc.proxima_venc) + '</span>' : ''))
            : '';
          return `
            <div style="padding:10px 0;border-top:1px solid var(--border);${t.atrasada ? 'background:rgba(161,53,42,0.04);' : ''}">
              <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start;">
                <div>
                  <div>${t.texto}</div>
                  ${ident ? `<div class="muted" style="font-size:13px;margin-top:2px;">${ident}</div>` : ''}
                  <div style="font-size:13px;margin-top:4px;">${pagItems}</div>
                  <div class="muted" style="font-size:13px;margin-top:2px;">saída ${formatDateOnly(loc.data_saida)}${fotos ? ' · ' + fotos : ''}</div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  <a class="btn btn-sm btn-secondary" href="/locacoes/${loc.id}">Detalhes</a>
                  ${podeGerenciar ? `<a class="btn btn-sm btn-secondary" href="/locacoes/${loc.id}/editar">Editar</a>` : ''}
                  ${podeGerenciar && loc.proxima_parcela_id ? `<form method="POST" action="/parcelas/${loc.proxima_parcela_id}/pagar" style="margin:0;"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="btn btn-sm btn-secondary" type="submit">Receber parcela</button></form>` : ''}
                  <form method="POST" action="/locacoes/${loc.id}/devolver" onsubmit="return confirm('Confirmar devolução desta moto? Ela volta pro estoque disponível.');" style="margin:0;">
                    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><input type="hidden" name="voltar" value="frota">
                    <button class="btn btn-sm" type="submit">Registrar devolução</button>
                  </form>
                </div>
              </div>
            </div>`;
        })
        .join('');

      const acoes = [];
      if (m.disponiveis > 0) {
        acoes.push(`<button type="button" class="btn btn-sm" onclick="frAbrirAlugar(${m.id})">Alugar moto</button>`);
        if (podeGerenciar) acoes.push(`<form method="POST" action="/frota/${m.id}/manutencao" style="display:inline;margin:0;"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="btn btn-sm btn-secondary" type="submit">+ Manutenção</button></form>`);
      }
      if (podeGerenciar && m.em_manutencao > 0) {
        acoes.push(`<form method="POST" action="/frota/${m.id}/voltou-manutencao" style="display:inline;margin:0;"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="btn btn-sm btn-secondary" type="submit">− Manutenção (voltou ${m.em_manutencao})</button></form>`);
      }
      acoes.push(`<a class="btn btn-sm btn-secondary" href="/frota/${m.id}/unidades">Motos (${m.qtd_unidades || 0})</a>`);
      if (podeGerenciar) acoes.push(`<a class="btn btn-sm btn-secondary" href="/frota/${m.id}/editar">Editar modelo</a>`);

      return `
      <div class="card" style="margin-bottom:12px;">
        <div class="page-header" style="margin-bottom:6px;align-items:flex-start;">
          <div>
            <h2 style="margin:0;">${escapeHtml(m.identificacao)} <span class="${dispBadge}" style="font-size:12px;vertical-align:middle;">${m.disponiveis} de ${m.quantidade_total} disponível(is)</span></h2>
            <p class="subtitle" style="margin:4px 0 0;">${[m.modelo, m.cor].filter(Boolean).map(escapeHtml).join(' · ') || 'Modelo da frota'}</p>
            <p class="muted" style="margin:6px 0 0;">
              ${m.alugadas} alugada(s)${m.em_manutencao ? ' · ' + m.em_manutencao + ' em manutenção' : ''}${m.atrasadas ? ' · <span style="color:#a1352a;font-weight:600;">' + m.atrasadas + ' atrasada(s)</span>' : ''}
            </p>
            ${valores ? `<p class="muted" style="margin:4px 0 0;">${valores}</p>` : ''}
          </div>
        </div>
        <div class="actions-row" style="margin:8px 0 0;flex-wrap:wrap;gap:8px;">${acoes.join('')}</div>

        <div id="fr_alugar_${m.id}" style="display:none;margin-top:12px;padding:14px;border:1px solid var(--border);border-radius:8px;background:var(--bg);">
          <h3 style="margin:0 0 10px;">Criar locação — ${escapeHtml(m.identificacao)}</h3>
          <form method="POST" action="/frota/${m.id}/alugar" enctype="multipart/form-data" onsubmit="return frSubmitAlugar(event, this);">
            <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
            <input type="hidden" name="criar_outro" value="">
            <input type="hidden" name="agendamento_id" value="">
            <div class="fr-tabs">
              <button type="button" class="fr-tab ativo" data-tab="info">Informações da Locação</button>
              <button type="button" class="fr-tab" data-tab="assin">Assinaturas de Terceiros</button>
              <button type="button" class="fr-tab" data-tab="ocorr">Ocorrências</button>
            </div>

            <div class="fr-painel" data-painel="info">
              <fieldset class="fr-box"><legend>Dados da Locação</legend>
                <div class="form-grid">
                  <div class="field fr-novocli">
                    <label>Cliente *</label>
                    <select name="cliente_id" required><option value="">Selecione...</option>${clienteOptions}</select>
                    <a href="javascript:void(0)" class="link-btn" style="font-size:13px;display:inline-block;margin-top:4px;" onclick="frToggleNovoCli(this,true)">+ Cadastrar cliente novo aqui</a>
                    <div class="fr-nc-box" style="display:none;margin-top:8px;padding:10px;border:1px dashed var(--border);border-radius:8px;">
                      <div class="form-grid">
                        <div class="field"><label>Nome do cliente *</label><input type="text" class="fr-nc-nome" placeholder="Nome completo"></div>
                        <div class="field"><label>Telefone</label><input type="text" class="fr-nc-tel" placeholder="(21) 9...."></div>
                      </div>
                      <div class="actions-row" style="margin-top:6px;">
                        <button type="button" class="btn btn-sm" onclick="frNovoCliente(this)">Salvar cliente</button>
                        <button type="button" class="btn btn-sm btn-secondary" onclick="frToggleNovoCli(this,false)">Cancelar</button>
                      </div>
                      <p class="muted" style="margin:6px 0 0;">Cadastro rápido (nome + telefone). Pra endereço e mais dados, use o <a class="link-btn" href="/clientes/novo" target="_blank">cadastro completo</a>.</p>
                    </div>
                  </div>
                  ${
                    m.qtd_unidades
                      ? `<div class="field">
                    <label>Veículo (moto que está saindo) *</label>
                    <select name="unidade_id" required onchange="frUnidade(this)"><option value="">Selecione a moto...</option>${(m.unidades_disp || [])
                      .map((u) => `<option value="${u.id}" data-km="${u.km_atual == null ? '' : u.km_atual}">${escapeHtml([u.placa, u.chassi, u.cor].filter(Boolean).join(' · '))}</option>`)
                      .join('')}</select>
                    <small class="muted">Só aparecem as motos disponíveis. <a class="link-btn" href="/frota/${m.id}/unidades">Gerenciar motos</a></small>
                  </div>`
                      : `<div class="field">
                    <label>Chassi da moto que saiu *</label>
                    <input type="text" name="chassi" required placeholder="Número do chassi">
                  </div>
                  <div class="field"><label>Placa (opcional)</label><input type="text" name="placa" placeholder="ABC1D23"></div>
                  <div class="field"><label>Cor da moto</label><input type="text" name="cor" value="${escapeHtml(m.cor || '')}" placeholder="Ex.: Preta"></div>`
                  }
                </div>
                ${periodoBloco(m, hojeStr)}
              </fieldset>

              <fieldset class="fr-box"><legend>Datas e Valores</legend>
                <div class="form-grid">
                  <div class="field"><label>Data saída</label><input type="date" name="data_saida" value="${hojeStr}"></div>
                  <div class="field"><label>Hora saída</label><input type="time" name="hora_saida"></div>
                  <div class="field"><label>Data retorno</label><input type="date" name="devolucao_prevista"></div>
                  <div class="field"><label>Hora retorno</label><input type="time" name="hora_retorno"></div>
                  <div class="field"><label>Km saída</label><input type="number" name="km_saida" min="0"></div>
                  <div class="field"><label>Entrada / caução (R$)</label><input type="number" name="valor_caucao" min="0" step="0.01" placeholder="Ex.: 600" oninput="frTotais(this.form)">
                    <label style="display:flex;align-items:center;gap:6px;font-weight:normal;margin-top:6px;cursor:pointer;"><input type="checkbox" name="entrada_paga" value="1" checked style="width:auto;"> Entrada já paga na entrega</label>
                    <select name="forma_entrada" style="margin-top:6px;"><option value="PIX">PIX</option><option value="Dinheiro">Dinheiro</option><option value="Cartão">Cartão</option><option value="Outro">Outro</option></select>
                  </div>
                  <div class="field"><label>Valor total (R$)</label><input type="number" name="valor_combinado" min="0" step="0.01" placeholder="Preenche sozinho pelo período" oninput="frTotais(this.form)"></div>
                  <div class="field"><label>Desconto (R$) — abatido das primeiras parcelas</label><input type="number" name="desconto" min="0" step="0.01" value="0" oninput="frTotais(this.form)"></div>
                  <div class="field"><label>Valor total com desconto</label><input type="text" class="fr-total-desc" readonly tabindex="-1" style="background:var(--bg);font-weight:700;"></div>
                  <div class="field"><label>Vencimento da 1ª parcela</label><input type="date" name="vencimento"><small class="muted">Vazio = data de saída.</small></div>
                </div>
                <div class="field full"><label>Observações</label><textarea name="observacoes" rows="2"></textarea></div>
              </fieldset>

              <fieldset class="fr-box"><legend>Financeiro</legend>
                <label style="display:flex;align-items:center;gap:8px;font-weight:normal;cursor:pointer;margin-bottom:6px;">
                  <input type="checkbox" name="pago_entrega" value="1" style="width:auto;"> 1ª parcela já paga na entrega (senão fica pendente na cobrança)
                </label>
                <label style="display:flex;align-items:center;gap:8px;font-weight:normal;cursor:pointer;">
                  <input type="checkbox" name="compra_garantida" value="1" style="width:auto;"> Locação com compra garantida (a moto vira do cliente ao quitar)
                </label>
              </fieldset>

              <fieldset class="fr-box"><legend>Fotos da entrega</legend>
                <div class="form-grid">
                  <div class="field"><label>Foto 1 da moto na entrega *</label><input type="file" name="foto_moto" accept="image/*" class="img-compress" required><small class="muted">Prova da condição (arranhões, amassados). Comprimida automaticamente.</small></div>
                  <div class="field"><label>Foto 2 da moto (opcional)</label><input type="file" name="foto_moto2" accept="image/*" class="img-compress"></div>
                  <div class="field"><label>Foto 3 da moto (opcional)</label><input type="file" name="foto_moto3" accept="image/*" class="img-compress"></div>
                  <div class="field"><label>Foto 4 da moto (opcional)</label><input type="file" name="foto_moto4" accept="image/*" class="img-compress"></div>
                  <div class="field"><label>Foto da CNH do locatário *</label><input type="file" name="foto_cnh" accept="image/*" class="img-compress" required><small class="muted">CNH digital no celular do cliente.</small></div>
                </div>
              </fieldset>
            </div>

            <div class="fr-painel" data-painel="assin" style="display:none;">
              <fieldset class="fr-box"><legend>Assinaturas no Contrato</legend>
                <div class="form-grid">
                  <div class="field"><label>Testemunha 1</label><input type="text" name="testemunha1_nome"></div>
                  <div class="field"><label>RG</label><input type="text" name="testemunha1_rg"></div>
                  <div class="field"><label>Testemunha 2</label><input type="text" name="testemunha2_nome"></div>
                  <div class="field"><label>RG</label><input type="text" name="testemunha2_rg"></div>
                  <div class="field"><label>Fiador</label><input type="text" name="fiador_nome"></div>
                </div>
              </fieldset>
              <fieldset class="fr-box"><legend>Dados Completos do Fiador</legend>
                <textarea name="fiador_dados" rows="3" placeholder="CPF, RG, endereço, telefone"></textarea>
              </fieldset>
            </div>

            <div class="fr-painel" data-painel="ocorr" style="display:none;">
              <fieldset class="fr-box"><legend>Ocorrências da Locação</legend>
                <p class="muted" style="margin-top:0;">Ex.: moto saiu com arranhão, retrovisor faltando. Ocorrências com valor e cobranças depois ficam em Detalhes da locação.</p>
                <div class="fr-ocorr-lista"></div>
                <button type="button" class="btn btn-sm btn-secondary" onclick="frNovaOcorr(this)">Novo</button>
              </fieldset>
            </div>

            <div class="actions-row" style="margin-top:10px;">
              <button class="btn" type="submit">Criar</button>
              <button class="btn btn-secondary" type="submit" onclick="this.form.criar_outro.value='1'">Salvar e criar outro</button>
              <button type="button" class="btn btn-secondary" onclick="frFecharAlugar(${m.id})">Cancelar</button>
            </div>
          </form>
        </div>

        ${locacoesHtml ? `<div style="margin-top:10px;">${locacoesHtml}</div>` : ''}
      </div>`;
    })
    .join('');

  return layout({
    title: 'Frota de locação',
    activeNav: 'frota',
    user,
    flash,
    children: `
      <style>
        .fr-tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--border);margin-bottom:12px}
        .fr-tab{background:none;border:none;border-bottom:3px solid transparent;padding:8px 12px;cursor:pointer;font-weight:600;color:inherit;opacity:.65}
        .fr-tab.ativo{opacity:1;border-bottom-color:var(--gold,#d4af37)}
        .fr-box{border:1px solid var(--border);border-radius:8px;padding:10px 14px 12px;margin:0 0 12px}
        .fr-box legend{font-weight:700;padding:0 6px}
      </style>
      <div class="page-header">
        <div>
          <h1>Frota de locação</h1>
          <p class="subtitle">Cada modelo tem uma quantidade. A moto específica (chassi + foto) é registrada na hora de alugar.</p>
        </div>
        <div class="actions-row" style="gap:8px;margin:0;">
          ${podeGerenciar ? '<a class="btn btn-secondary" href="/frota/cobranca">Cobrança</a>' : ''}
          ${podeGerenciar ? '<a class="btn" href="/frota/nova">+ Novo modelo</a>' : ''}
        </div>
      </div>
      <div class="stat-grid">
        <div class="stat-card"><div class="num">${totDisp}</div><div class="label">Disponíveis</div></div>
        <div class="stat-card"><div class="num">${totAlug}</div><div class="label">Alugadas</div></div>
        <div class="stat-card"><div class="num">${totManut}</div><div class="label">Em manutenção</div></div>
        <div class="stat-card"><div class="num" style="${totAtras ? 'color:#a1352a;' : ''}">${totAtras}</div><div class="label">Atrasadas na devolução</div></div>
        ${
          podeGerenciar
            ? `<a class="stat-card" href="/frota/cobranca" style="text-decoration:none;color:inherit;">
          <div class="num" style="${qtdPendentes ? 'color:#8a6d00;' : ''}">${formatMoney(totalReceber)}</div>
          <div class="label">A receber${qtdPendentes ? ' (' + qtdPendentes + ')' : ''} ›</div>
        </a>`
            : ''
        }
      </div>
      ${modelos.length ? cards : '<div class="card"><div class="empty">Nenhum modelo na frota ainda. Clique em "Novo modelo" pra cadastrar o primeiro.</div></div>'}
      <script>
        function frAbrirAlugar(id){ var b=document.getElementById('fr_alugar_'+id); if(b){ b.style.display='block'; b.scrollIntoView({behavior:'smooth',block:'nearest'}); } }
        // Abas do formulário (Informações / Assinaturas / Ocorrências)
        document.addEventListener('click',function(e){
          var t=e.target.closest&&e.target.closest('.fr-tab'); if(!t) return;
          var f=t.closest('form'); frMostraAba(f,t.getAttribute('data-tab'));
        });
        function frMostraAba(f,aba){
          f.querySelectorAll('.fr-tab').forEach(function(b){b.classList.toggle('ativo',b.getAttribute('data-tab')===aba)});
          f.querySelectorAll('.fr-painel').forEach(function(p){p.style.display=p.getAttribute('data-painel')===aba?'':'none'});
        }
        // Campo obrigatório escondido em outra aba: abre a aba certa pro navegador mostrar o erro.
        document.addEventListener('invalid',function(e){
          var p=e.target.closest&&e.target.closest('.fr-painel'); if(p&&p.style.display==='none') frMostraAba(p.closest('form'),p.getAttribute('data-painel'));
        },true);
        function frTotais(f){
          var v=parseFloat((f.valor_combinado||{}).value)||0, d=parseFloat((f.desconto||{}).value)||0, e=parseFloat((f.valor_caucao||{}).value)||0;
          var out=f.querySelector('.fr-total-desc'); if(!out) return;
          var t=Math.max(0,v-d)+e;
          out.value=(v||e)?('R$ '+t.toFixed(2).replace('.',',')+(e?' (com entrada)':'')):'';
        }
        document.addEventListener('change',function(e){ if(e.target.closest&&e.target.closest('.loc-periodo-wrap')) setTimeout(function(){frTotais(e.target.form)},0); });
        document.addEventListener('input',function(e){ if(e.target.classList&&e.target.classList.contains('loc-qtd')) setTimeout(function(){frTotais(e.target.form)},0); });
        var FR_TIPOS=${JSON.stringify(require('./locacaoPro').TIPOS_OCORRENCIA)};
        function frNovaOcorr(btn){
          var lista=btn.closest('fieldset').querySelector('.fr-ocorr-lista'); var n=lista.children.length+1; if(n>5){alert('Até 5 ocorrências aqui. O resto, adicione em Detalhes da locação.');return;}
          var opts=Object.keys(FR_TIPOS).map(function(k){return '<option value="'+k+'">'+FR_TIPOS[k]+'</option>'}).join('');
          var d=document.createElement('div'); d.className='form-grid'; d.style.cssText='padding:8px 0;border-bottom:1px solid var(--border);';
          d.innerHTML='<div class="field"><label>Tipo</label><select name="ocorr_tipo_'+n+'">'+opts+'</select></div>'+
            '<div class="field"><label>Descrição</label><input type="text" name="ocorr_desc_'+n+'" placeholder="O que aconteceu"></div>'+
            '<div class="field"><label>Valor (R$, opcional)</label><input type="number" step="0.01" min="0" name="ocorr_valor_'+n+'"></div>';
          lista.appendChild(d);
        }
        function frFecharAlugar(id){ var b=document.getElementById('fr_alugar_'+id); if(b) b.style.display='none'; }
        function frUnidade(sel){
          var o=sel.options[sel.selectedIndex]; var f=sel.closest('form'); if(!o||!f) return;
          var km=f.querySelector('input[name=km_saida]'); if(km && o.getAttribute('data-km')) km.value=o.getAttribute('data-km');
        }
        (function(){
          var P=${JSON.stringify(prefill || null).replace(/</g, '\\u003c')};
          if(!P||!P.alugar) return;
          function go(){
            var b=document.getElementById('fr_alugar_'+P.alugar); if(!b) return;
            frAbrirAlugar(P.alugar);
            var f=b.querySelector('form'); if(!f) return;
            if(P.cliente){ var c=f.querySelector('select[name=cliente_id]'); if(c) c.value=P.cliente; }
            if(P.agendamento){ var a=f.querySelector('input[name=agendamento_id]'); if(a) a.value=P.agendamento; }
            if(P.ag){
              var set=function(n,v){ var e=f.querySelector('[name='+n+']'); if(e&&v!=null&&v!=='') e.value=v; };
              set('devolucao_prevista',P.ag.data_retorno); set('hora_saida',P.ag.hora_saida); set('hora_retorno',P.ag.hora_retorno);
              set('desconto',P.ag.desconto);
              var obs=[]; if(P.ag.observacoes) obs.push(P.ag.observacoes);
              if(Number(P.ag.valor_pago)>0) obs.push('Sinal pago no agendamento: R$ '+Number(P.ag.valor_pago).toFixed(2).replace('.',','));
              set('observacoes',obs.join(' | '));
            }
          }
          if(document.readyState!=='loading') go(); else document.addEventListener('DOMContentLoaded', go);
        })();

        var FR_CSRF = ${JSON.stringify(csrfToken)};
        function frToggleNovoCli(el, show){
          var wrap = el.closest('.fr-novocli'); if(!wrap) return;
          var box = wrap.querySelector('.fr-nc-box'); if(box) box.style.display = show ? 'block' : 'none';
        }
        function frNovoCliente(btn){
          var wrap = btn.closest('.fr-novocli'); if(!wrap) return;
          var nome = (wrap.querySelector('.fr-nc-nome').value||'').trim();
          var tel = (wrap.querySelector('.fr-nc-tel').value||'').trim();
          if(!nome){ alert('Digite o nome do cliente.'); return; }
          btn.disabled=true; btn.textContent='Salvando...';
          var params = new URLSearchParams(); params.set('csrf', FR_CSRF); params.set('nome', nome); params.set('telefone', tel);
          fetch('/clientes/criar-rapido', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: params.toString() })
            .then(function(r){ return r.json(); })
            .then(function(d){
              btn.disabled=false; btn.textContent='Salvar cliente';
              if(!d || !d.ok){ alert((d && d.error) || 'Não deu pra cadastrar o cliente.'); return; }
              document.querySelectorAll('select[name=cliente_id]').forEach(function(sel){
                if(!sel.querySelector('option[value="'+d.id+'"]')){ var o=document.createElement('option'); o.value=d.id; o.textContent=nome; sel.appendChild(o); }
              });
              var form = wrap.closest('form'); var sel = form && form.querySelector('select[name=cliente_id]'); if(sel) sel.value=d.id;
              wrap.querySelector('.fr-nc-nome').value=''; wrap.querySelector('.fr-nc-tel').value='';
              frToggleNovoCli(btn, false);
            })
            .catch(function(){ btn.disabled=false; btn.textContent='Salvar cliente'; alert('Erro de conexão ao cadastrar.'); });
        }

        // Comprime uma imagem (foto de celular) no próprio navegador antes de enviar:
        // reduz o maior lado pra 1280px e exporta JPEG. Economiza disco e dados do celular.
        // Em qualquer erro, mantém o arquivo original pra nunca travar a locação.
        function frComprimeInput(input){
          return new Promise(function(resolve){
            try{
              var file = input.files && input.files[0];
              if(!file || !file.type || file.type.indexOf('image/')!==0){ resolve(); return; }
              var reader = new FileReader();
              reader.onerror = function(){ resolve(); };
              reader.onload = function(){
                var img = new Image();
                img.onerror = function(){ resolve(); };
                img.onload = function(){
                  try{
                    var maxLado = 1280;
                    var escala = Math.min(1, maxLado / Math.max(img.width, img.height));
                    var nw = Math.round(img.width * escala), nh = Math.round(img.height * escala);
                    var canvas = document.createElement('canvas');
                    canvas.width = nw; canvas.height = nh;
                    canvas.getContext('2d').drawImage(img, 0, 0, nw, nh);
                    canvas.toBlob(function(blob){
                      if(!blob){ resolve(); return; }
                      try{
                        var nome = (file.name || 'foto').replace(/\\.[^.]+$/, '') + '.jpg';
                        var novo = new File([blob], nome, { type:'image/jpeg' });
                        var dt = new DataTransfer();
                        dt.items.add(novo);
                        input.files = dt.files;
                      }catch(e){}
                      resolve();
                    }, 'image/jpeg', 0.7);
                  }catch(e){ resolve(); }
                };
                img.src = reader.result;
              };
              reader.readAsDataURL(file);
            }catch(e){ resolve(); }
          });
        }

        function frSubmitAlugar(ev, form){
          if(form.dataset.frReady==='1') return true;        // já comprimido: deixa enviar
          if(!form.checkValidity()){ return true; }          // deixa o browser cobrar os campos obrigatórios
          ev.preventDefault();
          var btn = form.querySelector('button[type=submit]');
          if(btn){ btn.disabled=true; btn.textContent='Enviando...'; }
          var inputs = form.querySelectorAll('input.img-compress');
          var tarefas = [];
          inputs.forEach(function(inp){ tarefas.push(frComprimeInput(inp)); });
          Promise.all(tarefas).then(function(){ form.dataset.frReady='1'; form.submit(); })
                              .catch(function(){ form.dataset.frReady='1'; form.submit(); });
          return false;
        }
        ${PERIODO_SCRIPT}
      </script>
    `,
  });
}

function frotaFormPage({ user, flash, moto, csrfToken }) {
  const isEdit = !!(moto && moto.id);
  const m = moto || {};
  return layout({
    title: isEdit ? 'Editar modelo' : 'Novo modelo',
    activeNav: 'frota',
    user,
    flash,
    children: `
      <div class="page-header"><div><h1>${isEdit ? 'Editar modelo da frota' : 'Novo modelo da frota'}</h1></div></div>
      <div class="card">
        <form method="POST" action="${isEdit ? `/frota/${m.id}` : '/frota'}">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field full">
              <label for="identificacao">Nome do modelo *</label>
              <input type="text" id="identificacao" name="identificacao" required placeholder="Ex.: GOLDEN CITY" value="${escapeHtml(m.identificacao || '')}">
            </div>
            <div class="field">
              <label for="modelo">Detalhe / versão</label>
              <input type="text" id="modelo" name="modelo" placeholder="Ex.: 2024, 1000W" value="${escapeHtml(m.modelo || '')}">
            </div>
            <div class="field">
              <label for="marca">Marca (vai pro contrato)</label>
              <input type="text" id="marca" name="marca" placeholder="Ex.: Golden Motors" value="${escapeHtml(m.marca || '')}">
            </div>
            <div class="field">
              <label for="cor">Cor</label>
              <input type="text" id="cor" name="cor" value="${escapeHtml(m.cor || '')}">
            </div>
            <div class="field">
              <label for="quantidade_total">Quantidade de motos desse modelo *</label>
              <input type="number" id="quantidade_total" name="quantidade_total" min="1" step="1" required value="${m.quantidade_total != null ? m.quantidade_total : 1}">
            </div>
          </div>
          <h2 style="margin-top:20px;">Valores de locação</h2>
          <div class="form-grid">
            <div class="field">
              <label for="valor_diaria">Diária (R$)</label>
              <input type="number" id="valor_diaria" name="valor_diaria" min="0" step="0.01" value="${m.valor_diaria != null ? m.valor_diaria : ''}">
            </div>
            <div class="field">
              <label for="valor_semanal">Semanal (R$)</label>
              <input type="number" id="valor_semanal" name="valor_semanal" min="0" step="0.01" value="${m.valor_semanal != null ? m.valor_semanal : ''}">
            </div>
            <div class="field">
              <label for="valor_mensal">Mensal (R$)</label>
              <input type="number" id="valor_mensal" name="valor_mensal" min="0" step="0.01" value="${m.valor_mensal != null ? m.valor_mensal : ''}">
            </div>
          </div>
          <div class="field full">
            <label for="observacoes">Observações</label>
            <textarea id="observacoes" name="observacoes" rows="2">${escapeHtml(m.observacoes || '')}</textarea>
          </div>
          <div class="actions-row">
            <button class="btn" type="submit">${isEdit ? 'Salvar alterações' : 'Cadastrar modelo'}</button>
            <a class="btn btn-secondary" href="/frota">Cancelar</a>
          </div>
        </form>
        ${
          isEdit
            ? `<form method="POST" action="/frota/${m.id}/excluir" onsubmit="return confirm('Excluir este modelo e todo o histórico de locações dele?');" style="margin-top:12px;">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <button class="btn btn-danger" type="submit">Excluir modelo</button>
        </form>`
            : ''
        }
      </div>
    `,
  });
}

function cobrancaPage({ user, flash, pendencias, pagosRecentes, total, csrfToken }) {
  pendencias = pendencias || [];
  pagosRecentes = pagosRecentes || [];
  const vencidas = pendencias.filter((p) => {
    const d = diasAteHoje(p.vencimento);
    return p.vencimento && d !== null && d < 0;
  }).length;

  const parcelaLabel = (p) => (p.total_parcelas > 1 ? `parcela ${p.numero}/${p.total_parcelas}` : 'cobrança única');
  const linhaPend = (p) => {
    const d = diasAteHoje(p.vencimento);
    const vencida = p.vencimento && d !== null && d < 0;
    const moto = [escapeHtml(p.modelo_nome || 'Moto'), p.chassi ? 'chassi ' + escapeHtml(p.chassi) : null].filter(Boolean).join(' · ');
    const tagStatus = p.status === 'devolvida'
      ? '<span class="muted" style="font-size:12px;">(já devolvida)</span>'
      : '<span class="muted" style="font-size:12px;">(em locação)</span>';
    return `
      <div style="padding:12px 0;border-top:1px solid var(--border);${vencida ? 'background:rgba(161,53,42,0.04);' : ''}">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start;">
          <div>
            <div><strong>${escapeHtml(p.cliente_nome || 'Cliente')}</strong> ${tagStatus}</div>
            <div class="muted" style="font-size:13px;margin-top:2px;">${moto} · ${parcelaLabel(p)}</div>
            <div style="font-size:13px;margin-top:4px;">
              <strong>${formatMoney(p.valor || 0)}</strong> ${pagamentoBadge(p)}
              ${p.vencimento ? ` <span class="${vencida ? '' : 'muted'}" style="${vencida ? 'color:#a1352a;font-weight:600;' : ''}">venc. ${formatDateOnly(p.vencimento)}${vencida ? ' (atrasado ' + Math.abs(d) + ' dia(s))' : ''}</span>` : ''}
            </div>
          </div>
          <form method="POST" action="/parcelas/${p.id}/pagar" style="margin:0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
            <input type="hidden" name="voltar" value="cobranca">
            <select name="forma_pagamento" style="width:auto;">
              <option value="">Forma...</option>
              <option value="Dinheiro">Dinheiro</option>
              <option value="PIX">PIX</option>
              <option value="Cartão">Cartão</option>
              <option value="Outro">Outro</option>
            </select>
            <button class="btn btn-sm" type="submit">Marcar paga</button>
          </form>
        </div>
      </div>`;
  };

  const linhaPago = (p) => {
    const moto = [escapeHtml(p.modelo_nome || 'Moto'), p.chassi ? 'chassi ' + escapeHtml(p.chassi) : null].filter(Boolean).join(' · ');
    return `
      <div style="padding:10px 0;border-top:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start;">
          <div>
            <div><strong>${escapeHtml(p.cliente_nome || 'Cliente')}</strong> — ${formatMoney(p.valor || 0)} <span class="muted" style="font-size:12px;">(${parcelaLabel(p)})</span></div>
            <div class="muted" style="font-size:13px;margin-top:2px;">${moto}</div>
            <div class="muted" style="font-size:13px;margin-top:2px;">pago ${p.data_pagamento ? formatDateOnly(p.data_pagamento) : ''}${p.forma_pagamento ? ' · ' + escapeHtml(p.forma_pagamento) : ''}</div>
          </div>
          <form method="POST" action="/parcelas/${p.id}/estornar" onsubmit="return confirm('Desfazer o pagamento desta parcela?');" style="margin:0;">
            <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
            <input type="hidden" name="voltar" value="cobranca">
            <button class="btn btn-sm btn-secondary" type="submit">Desfazer</button>
          </form>
        </div>
      </div>`;
  };

  return layout({
    title: 'Cobrança da locação',
    activeNav: 'cobranca',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Cobrança</h1>
          <p class="subtitle">Quem está devendo nas locações. Marque como pago quando receber.</p>
        </div>
        <a class="btn btn-secondary" href="/frota">‹ Voltar pra frota</a>
      </div>
      <div class="stat-grid">
        <div class="stat-card"><div class="num" style="${total ? 'color:#8a6d00;' : ''}">${formatMoney(total)}</div><div class="label">Total a receber</div></div>
        <div class="stat-card"><div class="num">${pendencias.length}</div><div class="label">Parcelas pendentes</div></div>
        <div class="stat-card"><div class="num" style="${vencidas ? 'color:#a1352a;' : ''}">${vencidas}</div><div class="label">Vencidas</div></div>
      </div>
      <div class="card">
        <h2 style="margin:0 0 4px;">Pendentes</h2>
        ${pendencias.length ? pendencias.map(linhaPend).join('') : '<div class="empty">Nenhuma cobrança pendente. Tudo pago ✅</div>'}
      </div>
      ${pagosRecentes.length ? `
      <div class="card" style="margin-top:14px;">
        <h2 style="margin:0 0 4px;">Pagos recentes</h2>
        <p class="muted" style="margin:0 0 4px;">Últimos pagamentos registrados — use "Desfazer" se marcou errado.</p>
        ${pagosRecentes.map(linhaPago).join('')}
      </div>` : ''}
    `,
  });
}

function locacaoEditarPage({ user, flash, loc, modelo, clientes, csrfToken }) {
  const clienteOptions = (clientes || [])
    .map((c) => `<option value="${c.id}"${c.id === loc.cliente_id ? ' selected' : ''}>${escapeHtml(c.nome)}</option>`)
    .join('');
  const nomeModelo = modelo ? modelo.identificacao : 'Moto';
  return layout({
    title: 'Editar locação',
    activeNav: 'frota',
    user,
    flash,
    children: `
      <div class="page-header"><div><h1>Editar locação</h1><p class="subtitle">${escapeHtml(nomeModelo)} — corrija valor, vencimento ou dados da moto.</p></div></div>
      <div class="card">
        <form method="POST" action="/locacoes/${loc.id}">
          <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
          ${periodoBloco(modelo, loc.data_saida)}
          <div class="form-grid">
            <div class="field">
              <label>Locatário (cliente) *</label>
              <select name="cliente_id" required><option value="">Selecione...</option>${clienteOptions}</select>
            </div>
            <div class="field">
              <label>Chassi *</label>
              <input type="text" name="chassi" required value="${escapeHtml(loc.chassi || '')}">
            </div>
            <div class="field">
              <label>Placa (opcional)</label>
              <input type="text" name="placa" value="${escapeHtml(loc.placa || '')}">
            </div>
            <div class="field">
              <label>Cor da moto</label>
              <input type="text" name="cor" value="${escapeHtml(loc.cor || '')}">
            </div>
            <div class="field">
              <label>Devolução prevista</label>
              <input type="date" name="devolucao_prevista" value="${escapeHtml(loc.devolucao_prevista || '')}">
            </div>
          </div>
          <div class="field full">
            <label>Observações</label>
            <textarea name="observacoes" rows="2">${escapeHtml(loc.observacoes || '')}</textarea>
          </div>
          <div class="actions-row">
            <button class="btn" type="submit">Salvar alterações</button>
            <a class="btn btn-secondary" href="/frota">Cancelar</a>
          </div>
          <p class="muted" style="margin:10px 0 0;">As fotos e os valores/parcelas não mudam por aqui. As parcelas (financeiro da locação) ficam na tela de <strong>Cobrança</strong>.</p>
        </form>
      </div>
      <script>${PERIODO_SCRIPT}</script>
    `,
  });
}

module.exports = { frotaPainelPage, frotaFormPage, cobrancaPage, locacaoEditarPage };
