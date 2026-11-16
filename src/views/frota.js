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

function frotaPainelPage({ user, flash, modelos, clientes, csrfToken, podeGerenciar = true }) {
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
          const ident = [loc.chassi ? 'chassi ' + escapeHtml(loc.chassi) : null, loc.placa ? 'placa ' + escapeHtml(loc.placa) : null].filter(Boolean).join(' · ');
          const fotos = [
            loc.foto_moto_caminho ? `<a class="link-btn" href="/uploads/${escapeHtml(loc.foto_moto_caminho)}" target="_blank">foto da moto</a>` : null,
            loc.foto_cnh_caminho ? `<a class="link-btn" href="/uploads/${escapeHtml(loc.foto_cnh_caminho)}" target="_blank">CNH</a>` : null,
          ].filter(Boolean).join(' · ');
          return `
            <div style="padding:10px 0;border-top:1px solid var(--border);${t.atrasada ? 'background:rgba(161,53,42,0.04);' : ''}">
              <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start;">
                <div>
                  <div>${t.texto}</div>
                  ${ident ? `<div class="muted" style="font-size:13px;margin-top:2px;">${ident}</div>` : ''}
                  <div class="muted" style="font-size:13px;margin-top:2px;">saída ${formatDateOnly(loc.data_saida)}${fotos ? ' · ' + fotos : ''}</div>
                </div>
                <form method="POST" action="/locacoes/${loc.id}/devolver" onsubmit="return confirm('Confirmar devolução desta moto? Ela volta pro estoque disponível.');" style="margin:0;">
                  <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
                  <button class="btn btn-sm" type="submit">Registrar devolução</button>
                </form>
              </div>
            </div>`;
        })
        .join('');

      const acoes = [];
      if (m.disponiveis > 0) {
        acoes.push(`<button type="button" class="btn btn-sm" onclick="frAbrirAlugar(${m.id})">Alugar moto</button>`);
        acoes.push(`<form method="POST" action="/frota/${m.id}/manutencao" style="display:inline;margin:0;"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="btn btn-sm btn-secondary" type="submit">+ Manutenção</button></form>`);
      }
      if (m.em_manutencao > 0) {
        acoes.push(`<form method="POST" action="/frota/${m.id}/voltou-manutencao" style="display:inline;margin:0;"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="btn btn-sm btn-secondary" type="submit">− Manutenção (voltou ${m.em_manutencao})</button></form>`);
      }
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
          <h3 style="margin:0 0 10px;">Registrar locação — ${escapeHtml(m.identificacao)}</h3>
          <form method="POST" action="/frota/${m.id}/alugar" enctype="multipart/form-data" onsubmit="return frSubmitAlugar(event, this);">
            <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
            <div class="form-grid">
              <div class="field">
                <label>Locatário (cliente) *</label>
                <select name="cliente_id" required><option value="">Selecione...</option>${clienteOptions}</select>
              </div>
              <div class="field">
                <label>Chassi da moto que saiu *</label>
                <input type="text" name="chassi" required placeholder="Número do chassi">
              </div>
              <div class="field">
                <label>Placa (opcional)</label>
                <input type="text" name="placa" placeholder="ABC1D23">
              </div>
              <div class="field">
                <label>Devolução prevista</label>
                <input type="date" name="devolucao_prevista">
              </div>
              <div class="field">
                <label>Valor combinado (R$, opcional)</label>
                <input type="number" name="valor_combinado" min="0" step="0.01">
              </div>
            </div>
            <div class="form-grid">
              <div class="field">
                <label>Foto da moto na entrega *</label>
                <input type="file" name="foto_moto" accept="image/*" class="img-compress" required>
                <small class="muted">Prova da condição da moto (arranhões, amassados). Comprimida automaticamente.</small>
              </div>
              <div class="field">
                <label>Foto da CNH do locatário *</label>
                <input type="file" name="foto_cnh" accept="image/*" class="img-compress" required>
                <small class="muted">CNH digital no celular do cliente. Comprimida automaticamente.</small>
              </div>
            </div>
            <div class="field full">
              <label>Observações (opcional)</label>
              <textarea name="observacoes" rows="2"></textarea>
            </div>
            <div class="actions-row" style="margin-top:8px;">
              <button class="btn" type="submit">Confirmar locação</button>
              <button type="button" class="btn btn-secondary" onclick="frFecharAlugar(${m.id})">Cancelar</button>
            </div>
            <p class="muted" style="margin:8px 0 0;">Falta cadastrar o cliente? <a class="link-btn" href="/clientes/novo" target="_blank">Cadastrar (nova aba)</a> e depois recarregue esta página.</p>
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
      <div class="page-header">
        <div>
          <h1>Frota de locação</h1>
          <p class="subtitle">Cada modelo tem uma quantidade. A moto específica (chassi + foto) é registrada na hora de alugar.</p>
        </div>
        ${podeGerenciar ? '<a class="btn" href="/frota/nova">+ Novo modelo</a>' : ''}
      </div>
      <div class="stat-grid">
        <div class="stat-card"><div class="num">${totDisp}</div><div class="label">Disponíveis</div></div>
        <div class="stat-card"><div class="num">${totAlug}</div><div class="label">Alugadas</div></div>
        <div class="stat-card"><div class="num">${totManut}</div><div class="label">Em manutenção</div></div>
        <div class="stat-card"><div class="num" style="${totAtras ? 'color:#a1352a;' : ''}">${totAtras}</div><div class="label">Atrasadas na devolução</div></div>
      </div>
      ${modelos.length ? cards : '<div class="card"><div class="empty">Nenhum modelo na frota ainda. Clique em "Novo modelo" pra cadastrar o primeiro.</div></div>'}
      <script>
        function frAbrirAlugar(id){ var b=document.getElementById('fr_alugar_'+id); if(b){ b.style.display='block'; b.scrollIntoView({behavior:'smooth',block:'nearest'}); } }
        function frFecharAlugar(id){ var b=document.getElementById('fr_alugar_'+id); if(b) b.style.display='none'; }

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

module.exports = { frotaPainelPage, frotaFormPage };
