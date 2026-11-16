'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatMoney, formatDateOnly } = require('../utils');

const STATUS_INFO = {
  disponivel: { label: 'Disponível', badge: 'badge-ok' },
  alugada: { label: 'Alugada', badge: 'badge' },
  manutencao: { label: 'Em manutenção', badge: 'badge-desativada' },
};

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

function statusMoto(m) {
  const info = STATUS_INFO[m.status] || STATUS_INFO.disponivel;
  if (m.status !== 'alugada') return { info, atrasada: false, texto: '' };
  const dias = diasAteHoje(m.devolucao_prevista);
  let texto = m.cliente_nome ? 'com ' + escapeHtml(m.cliente_nome) : 'alugada';
  let atrasada = false;
  if (m.devolucao_prevista) {
    if (dias < 0) { texto += ' — <strong style="color:#a1352a;">atrasada ' + Math.abs(dias) + ' dia(s)</strong> (previsto ' + formatDateOnly(m.devolucao_prevista) + ')'; atrasada = true; }
    else if (dias === 0) texto += ' — <strong>devolve hoje</strong>';
    else texto += ' — devolve ' + formatDateOnly(m.devolucao_prevista) + ' (' + dias + ' dia(s))';
  }
  return { info, atrasada, texto };
}

function frotaPainelPage({ user, flash, motos, clientes, csrfToken, podeGerenciar = true }) {
  const disp = motos.filter((m) => m.status === 'disponivel').length;
  const alug = motos.filter((m) => m.status === 'alugada').length;
  const manut = motos.filter((m) => m.status === 'manutencao').length;
  const atrasadas = motos.filter((m) => m.status === 'alugada' && diasAteHoje(m.devolucao_prevista) < 0).length;

  const clienteOptions = (clientes || []).map((c) => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
  const hoje = new Date().toISOString().slice(0, 10);

  const cards = motos
    .map((m) => {
      const st = statusMoto(m);
      const valores = [
        m.valor_diaria != null ? 'Diária ' + formatMoney(m.valor_diaria) : null,
        m.valor_semanal != null ? 'Semana ' + formatMoney(m.valor_semanal) : null,
        m.valor_mensal != null ? 'Mês ' + formatMoney(m.valor_mensal) : null,
      ].filter(Boolean).join(' · ');
      const acoes = [];
      if (m.status === 'disponivel') {
        acoes.push(`<button type="button" class="btn btn-sm" onclick="frAbrirAlugar(${m.id})">Alugar</button>`);
        acoes.push(`<form method="POST" action="/frota/${m.id}/manutencao" style="display:inline;"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="btn btn-sm btn-secondary" type="submit">Enviar p/ manutenção</button></form>`);
      } else if (m.status === 'alugada') {
        acoes.push(`<form method="POST" action="/frota/${m.id}/devolver" onsubmit="return confirm('Confirmar devolução desta moto?');" style="display:inline;"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="btn btn-sm" type="submit">Registrar devolução</button></form>`);
      } else if (m.status === 'manutencao') {
        acoes.push(`<form method="POST" action="/frota/${m.id}/disponivel" style="display:inline;"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="btn btn-sm" type="submit">Voltou da manutenção</button></form>`);
      }
      if (podeGerenciar) acoes.push(`<a class="btn btn-sm btn-secondary" href="/frota/${m.id}/editar">Editar</a>`);

      return `
      <div class="card" style="margin-bottom:12px;${st.atrasada ? 'border:1px solid #e3b7b1;' : ''}">
        <div class="page-header" style="margin-bottom:6px;align-items:flex-start;">
          <div>
            <h2 style="margin:0;">${escapeHtml(m.identificacao)} <span class="${st.info.badge}" style="font-size:12px;vertical-align:middle;">${st.info.label}</span></h2>
            <p class="subtitle" style="margin:4px 0 0;">
              ${[m.modelo, m.cor, m.placa ? 'placa ' + m.placa : null].filter(Boolean).map(escapeHtml).join(' · ') || 'Moto da frota'}
            </p>
            ${st.texto ? `<p class="muted" style="margin:6px 0 0;">${st.texto}</p>` : ''}
            ${valores ? `<p class="muted" style="margin:4px 0 0;">${valores}</p>` : ''}
          </div>
        </div>
        <div class="actions-row" style="margin:8px 0 0;flex-wrap:wrap;gap:8px;">${acoes.join('')}</div>
        <div id="fr_alugar_${m.id}" style="display:none;margin-top:10px;padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--bg);">
          <form method="POST" action="/frota/${m.id}/alugar">
            <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
            <div class="form-grid">
              <div class="field">
                <label>Locatário (cliente) *</label>
                <select name="cliente_id" required><option value="">Selecione...</option>${clienteOptions}</select>
              </div>
              <div class="field">
                <label>Devolução prevista</label>
                <input type="date" name="devolucao_prevista" value="">
              </div>
            </div>
            <div class="actions-row" style="margin-top:8px;">
              <button class="btn btn-sm" type="submit">Confirmar locação</button>
              <button type="button" class="btn btn-sm btn-secondary" onclick="frFecharAlugar(${m.id})">Cancelar</button>
            </div>
            <p class="muted" style="margin:6px 0 0;">A moto fica como "Alugada" até você registrar a devolução. Falta cadastrar o cliente? <a class="link-btn" href="/clientes/novo" target="_blank">Cadastrar (nova aba)</a></p>
          </form>
        </div>
      </div>`;
    })
    .join('');

  return layout({
    title: 'Frota de locação',
    activeNav: 'frota',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Frota de locação</h1>
          <p class="subtitle">Status de cada moto: disponível, alugada ou em manutenção</p>
        </div>
        ${podeGerenciar ? '<a class="btn" href="/frota/nova">+ Nova moto</a>' : ''}
      </div>
      <div class="stat-grid">
        <div class="stat-card"><div class="num">${disp}</div><div class="label">Disponíveis</div></div>
        <div class="stat-card"><div class="num">${alug}</div><div class="label">Alugadas</div></div>
        <div class="stat-card"><div class="num">${manut}</div><div class="label">Em manutenção</div></div>
        <div class="stat-card"><div class="num" style="${atrasadas ? 'color:#a1352a;' : ''}">${atrasadas}</div><div class="label">Atrasadas na devolução</div></div>
      </div>
      ${motos.length ? cards : '<div class="card"><div class="empty">Nenhuma moto na frota ainda. Clique em "Nova moto" pra cadastrar a primeira.</div></div>'}
      <script>
        function frAbrirAlugar(id){ var b=document.getElementById('fr_alugar_'+id); if(b) b.style.display='block'; }
        function frFecharAlugar(id){ var b=document.getElementById('fr_alugar_'+id); if(b) b.style.display='none'; }
      </script>
    `,
  });
}

function frotaFormPage({ user, flash, moto, csrfToken }) {
  const isEdit = !!(moto && moto.id);
  const m = moto || {};
  return layout({
    title: isEdit ? 'Editar moto' : 'Nova moto',
    activeNav: 'frota',
    user,
    flash,
    children: `
      <div class="page-header"><div><h1>${isEdit ? 'Editar moto da frota' : 'Nova moto da frota'}</h1></div></div>
      <div class="card">
        <form method="POST" action="${isEdit ? `/frota/${m.id}` : '/frota'}">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field full">
              <label for="identificacao">Identificação / apelido *</label>
              <input type="text" id="identificacao" name="identificacao" required placeholder="Ex.: Moto 01 — Honda Pop" value="${escapeHtml(m.identificacao || '')}">
            </div>
            <div class="field">
              <label for="modelo">Modelo</label>
              <input type="text" id="modelo" name="modelo" placeholder="Ex.: Honda Pop 110" value="${escapeHtml(m.modelo || '')}">
            </div>
            <div class="field">
              <label for="cor">Cor</label>
              <input type="text" id="cor" name="cor" value="${escapeHtml(m.cor || '')}">
            </div>
            <div class="field">
              <label for="placa">Placa</label>
              <input type="text" id="placa" name="placa" value="${escapeHtml(m.placa || '')}">
            </div>
            <div class="field">
              <label for="chassi">Chassi</label>
              <input type="text" id="chassi" name="chassi" value="${escapeHtml(m.chassi || '')}">
            </div>
            <div class="field">
              <label for="km">KM atual</label>
              <input type="number" id="km" name="km" min="0" step="1" value="${m.km != null ? m.km : ''}">
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
            <button class="btn" type="submit">${isEdit ? 'Salvar alterações' : 'Cadastrar moto'}</button>
            <a class="btn btn-secondary" href="/frota">Cancelar</a>
          </div>
        </form>
        ${
          isEdit
            ? `<form method="POST" action="/frota/${m.id}/excluir" onsubmit="return confirm('Excluir esta moto da frota?');" style="margin-top:12px;">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <button class="btn btn-danger" type="submit">Excluir moto</button>
        </form>`
            : ''
        }
      </div>
    `,
  });
}

module.exports = { frotaPainelPage, frotaFormPage };
