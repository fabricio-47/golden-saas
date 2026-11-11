'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatDate, formatDateOnly, formatMoney } = require('../utils');
const { LOGO_DATA_URI } = require('../assets/logo');

const STATUS_LABELS = {
  orcamento: 'Orçamento',
  execucao: 'Execução',
  concluida: 'Concluída',
};

const PRIORIDADE_LABELS = {
  baixa: 'Baixa',
  normal: 'Normal',
  alta: 'Alta',
  urgente: 'Urgente',
};
// cores sólidas com texto branco — legíveis no tema claro e escuro
const PRIORIDADE_COR = {
  baixa: '#8a8575',
  normal: '#2f6b3a',
  alta: '#a66a00',
  urgente: '#a1352a',
};
function prioridadeBadge(prioridade) {
  const p = prioridade && PRIORIDADE_LABELS[prioridade] ? prioridade : 'normal';
  return `<span class="badge" style="background:${PRIORIDADE_COR[p]};color:#fff;">${PRIORIDADE_LABELS[p]}</span>`;
}

const CHECKLIST_ITEMS = [
  'Inspeção visual do quadro',
  'Motor (ruído / funcionamento)',
  'Fiação e conectores',
  'Display / computador de bordo',
  'Integridade física da bateria',
  'Freios',
  'Pneus e câmaras',
  'Sistema de transmissão',
];

function totalValor(os) {
  const pecas = Number(os.valor_pecas) || 0;
  const maoObra = Number(os.valor_mao_obra) || 0;
  const desconto = Number(os.desconto) || 0;
  return Math.max(0, pecas + maoObra - desconto);
}

const FORMA_PAGAMENTO_LABELS = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  debito: 'Cartão de débito',
  credito: 'Cartão de crédito',
};

function formaPagamentoLabel(os) {
  if (!os.forma_pagamento) return '-';
  const base = FORMA_PAGAMENTO_LABELS[os.forma_pagamento] || os.forma_pagamento;
  if (os.forma_pagamento === 'credito' && os.parcelas && os.parcelas > 1) {
    return `${base} (${os.parcelas}x)`;
  }
  return base;
}

function ordensListPage({ user, flash, ordens, statusFilter, mostrarDesativadas, podeAlterar = true }) {
  const rows = ordens
    .map(
      (os) => `
    <tr>
      <td><a class="link-btn" href="/os/${os.id}">${escapeHtml(os.numero)}</a></td>
      <td>${escapeHtml(os.cliente_nome)}</td>
      <td>${escapeHtml(os.marca || '')} ${escapeHtml(os.modelo)}</td>
      <td>${os.ativo ? `<span class="badge badge-${os.status}">${STATUS_LABELS[os.status] || os.status}</span>` : '<span class="badge badge-desativada">Desativada</span>'}</td>
      <td>${prioridadeBadge(os.prioridade)}</td>
      <td>${os.previsao_entrega ? formatDateOnly(os.previsao_entrega) : '<span class="muted">—</span>'}</td>
      <td>${formatMoney(totalValor(os))}</td>
      <td>${formatDate(os.data_entrada)}</td>
    </tr>`
    )
    .join('');

  const filterLink = (value, label) =>
    `<a class="btn btn-sm ${statusFilter === value ? 'btn' : 'btn-secondary'}" href="/os${value ? `?status=${value}` : ''}">${label}</a>`;

  return layout({
    title: 'Ordens de Serviço',
    activeNav: 'os',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Ordens de Serviço</h1>
          <p class="subtitle">Acompanhe o fluxo de manutenção da oficina</p>
        </div>
        ${podeAlterar ? `<a class="btn" href="/os/novo">+ Nova Ordem de Serviço</a>` : ''}
      </div>
      <div class="actions-row" style="margin-top:0;margin-bottom:20px;">
        ${filterLink('', 'Todas')}
        ${filterLink('orcamento', 'Orçamento')}
        ${filterLink('execucao', 'Execução')}
        ${filterLink('concluida', 'Concluídas')}
        <a class="btn btn-sm ${mostrarDesativadas ? 'btn' : 'btn-secondary'}" href="/os?desativadas=${mostrarDesativadas ? '0' : '1'}${statusFilter ? `&status=${statusFilter}` : ''}">${mostrarDesativadas ? 'Ver ativas' : 'Ver desativadas'}</a>
      </div>
      <div class="card">
        ${
          ordens.length
            ? `<table>
          <thead><tr><th>Número</th><th>Cliente</th><th>Veículo</th><th>Status</th><th>Prioridade</th><th>Previsão</th><th>Valor</th><th>Entrada</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
            : `<div class="empty">Nenhuma ordem de serviço ${mostrarDesativadas ? 'desativada' : 'encontrada'}.</div>`
        }
      </div>
    `,
  });
}

function checklistFormFields(checklist) {
  const existing = {};
  (checklist || []).forEach((c) => {
    existing[c.item] = c;
  });
  return CHECKLIST_ITEMS.map((item, idx) => {
    const current = existing[item] || { status: 'ok', observacao: '' };
    return `
      <div class="checklist-row">
        <label class="item-name">${escapeHtml(item)}</label>
        <div class="radio-group">
          <label><input type="radio" name="checklist_status_${idx}" value="ok" ${current.status === 'ok' ? 'checked' : ''}> OK</label>
          <label><input type="radio" name="checklist_status_${idx}" value="atencao" ${current.status === 'atencao' ? 'checked' : ''}> Atenção</label>
        </div>
        <input type="text" name="checklist_obs_${idx}" placeholder="Observação (opcional)" value="${escapeHtml(current.observacao)}">
        <input type="hidden" name="checklist_item_${idx}" value="${escapeHtml(item)}">
      </div>`;
  }).join('');
}

function ordemFormPage({ user, flash, os, clientes, bicicletas, defaultClienteId, defaultBicicletaId, csrfToken, temPecasVinculadas, temServicosVinculados, funcionarios, pecasDisponiveis }) {
  const isEdit = !!os;
  const checklist = os && os.checklist_json ? JSON.parse(os.checklist_json) : [];

  const pecasDisp = pecasDisponiveis || [];
  const pecaOptionsNova = pecasDisp
    .map(
      (p) =>
        `<option value="${p.id}" data-nome="${escapeHtml(p.nome)}" data-preco="${Number(p.preco_venda) || 0}" data-estoque="${Number(p.quantidade) || 0}">${escapeHtml(p.nome)} — ${formatMoney(p.preco_venda)} (estoque: ${Number(p.quantidade) || 0})</option>`
    )
    .join('');

  const clienteOptions = clientes
    .map(
      (c) =>
        `<option value="${c.id}" ${(os && os.cliente_id === c.id) || (!os && defaultClienteId == c.id) ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`
    )
    .join('');

  const bicicletaOptionsHtml = bicicletas
    .map(
      (b) =>
        `<option value="${b.id}" data-cliente="${b.cliente_id}" ${
          (os && os.bicicleta_id === b.id) || (!os && defaultBicicletaId == b.id) ? 'selected' : ''
        }>${escapeHtml(b.marca || '')} ${escapeHtml(b.modelo)} — ${escapeHtml(b.cliente_nome)}</option>`
    )
    .join('');

  const statusOptions = ['orcamento', 'execucao', 'concluida']
    .map((s) => `<option value="${s}" ${os && os.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`)
    .join('');

  return layout({
    title: isEdit ? `Editar ${os.numero}` : 'Nova Ordem de Serviço',
    activeNav: 'os',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>${isEdit ? escapeHtml(os.numero) : 'Nova Ordem de Serviço'}</h1>
          <p class="subtitle">Checklist de entrada especializado e diagnóstico técnico</p>
        </div>
      </div>
      <div class="card">
        <form method="POST" action="${isEdit ? `/os/${os.id}` : '/os'}">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field">
              <label for="cliente_id">Cliente *</label>
              <select id="cliente_id" name="cliente_id" required onchange="filterBicicletas()">
                <option value="">Selecione...</option>
                ${clienteOptions}
              </select>
            </div>
            <div class="field">
              <label for="bicicleta_id">Veículo *</label>
              <select id="bicicleta_id" name="bicicleta_id" required>
                <option value="">Selecione o cliente primeiro...</option>
                ${bicicletaOptionsHtml}
              </select>
            </div>
            ${
              isEdit
                ? `<div class="field">
              <label for="status">Status</label>
              <select id="status" name="status">${statusOptions}</select>
            </div>`
                : ''
            }
            <div class="field">
              <label for="prioridade">Prioridade</label>
              <select id="prioridade" name="prioridade">
                ${['baixa', 'normal', 'alta', 'urgente']
                  .map(
                    (p) =>
                      `<option value="${p}" ${(os && os.prioridade === p) || (!os && p === 'normal') ? 'selected' : ''}>${PRIORIDADE_LABELS[p]}</option>`
                  )
                  .join('')}
              </select>
            </div>
            <div class="field">
              <label for="previsao_entrega">Previsão de entrega</label>
              <input type="date" id="previsao_entrega" name="previsao_entrega" value="${os && os.previsao_entrega ? escapeHtml(os.previsao_entrega) : ''}">
              <p class="muted" style="margin-top:4px;">Data prometida pro cliente buscar o veículo.</p>
            </div>
            <div class="field">
              <label for="tecnico_id">Técnico responsável</label>
              <select id="tecnico_id" name="tecnico_id">
                <option value="">Não definido</option>
                ${(funcionarios || [])
                  .map(
                    (f) =>
                      `<option value="${f.id}" ${os && String(os.tecnico_id) === String(f.id) ? 'selected' : ''}>${escapeHtml(f.nome)}${f.funcao ? ` — ${escapeHtml(f.funcao)}` : ''}</option>`
                  )
                  .join('')}
              </select>
              ${(funcionarios || []).length === 0 ? '<p class="muted" style="margin-top:4px;">Cadastre a equipe em Cadastros → Funcionários.</p>' : ''}
            </div>
          </div>

          <h2 style="margin-top:24px;">Problema relatado pelo cliente</h2>
          <div class="form-grid">
            <div class="field full">
              <label for="problema_relatado">O que o cliente relatou ao trazer o veículo</label>
              <textarea id="problema_relatado" name="problema_relatado" placeholder="Ex: cliente relata ruído no motor e autonomia baixa">${escapeHtml(os ? os.problema_relatado : '')}</textarea>
            </div>
            <div class="field full">
              <label for="acessorios">Acessórios entregues com o veículo</label>
              <textarea id="acessorios" name="acessorios" placeholder="Ex: carregador, bateria extra, chave reserva">${escapeHtml(os ? os.acessorios || '' : '')}</textarea>
              <p class="muted" style="margin-top:4px;">O que veio junto na entrada, pra conferir na devolução.</p>
            </div>
          </div>

          <h2 style="margin-top:24px;">Checklist de entrada</h2>
          <div style="margin-bottom:16px;">
            ${checklistFormFields(checklist)}
          </div>

          <div class="form-grid">
            <div class="field full">
              <label for="diagnostico">Diagnóstico técnico</label>
              <textarea id="diagnostico" name="diagnostico">${escapeHtml(os ? os.diagnostico : '')}</textarea>
            </div>
            <div class="field full">
              <label for="servicos_realizados">Serviços realizados</label>
              <textarea id="servicos_realizados" name="servicos_realizados">${escapeHtml(os ? os.servicos_realizados : '')}</textarea>
            </div>
          </div>

          <h2 style="margin-top:24px;">Valores</h2>
          <div class="form-grid">
            ${
              isEdit
                ? `<div class="field">
              <label for="valor_pecas">Valor de produtos (R$)</label>
              <input type="number" id="valor_pecas" name="valor_pecas" min="0" step="0.01" value="${os && os.valor_pecas !== null ? os.valor_pecas : ''}">
              ${temPecasVinculadas ? '<p class="muted" style="margin-top:4px;">Esta O.S. tem produtos do Estoque vinculados — esse valor é recalculado automaticamente ao adicionar/remover produtos na tela da O.S. Editar aqui só sobrescreve manualmente.</p>' : ''}
            </div>`
                : `<div class="field full">
              <label>Produtos do estoque</label>
              ${
                pecasDisp.length
                  ? `<div class="form-grid" style="margin-bottom:8px;">
                <div class="field">
                  <select id="os_peca_sel">
                    <option value="">Selecione um produto...</option>
                    ${pecaOptionsNova}
                  </select>
                </div>
                <div class="field" style="display:flex;gap:8px;align-items:flex-end;">
                  <input type="number" id="os_peca_qtd" min="1" step="1" value="1" style="max-width:100px;">
                  <button type="button" class="btn btn-sm" onclick="osAddPeca()">+ Adicionar produto</button>
                </div>
              </div>
              <table id="os_pecas_tabela" style="display:none;"><thead><tr><th>Produto</th><th>Qtd.</th><th>Preço un.</th><th>Subtotal</th><th></th></tr></thead><tbody id="os_pecas_tbody"></tbody></table>
              <p class="muted" id="os_pecas_vazio" style="margin-top:4px;">Escolha a peça do estoque — o valor entra sozinho e a peça baixa do estoque ao abrir a O.S. Sem produtos, digite o valor na mão abaixo.</p>
              <input type="hidden" name="os_pecas_json" id="os_pecas_json" value="[]">`
                  : `<p class="muted">Nenhum produto cadastrado no <a class="link-btn" href="/estoque/novo">Estoque</a> ainda. Digite o valor manualmente abaixo.</p>`
              }
            </div>
            <div class="field">
              <label for="valor_pecas">Valor de produtos (R$)</label>
              <input type="number" id="valor_pecas" name="valor_pecas" min="0" step="0.01" value="${os && os.valor_pecas !== null ? os.valor_pecas : ''}">
              <p class="muted" id="os_valor_pecas_nota" style="margin-top:4px;">Preenche sozinho ao escolher produtos acima. Sem produtos, digite o valor na mão.</p>
            </div>`
            }
            <div class="field">
              <label for="valor_mao_obra">Valor de mão de obra (R$)</label>
              <input type="number" id="valor_mao_obra" name="valor_mao_obra" min="0" step="0.01" value="${os && os.valor_mao_obra !== null ? os.valor_mao_obra : ''}">
              ${
                temServicosVinculados
                  ? '<p class="muted" style="margin-top:4px;">Esta O.S. tem serviços vinculados — esse valor é recalculado automaticamente ao adicionar/remover serviços na tela da O.S. Editar aqui só sobrescreve manualmente.</p>'
                  : '<p class="muted" style="margin-top:4px;">Depois de salvar, você pode selecionar os serviços feitos e o valor de cada um na tela da O.S. — esse campo é recalculado automaticamente a partir deles.</p>'
              }
            </div>
            <div class="field">
              <label for="desconto">Desconto (R$)</label>
              <input type="number" id="desconto" name="desconto" min="0" step="0.01" value="${os && os.desconto ? os.desconto : ''}">
              <p class="muted" style="margin-top:4px;">Abatido do total (produtos + mão de obra − desconto).</p>
            </div>
            <div class="field">
              <label for="forma_pagamento">Forma de pagamento</label>
              <select id="forma_pagamento" name="forma_pagamento" onchange="toggleParcelas()">
                <option value="">Não definida</option>
                <option value="pix" ${os && os.forma_pagamento === 'pix' ? 'selected' : ''}>Pix</option>
                <option value="dinheiro" ${os && os.forma_pagamento === 'dinheiro' ? 'selected' : ''}>Dinheiro</option>
                <option value="debito" ${os && os.forma_pagamento === 'debito' ? 'selected' : ''}>Cartão de débito</option>
                <option value="credito" ${os && os.forma_pagamento === 'credito' ? 'selected' : ''}>Cartão de crédito</option>
              </select>
            </div>
            <div class="field" id="campo-parcelas">
              <label for="parcelas">Parcelado em quantas vezes</label>
              <input type="number" id="parcelas" name="parcelas" min="1" max="24" value="${os && os.parcelas ? os.parcelas : 1}">
            </div>
          </div>

          <h2 style="margin-top:24px;">Garantia</h2>
          <div class="form-grid">
            <div class="field full">
              <label for="termos_garantia">Termos de garantia</label>
              <textarea id="termos_garantia" name="termos_garantia" placeholder="Ex: 90 dias de garantia no serviço executado e nas peças trocadas. Não cobre mau uso, quedas ou contato com água.">${escapeHtml(os ? os.termos_garantia || '' : '')}</textarea>
              <p class="muted" style="margin-top:4px;">O que está coberto e por quanto tempo — aparece na O.S. pra evitar discussão depois.</p>
            </div>
          </div>

          <div class="actions-row">
            <button class="btn" type="submit">${isEdit ? 'Salvar alterações' : 'Abrir Ordem de Serviço'}</button>
            <a class="btn btn-secondary" href="${isEdit ? `/os/${os.id}` : '/os'}">Cancelar</a>
          </div>
          ${!isEdit ? '<p class="muted" style="margin-top:12px;">Depois de salvar, você poderá adicionar fotos e vídeos da checagem e dos serviços realizados.</p>' : ''}
        </form>
      </div>

      <script>
        var allBikeOptions = Array.prototype.slice.call(document.querySelectorAll('#bicicleta_id option[data-cliente]'))
          .map(function(o) { return { value: o.value, cliente: o.getAttribute('data-cliente'), text: o.textContent }; });

        function filterBicicletas() {
          var clienteId = document.getElementById('cliente_id').value;
          var select = document.getElementById('bicicleta_id');
          var current = select.value;
          select.innerHTML = '';
          var placeholder = document.createElement('option');
          placeholder.value = '';
          placeholder.textContent = clienteId ? 'Selecione o veículo...' : 'Selecione o cliente primeiro...';
          select.appendChild(placeholder);
          allBikeOptions.filter(function(o) { return !clienteId || o.cliente === clienteId; }).forEach(function(o) {
            var opt = document.createElement('option');
            opt.value = o.value;
            opt.textContent = o.text;
            if (o.value === current) opt.selected = true;
            select.appendChild(opt);
          });
        }
        document.getElementById('cliente_id').addEventListener('change', filterBicicletas);
        if (document.getElementById('cliente_id').value) { filterBicicletas(); }

        function toggleParcelas() {
          var forma = document.getElementById('forma_pagamento').value;
          document.getElementById('campo-parcelas').style.display = forma === 'credito' ? '' : 'none';
        }
        toggleParcelas();

        // ---- Seletor de produtos do estoque na tela de criação da O.S. ----
        var OS_PECAS = [];
        function osMoney(v){ return 'R$ ' + (Number(v)||0).toFixed(2).replace('.', ','); }
        function osRenderPecas(){
          var tb = document.getElementById('os_pecas_tbody');
          if (!tb) return;
          var tabela = document.getElementById('os_pecas_tabela');
          var vazio = document.getElementById('os_pecas_vazio');
          var vp = document.getElementById('valor_pecas');
          var nota = document.getElementById('os_valor_pecas_nota');
          if (!OS_PECAS.length){
            tb.innerHTML = '';
            if (tabela) tabela.style.display = 'none';
            if (vazio) vazio.style.display = 'block';
            if (vp){ vp.readOnly = false; vp.style.background = ''; }
            if (nota) nota.textContent = 'Preenche sozinho ao escolher produtos acima. Sem produtos, digite o valor na mão.';
          } else {
            if (tabela) tabela.style.display = '';
            if (vazio) vazio.style.display = 'none';
            var html = ''; var total = 0;
            OS_PECAS.forEach(function(it, idx){
              var sub = (Number(it.preco)||0) * it.qtd; total += sub;
              html += '<tr><td>' + String(it.nome).replace(/</g,'&lt;') + '</td><td>' + it.qtd + '</td><td>' + osMoney(it.preco) + '</td><td>' + osMoney(sub) + '</td>' +
                '<td><button type="button" class="btn btn-sm btn-danger" onclick="osRemovePeca(' + idx + ')">Remover</button></td></tr>';
            });
            tb.innerHTML = html;
            if (vp){ vp.value = total.toFixed(2); vp.readOnly = true; vp.style.background = '#f0f0f0'; }
            if (nota) nota.textContent = 'Calculado pelos produtos escolhidos (' + osMoney(total) + '). Remova todos para digitar manualmente.';
          }
          var hid = document.getElementById('os_pecas_json');
          if (hid) hid.value = JSON.stringify(OS_PECAS.map(function(it){ return { peca_id: it.peca_id, qtd: it.qtd }; }));
        }
        function osAddPeca(){
          var sel = document.getElementById('os_peca_sel');
          if (!sel || !sel.value) return;
          var opt = sel.options[sel.selectedIndex];
          var qtd = Math.max(1, parseInt(document.getElementById('os_peca_qtd').value, 10) || 1);
          var nome = opt.getAttribute('data-nome') || opt.textContent;
          var preco = parseFloat(opt.getAttribute('data-preco')) || 0;
          var estoque = parseInt(opt.getAttribute('data-estoque'), 10);
          var achou = OS_PECAS.find(function(p){ return String(p.peca_id) === String(sel.value); });
          if (achou){ achou.qtd += qtd; } else { OS_PECAS.push({ peca_id: sel.value, nome: nome, preco: preco, qtd: qtd }); }
          var totalItem = OS_PECAS.find(function(p){ return String(p.peca_id) === String(sel.value); }).qtd;
          if (isFinite(estoque) && totalItem > estoque){
            alert('Atenção: você colocou ' + totalItem + ' de "' + nome + '", mas só há ' + estoque + ' em estoque. Ao abrir a O.S. o estoque vai ficar negativo.');
          }
          sel.value = '';
          document.getElementById('os_peca_qtd').value = 1;
          osRenderPecas();
        }
        function osRemovePeca(idx){ OS_PECAS.splice(idx, 1); osRenderPecas(); }
      </script>
    `,
  });
}

function mediaGrid(midias, osId, csrfToken) {
  if (!midias.length) return '<p class="muted">Nenhum arquivo enviado ainda.</p>';
  return `<div class="media-grid">${midias
    .map(
      (m) => `
    <div class="media-item">
      ${
        m.tipo_arquivo === 'video'
          ? `<video src="/uploads/${m.caminho_arquivo}" controls preload="metadata"></video>`
          : `<a href="/uploads/${m.caminho_arquivo}" target="_blank"><img src="/uploads/${m.caminho_arquivo}" alt="${escapeHtml(m.nome_arquivo)}" loading="lazy"></a>`
      }
      <form method="POST" action="/os/${osId}/midias/${m.id}/excluir" style="display:inline;" onsubmit="return confirm('Remover este arquivo?');">
        <input type="hidden" name="csrf" value="${csrfToken}">
        <button class="media-del" type="submit" title="Remover">×</button>
      </form>
    </div>`
    )
    .join('')}</div>`;
}

function pecasOsSection(osId, osPecas, pecasDisponiveis, csrfToken) {
  const rows = osPecas
    .map((item) => {
      const subtotal = item.quantidade * item.preco_unitario;
      return `
    <tr>
      <td>${escapeHtml(item.nome_peca)}</td>
      <td>${item.quantidade}</td>
      <td>${formatMoney(item.preco_unitario)}</td>
      <td>${formatMoney(subtotal)}</td>
      <td>
        <form method="POST" action="/os/${osId}/pecas/${item.id}/excluir" onsubmit="return confirm('Remover este produto da O.S.? A quantidade volta pro estoque.');">
          <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
          <button class="btn btn-sm btn-danger" type="submit">Remover</button>
        </form>
      </td>
    </tr>`;
    })
    .join('');

  const options = pecasDisponiveis
    .map((p) => `<option value="${p.id}" data-preco="${p.preco_venda}">${escapeHtml(p.nome)} (estoque: ${p.quantidade}) — ${formatMoney(p.preco_venda)}</option>`)
    .join('');

  const totalPecas = osPecas.reduce((sum, item) => sum + item.quantidade * item.preco_unitario, 0);

  return `
      <div class="card">
        <h2>Produtos do estoque usados nesta O.S.</h2>
        ${
          osPecas.length
            ? `<table><thead><tr><th>Produto</th><th>Qtd.</th><th>Preço unit.</th><th>Subtotal</th><th></th></tr></thead><tbody>${rows}</tbody></table>
               <p style="margin-top:12px;"><strong>Total em produtos do estoque: ${formatMoney(totalPecas)}</strong></p>`
            : '<p class="muted">Nenhum produto do estoque vinculado a esta O.S. ainda.</p>'
        }
        ${
          pecasDisponiveis.length
            ? `<form method="POST" action="/os/${osId}/pecas" style="margin-top:16px;">
          <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
          <div class="form-grid">
            <div class="field">
              <label for="peca_id">Produto</label>
              <select id="peca_id" name="peca_id" required>
                <option value="">Selecione...</option>
                ${options}
              </select>
            </div>
            <div class="field">
              <label for="peca_quantidade">Quantidade</label>
              <input type="number" id="peca_quantidade" name="quantidade" min="1" step="1" value="1" required>
            </div>
          </div>
          <button class="btn btn-sm" type="submit">+ Adicionar produto à O.S.</button>
        </form>`
            : '<p class="muted" style="margin-top:12px;">Nenhum produto cadastrado no <a class="link-btn" href="/estoque/novo">Estoque</a> ainda.</p>'
        }
        <p class="muted" style="margin-top:8px;">Ao adicionar um produto aqui, ele é descontado do estoque automaticamente, e o "Valor de produtos" da O.S. é recalculado.</p>
      </div>`;
}

function servicosOsSection(osId, osServicos, servicosDisponiveis, csrfToken) {
  const rows = osServicos
    .map(
      (item) => `
    <tr>
      <td>${escapeHtml(item.nome_servico)}</td>
      <td>${formatMoney(item.valor)}</td>
      <td>
        <form method="POST" action="/os/${osId}/servicos/${item.id}/excluir" onsubmit="return confirm('Remover este serviço da O.S.?');">
          <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
          <button class="btn btn-sm btn-danger" type="submit">Remover</button>
        </form>
      </td>
    </tr>`
    )
    .join('');

  const catalogoOptions = servicosDisponiveis
    .map((s) => `<option value="${s.id}" data-nome="${escapeHtml(s.nome)}" data-valor="${s.valor}">${escapeHtml(s.nome)} — ${formatMoney(s.valor)}</option>`)
    .join('');

  const totalServicos = osServicos.reduce((sum, item) => sum + Number(item.valor), 0);

  return `
      <div class="card">
        <h2>Serviços realizados (mão de obra)</h2>
        ${
          osServicos.length
            ? `<table><thead><tr><th>Serviço</th><th>Valor</th><th></th></tr></thead><tbody>${rows}</tbody></table>
               <p style="margin-top:12px;"><strong>Total em mão de obra: ${formatMoney(totalServicos)}</strong></p>`
            : '<p class="muted">Nenhum serviço vinculado a esta O.S. ainda.</p>'
        }
        <form method="POST" action="/os/${osId}/servicos" style="margin-top:16px;">
          <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
          <div class="form-grid">
            ${
              catalogoOptions
                ? `<div class="field">
              <label for="servico_catalogo">Serviço do catálogo (opcional)</label>
              <select id="servico_catalogo" name="tipo_servico_id" onchange="const o=this.options[this.selectedIndex]; if(o.dataset.nome){ document.getElementById('servico_nome').value=o.dataset.nome; document.getElementById('servico_valor').value=o.dataset.valor; }">
                <option value="">Digitar manualmente...</option>
                ${catalogoOptions}
              </select>
            </div>`
                : ''
            }
            <div class="field">
              <label for="servico_nome">Nome do serviço *</label>
              <input type="text" id="servico_nome" name="nome_servico" required placeholder="Ex: Troca de pneu traseiro">
            </div>
            <div class="field">
              <label for="servico_valor">Valor (R$) *</label>
              <input type="number" id="servico_valor" name="valor" min="0" step="0.01" required>
            </div>
          </div>
          <button class="btn btn-sm" type="submit">+ Adicionar serviço à O.S.</button>
        </form>
        <p class="muted" style="margin-top:8px;">Escolher um serviço do catálogo só preenche nome e valor sugeridos — você pode editar antes de adicionar. O "Valor de mão de obra" da O.S. é recalculado automaticamente pela soma dos serviços. Cadastre tipos de serviço em Estoque → Tipos de Serviço.</p>
      </div>`;
}

function ordemShowPage({ user, flash, os, midiasChecklist, midiasServico, osPecas, pecasDisponiveis, osServicos, servicosDisponiveis, csrfToken, podeAlterar = true }) {
  const checklist = os.checklist_json ? JSON.parse(os.checklist_json) : [];
  const checklistRows = checklist
    .map(
      (c) => `
    <tr>
      <td>${escapeHtml(c.item)}</td>
      <td><span class="badge badge-${c.status}">${c.status === 'ok' ? 'OK' : 'Atenção'}</span></td>
      <td>${escapeHtml(c.observacao || '-')}</td>
    </tr>`
    )
    .join('');

  return layout({
    title: os.numero,
    activeNav: 'os',
    user,
    flash,
    children: `
      ${!os.ativo ? '<div class="flash flash-error">Esta Ordem de Serviço está desativada. Ela não aparece nas listas normais nem conta nos totais do Dashboard.</div>' : ''}

      <div class="page-header">
        <div>
          <h1>${escapeHtml(os.numero)} ${os.ativo ? `<span class="badge badge-${os.status}">${STATUS_LABELS[os.status] || os.status}</span>` : '<span class="badge badge-desativada">Desativada</span>'} ${os.ativo ? prioridadeBadge(os.prioridade) : ''}</h1>
          <p class="subtitle">
            Cliente: <a class="link-btn" href="/clientes/${os.cliente_id}">${escapeHtml(os.cliente_nome)}</a>
            &nbsp;·&nbsp;
            Veículo: <a class="link-btn" href="/bicicletas/${os.bicicleta_id}">${escapeHtml(os.marca || '')} ${escapeHtml(os.modelo)}</a>
            ${os.tecnico_nome ? `&nbsp;·&nbsp; Técnico: ${escapeHtml(os.tecnico_nome)}` : ''}
          </p>
        </div>
        <div class="actions-row" style="margin-top:0;">
          <a class="btn btn-secondary" href="/os/${os.id}/imprimir" target="_blank" rel="noopener">🖨 Imprimir</a>
          <form method="POST" action="/os/${os.id}/enviar-email" onsubmit="return confirm('Enviar um resumo desta O.S. por e-mail para o cliente?');">
            <input type="hidden" name="csrf" value="${csrfToken}">
            <button class="btn btn-secondary" type="submit">✉ Enviar por e-mail</button>
          </form>
          ${podeAlterar ? `<a class="btn btn-secondary" href="/os/${os.id}/editar">Editar</a>` : ''}
          ${
            podeAlterar && os.status !== 'concluida' && os.ativo
              ? `<form method="POST" action="/os/${os.id}/finalizar" onsubmit="return confirm('Finalizar esta O.S. e avisar o cliente por e-mail que o serviço está pronto?');">
            <input type="hidden" name="csrf" value="${csrfToken}">
            <button class="btn" type="submit">✔ Finalizar e avisar cliente</button>
          </form>`
              : ''
          }
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat-card"><div class="num">${formatMoney(totalValor(os))}</div><div class="label">Valor total (produtos + mão de obra)</div></div>
        <div class="stat-card"><div class="num">${formatDate(os.data_entrada).split(' ')[0]}</div><div class="label">Data de entrada</div></div>
        <div class="stat-card"><div class="num">${os.previsao_entrega ? formatDateOnly(os.previsao_entrega) : '-'}</div><div class="label">Previsão de entrega</div></div>
        <div class="stat-card"><div class="num">${os.data_conclusao ? formatDate(os.data_conclusao).split(' ')[0] : '-'}</div><div class="label">Data de conclusão</div></div>
      </div>

      <div class="card">
        <h2>Valores</h2>
        <div class="value-breakdown">
          <div class="item"><div class="muted">Produtos</div><div style="font-size:18px;font-weight:600;">${formatMoney(os.valor_pecas)}</div></div>
          <div class="item"><div class="muted">Mão de obra</div><div style="font-size:18px;font-weight:600;">${formatMoney(os.valor_mao_obra)}</div></div>
          ${Number(os.desconto) > 0 ? `<div class="item"><div class="muted">Desconto</div><div style="font-size:18px;font-weight:600;color:#a1352a;">− ${formatMoney(os.desconto)}</div></div>` : ''}
          <div class="item"><div class="muted">Total</div><div style="font-size:18px;font-weight:600;color:#1f6b3a;">${formatMoney(totalValor(os))}</div></div>
          <div class="item"><div class="muted">Pagamento</div><div style="font-size:18px;font-weight:600;">${formaPagamentoLabel(os)}</div></div>
        </div>
      </div>

      ${pecasOsSection(os.id, osPecas, pecasDisponiveis, csrfToken)}

      ${servicosOsSection(os.id, osServicos || [], servicosDisponiveis || [], csrfToken)}

      <div class="card">
        <h2>Problema relatado pelo cliente</h2>
        <p>${os.problema_relatado ? escapeHtml(os.problema_relatado).replace(/\n/g, '<br>') : '<span class="muted">Nenhum problema relatado registrado.</span>'}</p>
        ${
          os.acessorios
            ? `<h2 style="margin-top:20px;">Acessórios entregues</h2>
        <p>${escapeHtml(os.acessorios).replace(/\n/g, '<br>')}</p>`
            : ''
        }
      </div>

      <div class="card">
        <h2>Checklist de entrada</h2>
        ${
          checklist.length
            ? `<table><thead><tr><th>Item</th><th>Status</th><th>Observação</th></tr></thead><tbody>${checklistRows}</tbody></table>`
            : '<div class="empty">Nenhum checklist preenchido.</div>'
        }
        <h2 style="margin-top:20px;">Fotos da checagem</h2>
        ${mediaGrid(midiasChecklist, os.id, csrfToken)}
        <form method="POST" action="/os/${os.id}/midias" enctype="multipart/form-data" style="margin-top:12px;">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <input type="hidden" name="categoria" value="checklist">
          <div class="upload-box">
            <input type="file" name="arquivos" accept="image/*" multiple capture="environment">
            <button class="btn btn-sm" type="submit" style="margin-top:10px;">Enviar fotos da checagem</button>
          </div>
        </form>
      </div>

      <div class="card">
        <h2>Diagnóstico técnico</h2>
        <p>${os.diagnostico ? escapeHtml(os.diagnostico).replace(/\n/g, '<br>') : '<span class="muted">Nenhum diagnóstico registrado.</span>'}</p>
      </div>

      <div class="card">
        <h2>Serviços realizados</h2>
        <p>${os.servicos_realizados ? escapeHtml(os.servicos_realizados).replace(/\n/g, '<br>') : '<span class="muted">Nenhum serviço registrado ainda.</span>'}</p>
        <h2 style="margin-top:20px;">Fotos e vídeos dos serviços realizados</h2>
        ${mediaGrid(midiasServico, os.id, csrfToken)}
        <form method="POST" action="/os/${os.id}/midias" enctype="multipart/form-data" style="margin-top:12px;">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <input type="hidden" name="categoria" value="servico">
          <div class="upload-box">
            <input type="file" name="arquivos" accept="image/*,video/*" multiple capture="environment">
            <button class="btn btn-sm" type="submit" style="margin-top:10px;">Enviar fotos/vídeos do serviço</button>
          </div>
        </form>
        <p class="muted" style="margin-top:8px;">Arquivos até 20MB cada. No plano gratuito de hospedagem, esses arquivos podem ser apagados quando o servidor "dormir" por inatividade.</p>
      </div>

      ${
        os.termos_garantia
          ? `<div class="card">
        <h2>Termos de garantia</h2>
        <p>${escapeHtml(os.termos_garantia).replace(/\n/g, '<br>')}</p>
      </div>`
          : ''
      }

      ${
        !podeAlterar
          ? ''
          : os.ativo
          ? `<form method="POST" action="/os/${os.id}/desativar" onsubmit="return confirm('Desativar esta ordem de serviço? Ela sai das listas e totais, mas o histórico continua salvo e pode ser reativado depois.');">
        <input type="hidden" name="csrf" value="${csrfToken}">
        <button class="btn btn-danger btn-sm" type="submit">Desativar O.S.</button>
      </form>`
          : `<form method="POST" action="/os/${os.id}/reativar">
        <input type="hidden" name="csrf" value="${csrfToken}">
        <button class="btn btn-sm" type="submit">Reativar O.S.</button>
      </form>`
      }
    `,
  });
}

function diasAtraso(previsao, hoje) {
  const a = new Date(previsao + 'T00:00:00');
  const b = new Date(hoje + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

function ordemPainelPage({ user, flash, abertas, fatur, faturTecnico, hoje, amanha, podeAlterar = true }) {
  // separa as O.S. abertas por prazo de entrega
  const bucket = { vencidas: [], hoje: [], amanha: [], futuras: [], sem: [] };
  for (const os of abertas) {
    const p = os.previsao_entrega;
    if (!p) bucket.sem.push(os);
    else if (p < hoje) bucket.vencidas.push(os);
    else if (p === hoje) bucket.hoje.push(os);
    else if (p === amanha) bucket.amanha.push(os);
    else bucket.futuras.push(os);
  }
  const prio = { urgente: 0, alta: 0, normal: 0, baixa: 0 };
  for (const os of abertas) {
    const k = os.prioridade && prio[os.prioridade] !== undefined ? os.prioridade : 'normal';
    prio[k]++;
  }

  const prazoCard = (titulo, lista, cor) => `
    <div class="stat-card" style="${cor ? `border-left:4px solid ${cor};` : ''}">
      <div class="num">${lista.length}</div>
      <div class="label">${titulo}</div>
    </div>`;

  // O.S. que precisam de atenção = vencidas + de hoje, mais urgentes primeiro
  const ordemPrio = { urgente: 0, alta: 1, normal: 2, baixa: 3 };
  const atencao = [...bucket.vencidas, ...bucket.hoje].sort((a, b) => {
    const pa = a.previsao_entrega || '';
    const pb = b.previsao_entrega || '';
    if (pa !== pb) return pa.localeCompare(pb);
    return (ordemPrio[a.prioridade] ?? 2) - (ordemPrio[b.prioridade] ?? 2);
  });

  const atencaoRows = atencao
    .map((os) => {
      const atraso = os.previsao_entrega && os.previsao_entrega < hoje ? diasAtraso(os.previsao_entrega, hoje) : 0;
      const prazoTxt = atraso > 0
        ? `<span style="color:#a1352a;font-weight:600;">${formatDateOnly(os.previsao_entrega)} · ${atraso} dia${atraso > 1 ? 's' : ''} em atraso</span>`
        : `<span style="color:#a66a00;font-weight:600;">Hoje</span>`;
      return `
      <tr>
        <td><a class="link-btn" href="/os/${os.id}">${escapeHtml(os.numero)}</a></td>
        <td>${escapeHtml(os.cliente_nome)}</td>
        <td>${escapeHtml(os.marca || '')} ${escapeHtml(os.modelo)}</td>
        <td>${prioridadeBadge(os.prioridade)}</td>
        <td><span class="badge badge-${os.status}">${STATUS_LABELS[os.status] || os.status}</span></td>
        <td>${prazoTxt}</td>
      </tr>`;
    })
    .join('');

  // faturamento das O.S. por mês (fatur vem do mais recente pro mais antigo)
  const faturCron = [...fatur].reverse();
  const maxFatur = Math.max(1, ...faturCron.map((f) => Number(f.total) || 0));
  const faturBars = faturCron
    .map((f) => {
      const total = Number(f.total) || 0;
      const pct = Math.round((total / maxFatur) * 100);
      const [ano, mes] = f.ym.split('-');
      return `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <div style="width:70px;font-size:13px;color:var(--text-muted);">${mes}/${ano}</div>
        <div style="flex:1;background:var(--border);border-radius:6px;height:22px;position:relative;overflow:hidden;">
          <div style="width:${pct}%;background:var(--gold, #b8922f);height:100%;border-radius:6px;min-width:2px;"></div>
        </div>
        <div style="width:110px;text-align:right;font-size:13px;font-weight:600;">${formatMoney(total)}</div>
        <div style="width:70px;text-align:right;font-size:12px;color:var(--text-muted);">${f.n} O.S.</div>
      </div>`;
    })
    .join('');

  return layout({
    title: 'Painel de O.S.',
    activeNav: 'os-painel',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Painel de Ordens de Serviço</h1>
          <p class="subtitle">Prazos de entrega e prioridade das O.S. em aberto</p>
        </div>
        <div class="actions-row" style="margin-top:0;">
          <a class="btn btn-secondary" href="/os">Ver todas as O.S.</a>
          ${podeAlterar ? `<a class="btn" href="/os/novo">+ Nova O.S.</a>` : ''}
        </div>
      </div>

      <h2 style="margin-bottom:12px;">Prazos de entrega</h2>
      <div class="stat-grid">
        ${prazoCard('Vencidas', bucket.vencidas, '#a1352a')}
        ${prazoCard('Entrega hoje', bucket.hoje, '#a66a00')}
        ${prazoCard('Entrega amanhã', bucket.amanha, '#2f6b3a')}
        ${prazoCard('Futuras', bucket.futuras, '#8a8575')}
        ${prazoCard('Sem previsão', bucket.sem, '')}
      </div>

      <h2 style="margin:24px 0 12px;">Prioridade (O.S. em aberto)</h2>
      <div class="stat-grid">
        <div class="stat-card" style="border-left:4px solid #a1352a;"><div class="num">${prio.urgente}</div><div class="label">Urgente</div></div>
        <div class="stat-card" style="border-left:4px solid #a66a00;"><div class="num">${prio.alta}</div><div class="label">Alta</div></div>
        <div class="stat-card" style="border-left:4px solid #2f6b3a;"><div class="num">${prio.normal}</div><div class="label">Normal</div></div>
        <div class="stat-card" style="border-left:4px solid #8a8575;"><div class="num">${prio.baixa}</div><div class="label">Baixa</div></div>
      </div>

      <div class="card" style="margin-top:24px;">
        <h2>Precisam de atenção (vencidas e de hoje)</h2>
        ${
          atencao.length
            ? `<table>
          <thead><tr><th>Número</th><th>Cliente</th><th>Veículo</th><th>Prioridade</th><th>Status</th><th>Prazo</th></tr></thead>
          <tbody>${atencaoRows}</tbody>
        </table>`
            : '<p class="muted">Nenhuma O.S. vencida ou com entrega hoje. Tudo em dia. 👍</p>'
        }
      </div>

      <div class="card" style="margin-top:4px;">
        <h2>Faturamento das O.S. por mês</h2>
        <p class="muted" style="margin-top:-4px;margin-bottom:16px;">Soma do valor estimado das O.S. abertas em cada mês (últimos 6 meses).</p>
        ${faturBars || '<p class="muted">Sem O.S. registradas ainda.</p>'}
      </div>

      <div class="card" style="margin-top:4px;">
        <h2>Faturamento por técnico</h2>
        <p class="muted" style="margin-top:-4px;margin-bottom:16px;">Total das O.S. de cada técnico responsável.</p>
        ${
          (faturTecnico || []).length
            ? `<table>
          <thead><tr><th>Técnico</th><th>O.S.</th><th style="text-align:right;">Total</th></tr></thead>
          <tbody>${faturTecnico
            .map(
              (t) => `<tr>
                <td>${escapeHtml(t.tecnico)}</td>
                <td>${t.n}</td>
                <td style="text-align:right;font-weight:600;">${formatMoney(t.total)}</td>
              </tr>`
            )
            .join('')}</tbody>
        </table>`
            : '<p class="muted">Sem O.S. registradas ainda.</p>'
        }
      </div>
    `,
  });
}

const TIPO_VEICULO_LABEL = { bicicleta: 'Scooter elétrica', moto: 'Moto elétrica' };

// Folha A4 limpa da O.S., pronta pra imprimir ou salvar em PDF. Documento HTML
// próprio (sem o menu lateral do sistema).
function ordemImprimirPage({ os, osPecas, osServicos }) {
  const checklist = os.checklist_json ? JSON.parse(os.checklist_json) : [];
  const linha = (label, valor) =>
    valor ? `<div class="row"><span class="lbl">${label}</span><span class="val">${escapeHtml(String(valor))}</span></div>` : '';

  const servicosRows = (osServicos || [])
    .map((s) => `<tr><td>${escapeHtml(s.nome_servico)}</td><td class="r">${formatMoney(s.valor)}</td></tr>`)
    .join('');
  const pecasRows = (osPecas || [])
    .map(
      (p) =>
        `<tr><td>${escapeHtml(p.nome_peca)}</td><td class="c">${p.quantidade}</td><td class="r">${formatMoney(p.preco_unitario)}</td><td class="r">${formatMoney(p.quantidade * p.preco_unitario)}</td></tr>`
    )
    .join('');

  const checklistRows = checklist
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.item)}</td><td>${c.status === 'ok' ? 'OK' : 'Atenção'}</td><td>${escapeHtml(c.observacao || '-')}</td></tr>`
    )
    .join('');

  const seriais = [
    os.motor_serial ? `Motor: ${os.motor_serial}` : '',
    os.controladora_serial ? `Controladora: ${os.controladora_serial}` : '',
    os.bateria_serial ? `Bateria: ${os.bateria_serial}` : '',
    os.chassi_numero ? `Chassi: ${os.chassi_numero}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(os.numero)} - Golden Motors</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; background: #f2f2f2; font-size: 13px; }
  .sheet { background: #fff; max-width: 780px; margin: 16px auto; padding: 28px 32px; }
  .toolbar { max-width: 780px; margin: 10px auto 0; text-align: right; }
  .toolbar button { background: #111; color: #fff; border: none; padding: 9px 18px; border-radius: 6px; font-size: 14px; cursor: pointer; }
  .head { display: flex; justify-content: space-between; align-items: center; gap: 16px; background: #000; color: #fff; border-radius: 8px; padding: 14px 20px; }
  .head img { height: 60px; width: auto; display: block; }
  .doc { text-align: right; }
  .doc .num { font-size: 19px; font-weight: 700; color: #fff; }
  .doc .meta { font-size: 11.5px; color: #cfc9bb; }
  .head-rule { height: 3px; background: #b8922f; border-radius: 2px; margin: 0 0 4px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: #b8922f; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin: 18px 0 8px; }
  .cols { display: flex; gap: 24px; }
  .cols > div { flex: 1; }
  .row { display: flex; gap: 8px; padding: 2px 0; }
  .row .lbl { color: #666; min-width: 92px; }
  .row .val { font-weight: 600; }
  .box { white-space: pre-wrap; border: 1px solid #e3e3e3; border-radius: 4px; padding: 8px 10px; min-height: 20px; background: #fafafa; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e3e3e3; font-size: 12.5px; }
  th { background: #f6f3ea; color: #555; text-transform: uppercase; font-size: 11px; letter-spacing: .04em; }
  td.r, th.r { text-align: right; } td.c, th.c { text-align: center; }
  .totais { margin-top: 10px; margin-left: auto; width: 280px; }
  .totais .row { justify-content: space-between; border-bottom: 1px solid #eee; padding: 4px 0; }
  .totais .tot { font-weight: 800; font-size: 15px; border-bottom: none; border-top: 2px solid #111; padding-top: 6px; }
  .assinaturas { display: flex; gap: 40px; margin-top: 48px; }
  .assinaturas > div { flex: 1; border-top: 1px solid #111; padding-top: 6px; text-align: center; font-size: 12px; color: #555; }
  .foot { margin-top: 24px; font-size: 11px; color: #888; text-align: center; }
  @media print {
    body { background: #fff; }
    .toolbar { display: none; }
    .sheet { margin: 0; max-width: none; padding: 0 6mm; }
    @page { size: A4; margin: 12mm; }
  }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">🖨 Imprimir / Salvar PDF</button></div>
  <div class="sheet">
    <div class="head">
      <img src="${LOGO_DATA_URI}" alt="Golden Motors">
      <div class="doc">
        <div class="num">Ordem de Serviço ${escapeHtml(os.numero)}</div>
        <div class="meta">Entrada: ${formatDate(os.data_entrada)}</div>
        ${os.previsao_entrega ? `<div class="meta">Previsão de entrega: ${formatDateOnly(os.previsao_entrega)}</div>` : ''}
        <div class="meta">Status: ${STATUS_LABELS[os.status] || os.status} · Prioridade: ${PRIORIDADE_LABELS[os.prioridade] || 'Normal'}</div>
      </div>
    </div>
    <div class="head-rule"></div>

    <div class="cols">
      <div>
        <h2>Cliente</h2>
        ${linha('Nome', os.cliente_nome)}
        ${linha('Telefone', os.cliente_telefone)}
        ${linha('E-mail', os.cliente_email)}
      </div>
      <div>
        <h2>Veículo</h2>
        ${linha('Tipo', TIPO_VEICULO_LABEL[os.tipo_veiculo] || os.tipo_veiculo)}
        ${linha('Marca/Mod.', `${os.marca || ''} ${os.modelo || ''}`.trim())}
        ${linha('Cor', os.cor)}
        ${linha('Técnico', os.tecnico_nome)}
      </div>
    </div>
    ${seriais ? `<div class="row" style="margin-top:6px;"><span class="lbl">Seriais</span><span class="val" style="font-weight:400;">${escapeHtml(seriais)}</span></div>` : ''}

    ${os.problema_relatado ? `<h2>Problema relatado</h2><div class="box">${escapeHtml(os.problema_relatado)}</div>` : ''}
    ${os.acessorios ? `<h2>Acessórios entregues</h2><div class="box">${escapeHtml(os.acessorios)}</div>` : ''}
    ${os.diagnostico ? `<h2>Diagnóstico técnico</h2><div class="box">${escapeHtml(os.diagnostico)}</div>` : ''}

    ${
      checklist.length
        ? `<h2>Checklist de entrada</h2><table><thead><tr><th>Item</th><th>Status</th><th>Observação</th></tr></thead><tbody>${checklistRows}</tbody></table>`
        : ''
    }

    ${
      (osServicos || []).length
        ? `<h2>Serviços</h2><table><thead><tr><th>Serviço</th><th class="r">Valor</th></tr></thead><tbody>${servicosRows}</tbody></table>`
        : ''
    }

    ${
      (osPecas || []).length
        ? `<h2>Produtos / Peças</h2><table><thead><tr><th>Produto</th><th class="c">Qtd.</th><th class="r">Unit.</th><th class="r">Subtotal</th></tr></thead><tbody>${pecasRows}</tbody></table>`
        : ''
    }

    <div class="totais">
      <div class="row"><span>Produtos</span><span>${formatMoney(os.valor_pecas)}</span></div>
      <div class="row"><span>Mão de obra</span><span>${formatMoney(os.valor_mao_obra)}</span></div>
      ${Number(os.desconto) > 0 ? `<div class="row"><span>Desconto</span><span>− ${formatMoney(os.desconto)}</span></div>` : ''}
      <div class="row tot"><span>Total</span><span>${formatMoney(totalValor(os))}</span></div>
      <div class="row" style="border:none;"><span>Pagamento</span><span>${formaPagamentoLabel(os)}</span></div>
    </div>

    ${os.termos_garantia ? `<h2>Termos de garantia</h2><div class="box">${escapeHtml(os.termos_garantia)}</div>` : ''}

    <div class="assinaturas">
      <div>Assinatura do cliente</div>
      <div>Responsável — Golden Motors</div>
    </div>

    <div class="foot">Golden Motors — Ordem de Serviço ${escapeHtml(os.numero)} · Emitida em ${formatDate(new Date().toISOString())}</div>
  </div>
  <script>window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 350); });</script>
</body>
</html>`;
}

module.exports = {
  ordensListPage,
  ordemFormPage,
  ordemShowPage,
  ordemPainelPage,
  ordemImprimirPage,
  CHECKLIST_ITEMS,
  STATUS_LABELS,
  totalValor,
  formaPagamentoLabel,
  FORMA_PAGAMENTO_LABELS,
};
