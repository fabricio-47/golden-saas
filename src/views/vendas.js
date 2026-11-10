'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatMoney, formatDate } = require('../utils');

const STATUS_LABELS = { aberta: 'Em aberto', concluida: 'Concluída' };

const FORMA_PAGAMENTO_LABELS = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  debito: 'Cartão de débito',
  credito: 'Cartão de crédito',
};

function formaPagamentoLabel(venda) {
  if (!venda.forma_pagamento) return '-';
  const base = FORMA_PAGAMENTO_LABELS[venda.forma_pagamento] || venda.forma_pagamento;
  if (venda.forma_pagamento === 'credito' && venda.parcelas && venda.parcelas > 1) {
    return `${base} (${venda.parcelas}x)`;
  }
  return base;
}

function vendaStatusBadge(venda) {
  return venda.status === 'concluida'
    ? '<span class="badge badge-concluida">Concluída</span>'
    : '<span class="badge badge-execucao">Em aberto</span>';
}

function vendasListPage({ user, flash, vendas, lojas, lojaFiltroId, mostrarColunaLoja }) {
  const rows = vendas
    .map(
      (v) => `
    <tr>
      <td><a class="link-btn" href="/vendas/${v.id}">${escapeHtml(v.numero)}</a></td>
      <td>${escapeHtml(v.cliente_nome)}</td>
      ${mostrarColunaLoja ? `<td>${v.loja_nome ? escapeHtml(v.loja_nome) : '<span class="muted">Geral</span>'}</td>` : ''}
      <td>${formatMoney(v.valor_total)}</td>
      <td>${formaPagamentoLabel(v)}</td>
      <td>${vendaStatusBadge(v)}</td>
      <td>${formatDate(v.created_at)}</td>
    </tr>`
    )
    .join('');

  const lojaFilterHtml =
    lojas && lojas.length > 1
      ? `<form method="GET" action="/vendas" class="actions-row" style="margin-top:0;margin-bottom:20px;">
          <select name="loja_id" onchange="this.form.submit()">
            <option value="">Todas as lojas que posso ver</option>
            ${lojas.map((l) => `<option value="${l.id}" ${String(lojaFiltroId) === String(l.id) ? 'selected' : ''}>${escapeHtml(l.nome)}</option>`).join('')}
          </select>
        </form>`
      : '';

  return layout({
    title: 'Venda Direto',
    activeNav: 'vendas',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Venda Direto</h1>
          <p class="subtitle">Vendas de produtos direto no balcão, sem precisar abrir uma Ordem de Serviço</p>
        </div>
        <a class="btn" href="/vendas/novo">+ Nova Venda</a>
      </div>
      ${lojaFilterHtml}
      <div class="card">
        ${
          vendas.length
            ? `<table>
          <thead><tr><th>Número</th><th>Cliente</th>${mostrarColunaLoja ? '<th>Loja</th>' : ''}<th>Valor</th><th>Pagamento</th><th>Status</th><th>Data</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
            : '<div class="empty">Nenhuma venda registrada ainda. <a class="link-btn" href="/vendas/novo">Registrar a primeira</a></div>'
        }
      </div>
    `,
  });
}

function vendaFormPage({ user, flash, clientes, lojas, lojaFixaNome, csrfToken, pecasDisponiveis = [] }) {
  const clienteOptions = clientes.map((c) => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
  const temMultiLoja = (lojas || []).length > 1;
  const produtosJson = JSON.stringify(
    (pecasDisponiveis || []).map((p) => ({
      id: p.id,
      nome: p.nome,
      preco: Number(p.preco_venda) || 0,
      estoque: p.quantidade,
      foto: p.foto_caminho ? '/uploads/' + p.foto_caminho : null,
    }))
  );
  const pecaOptionsNovo = (pecasDisponiveis || [])
    .map((p) => `<option value="${p.id}">${escapeHtml(p.nome)} (estoque: ${p.quantidade}) — R$ ${(Number(p.preco_venda) || 0).toFixed(2).replace('.', ',')}</option>`)
    .join('');

  const lojaFieldHtml = lojaFixaNome
    ? `<div class="field">
        <label>Loja</label>
        <input type="text" value="${escapeHtml(lojaFixaNome)}" disabled>
      </div>`
    : `<div class="field">
        <label for="loja_id">Loja</label>
        <select id="loja_id" name="loja_id">
          <option value="">Geral (não vinculada a uma loja específica)</option>
          ${lojas.map((l) => `<option value="${l.id}">${escapeHtml(l.nome)}</option>`).join('')}
        </select>
      </div>`;

  const semLojaAtivaHtml =
    !lojaFixaNome && lojas.length === 0
      ? `<div class="flash flash-error">Não há nenhuma loja ativa cadastrada, então o campo Loja só vai mostrar "Geral". <a class="link-btn" href="/lojas">Cadastre ou reative uma loja em Configurações → Lojas</a> antes de continuar.</div>`
      : '';

  return layout({
    title: 'Nova Venda',
    activeNav: 'vendas',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Nova Venda Direto</h1>
          <p class="subtitle">Escolha o cliente e adicione os produtos — tudo numa tela só</p>
        </div>
      </div>
      ${semLojaAtivaHtml}
      <div class="card">
        <form method="POST" action="/vendas">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field">
              <label for="cliente_id">Cliente *</label>
              <select id="cliente_id" name="cliente_id" required>
                <option value="">Selecione...</option>
                ${clienteOptions}
              </select>
            </div>
            ${lojaFieldHtml}
            <div class="field">
              <label for="forma_pagamento">Forma de pagamento</label>
              <select id="forma_pagamento" name="forma_pagamento" onchange="toggleParcelas()">
                <option value="">Não definida</option>
                <option value="pix">Pix</option>
                <option value="dinheiro">Dinheiro</option>
                <option value="debito">Cartão de débito</option>
                <option value="credito">Cartão de crédito</option>
              </select>
            </div>
            <div class="field" id="campo-parcelas">
              <label for="parcelas">Parcelado em quantas vezes</label>
              <input type="number" id="parcelas" name="parcelas" min="1" max="24" value="1">
            </div>
            <div class="field full">
              <label for="observacoes">Observações</label>
              <textarea id="observacoes" name="observacoes"></textarea>
            </div>
          </div>

          <h2 style="margin-top:20px;">Produtos da venda</h2>
          <div class="form-grid">
            <div class="field" style="grid-column: span 2;">
              <label for="nv_produto">Produto do estoque</label>
              <select id="nv_produto">
                <option value="">Selecione...</option>
                ${pecaOptionsNovo}
              </select>
            </div>
            <div class="field">
              <label for="nv_qtd">Quantidade</label>
              <input type="number" id="nv_qtd" min="1" step="1" value="1">
            </div>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" onclick="nvAddEstoque()">+ Adicionar produto</button>

          <div class="form-grid" style="margin-top:16px;">
            <div class="field" style="grid-column: span 2;">
              <label for="nv_desc">Item avulso (fora do estoque)</label>
              <input type="text" id="nv_desc" placeholder="Ex.: Serviço de instalação">
            </div>
            <div class="field">
              <label for="nv_preco">Preço unit. (R$)</label>
              <input type="number" id="nv_preco" min="0" step="0.01" placeholder="0,00">
            </div>
            <div class="field">
              <label for="nv_qtd2">Quantidade</label>
              <input type="number" id="nv_qtd2" min="1" step="1" value="1">
            </div>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" onclick="nvAddManual()">+ Adicionar item avulso</button>

          <table style="margin-top:16px;">
            <thead><tr><th>Item</th><th style="text-align:center;">Qtd.</th><th style="text-align:right;">Preço unit.</th><th style="text-align:right;">Subtotal</th><th></th></tr></thead>
            <tbody id="nv_corpo">
              <tr id="nv_vazio"><td colspan="5" class="muted" style="padding:14px 0;">Nenhum produto ainda. Adicione acima.</td></tr>
            </tbody>
          </table>
          <div style="display:flex;justify-content:flex-end;margin-top:8px;">
            <div style="font-size:18px;font-weight:700;">Total: <span id="nv_total" style="color:#1f6b3a;">R$ 0,00</span></div>
          </div>

          <input type="hidden" name="itens_json" id="nv_itens_json" value="[]">

          <div class="actions-row">
            <button class="btn" type="submit">Salvar venda</button>
            <a class="btn btn-secondary" href="/vendas">Cancelar</a>
          </div>
        </form>
      </div>
      <script>
        function toggleParcelas() {
          var forma = document.getElementById('forma_pagamento').value;
          document.getElementById('campo-parcelas').style.display = forma === 'credito' ? '' : 'none';
        }
        toggleParcelas();

        var NV_PRODUTOS = ${produtosJson};
        var nvItens = [];
        function nvMoney(v) { return 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ','); }
        function nvEsc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
        function nvAddEstoque() {
          var sel = document.getElementById('nv_produto');
          var id = sel.value;
          if (!id) { alert('Selecione um produto.'); return; }
          var qtd = parseInt(document.getElementById('nv_qtd').value, 10) || 1;
          var prod = NV_PRODUTOS.find(function (p) { return String(p.id) === String(id); });
          if (!prod) return;
          nvItens.push({ peca_id: prod.id, nome: prod.nome, preco: prod.preco, qtd: qtd, foto: prod.foto || null });
          sel.value = ''; document.getElementById('nv_qtd').value = 1;
          nvRender();
        }
        function nvAddManual() {
          var desc = document.getElementById('nv_desc').value.trim();
          var preco = parseFloat(document.getElementById('nv_preco').value);
          var qtd = parseInt(document.getElementById('nv_qtd2').value, 10) || 1;
          if (!desc) { alert('Digite a descrição do item avulso.'); return; }
          if (isNaN(preco) || preco < 0) { alert('Digite um preço válido.'); return; }
          nvItens.push({ peca_id: null, nome: desc, preco: preco, qtd: qtd, foto: null });
          document.getElementById('nv_desc').value = ''; document.getElementById('nv_preco').value = ''; document.getElementById('nv_qtd2').value = 1;
          nvRender();
        }
        function nvRemover(i) { nvItens.splice(i, 1); nvRender(); }
        function nvRender() {
          var corpo = document.getElementById('nv_corpo');
          if (nvItens.length === 0) {
            corpo.innerHTML = '<tr id="nv_vazio"><td colspan="5" class="muted" style="padding:14px 0;">Nenhum produto ainda. Adicione acima.</td></tr>';
          } else {
            corpo.innerHTML = nvItens.map(function (it, i) {
              var sub = it.preco * it.qtd;
              var thumb = it.foto ? '<img src="' + it.foto + '" alt="" style="width:30px;height:30px;object-fit:cover;border-radius:5px;border:1px solid var(--border);vertical-align:middle;margin-right:8px;">' : '';
              return '<tr><td>' + thumb + nvEsc(it.nome) + '</td>' +
                '<td style="text-align:center;">' + it.qtd + '</td>' +
                '<td style="text-align:right;">' + nvMoney(it.preco) + '</td>' +
                '<td style="text-align:right;font-weight:600;">' + nvMoney(sub) + '</td>' +
                '<td style="text-align:right;"><button type="button" class="btn btn-sm btn-danger" onclick="nvRemover(' + i + ')">Remover</button></td></tr>';
            }).join('');
          }
          var total = nvItens.reduce(function (s, it) { return s + it.preco * it.qtd; }, 0);
          document.getElementById('nv_total').textContent = nvMoney(total);
          document.getElementById('nv_itens_json').value = JSON.stringify(nvItens.map(function (it) {
            return { peca_id: it.peca_id, nome: it.nome, preco: it.preco, qtd: it.qtd };
          }));
        }
      </script>
    `,
  });
}

function vendaItensSection(venda, itens, pecasDisponiveis, servicosDisponiveis, csrfToken) {
  const rows = itens
    .map((item) => {
      const subtotal = item.quantidade * item.preco_unitario;
      return `
    <tr>
      <td>${escapeHtml(item.nome_peca)}${item.bicicleta_id ? ` <a class="link-btn" href="/bicicletas/${item.bicicleta_id}">(ver cadastro do veículo)</a>` : ''}${item.tipo_servico_id ? ' <span class="muted">(serviço)</span>' : ''}</td>
      <td>${item.quantidade}</td>
      <td>${formatMoney(item.preco_unitario)}</td>
      <td>${formatMoney(subtotal)}</td>
      <td>
        ${
          venda.status === 'aberta'
            ? `<form method="POST" action="/vendas/${venda.id}/itens/${item.id}/excluir" onsubmit="return confirm('Remover este item da venda?${item.peca_id ? ' A quantidade volta pro estoque.' : ''}');">
          <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
          <button class="btn btn-sm btn-danger" type="submit">Remover</button>
        </form>`
            : ''
        }
      </td>
    </tr>`;
    })
    .join('');

  const pecaOptions = pecasDisponiveis
    .map((p) => `<option value="${p.id}">${escapeHtml(p.nome)} (estoque: ${p.quantidade}) — ${formatMoney(p.preco_venda)}</option>`)
    .join('');

  const servicoOptions = servicosDisponiveis
    .map((s) => `<option value="servico:${s.id}">${escapeHtml(s.nome)} — ${formatMoney(s.valor)}</option>`)
    .join('');

  const addItemFormHtml =
    venda.status === 'aberta'
      ? `<form method="POST" action="/vendas/${venda.id}/itens" enctype="multipart/form-data" style="margin-top:16px;">
          <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
          <div class="form-grid">
            <div class="field">
              <label for="produto_id">Produto / serviço</label>
              <select id="produto_id" name="produto_id" onchange="toggleProduto()">
                <option value="">Selecione...</option>
                ${pecaOptions}
                ${servicoOptions ? `<optgroup label="Tipos de serviço">${servicoOptions}</optgroup>` : ''}
                <option value="veiculo">🏍️ Cadastrar veículo (moto/bike elétrica)</option>
              </select>
              ${
                !pecasDisponiveis.length && !servicosDisponiveis.length
                  ? '<p class="muted">Nenhum produto no estoque nem tipo de serviço cadastrado ainda — mas dá pra vender um veículo direto.</p>'
                  : ''
              }
              ${
                !servicosDisponiveis.length && pecasDisponiveis.length
                  ? '<p class="muted">Nenhum tipo de serviço cadastrado ainda. <a class="link-btn" href="/servicos/novo">Cadastre em Tipos de Serviço</a> pra poder vender serviços por aqui.</p>'
                  : ''
              }
            </div>
            <div class="field" id="campo-quantidade">
              <label for="item_quantidade">Quantidade</label>
              <input type="number" id="item_quantidade" name="quantidade" min="1" step="1" value="1">
            </div>
          </div>

          <div id="campo-veiculo" style="display:none;">
            <div class="form-grid">
              <div class="field">
                <label for="tipo_veiculo">Tipo de veículo</label>
                <select id="tipo_veiculo" name="tipo_veiculo">
                  <option value="bicicleta">Scooter elétrica</option>
                  <option value="moto">Moto elétrica</option>
                </select>
              </div>
              <div class="field">
                <label for="veiculo_marca">Marca</label>
                <input type="text" id="veiculo_marca" name="veiculo_marca">
              </div>
              <div class="field">
                <label for="veiculo_modelo">Modelo</label>
                <input type="text" id="veiculo_modelo" name="veiculo_modelo">
              </div>
              <div class="field">
                <label for="veiculo_preco_venda">Preço de venda (R$)</label>
                <input type="number" id="veiculo_preco_venda" name="veiculo_preco_venda" min="0" step="0.01">
              </div>
              <div class="field">
                <label for="veiculo_chassi_numero">Número do chassi</label>
                <input type="text" id="veiculo_chassi_numero" name="veiculo_chassi_numero">
              </div>
              <div class="field">
                <label for="veiculo_bateria_serial">Número de série da bateria</label>
                <input type="text" id="veiculo_bateria_serial" name="veiculo_bateria_serial">
              </div>
              <div class="field">
                <label for="veiculo_foto_chassi">Foto do chassi (opcional)</label>
                <input type="file" id="veiculo_foto_chassi" name="veiculo_foto_chassi" accept="image/*" capture="environment">
              </div>
              <div class="field">
                <label for="veiculo_foto_bateria">Foto da bateria (opcional)</label>
                <input type="file" id="veiculo_foto_bateria" name="veiculo_foto_bateria" accept="image/*" capture="environment">
              </div>
            </div>
            <p class="muted">O veículo já fica cadastrado no módulo Veículos, vinculado a este cliente.</p>
          </div>

          <button class="btn btn-sm" type="submit" style="margin-top:12px;">+ Adicionar item</button>
        </form>
        <script>
          function toggleProduto() {
            var isVeiculo = document.getElementById('produto_id').value === 'veiculo';
            document.getElementById('campo-quantidade').style.display = isVeiculo ? 'none' : '';
            document.getElementById('campo-veiculo').style.display = isVeiculo ? '' : 'none';
          }
          toggleProduto();
        </script>`
      : '';

  return `
      <div class="card">
        <h2>Itens da venda</h2>
        ${
          itens.length
            ? `<table><thead><tr><th>Item</th><th>Qtd.</th><th>Preço unit.</th><th>Subtotal</th><th></th></tr></thead><tbody>${rows}</tbody></table>
               <p style="margin-top:12px;"><strong>Total: ${formatMoney(venda.valor_total)}</strong></p>`
            : '<p class="muted">Nenhum item adicionado ainda.</p>'
        }
        ${addItemFormHtml}
      </div>`;
}

function vendaShowPage({ user, flash, venda, itens, pecasDisponiveis, servicosDisponiveis, csrfToken, configFiscal }) {
  return layout({
    title: venda.numero,
    activeNav: 'vendas',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>${escapeHtml(venda.numero)} ${vendaStatusBadge(venda)}</h1>
          <p class="subtitle">
            Cliente: <a class="link-btn" href="/clientes/${venda.cliente_id}">${escapeHtml(venda.cliente_nome)}</a>
            &nbsp;·&nbsp; Loja: ${venda.loja_nome ? escapeHtml(venda.loja_nome) : '<span class="muted">Geral</span>'}
            &nbsp;·&nbsp; Pagamento: ${formaPagamentoLabel(venda)}
          </p>
        </div>
        <div class="actions-row" style="margin-top:0;">
          ${
            venda.status === 'aberta' && itens.length
              ? `<form method="POST" action="/vendas/${venda.id}/finalizar" onsubmit="return confirm('Finalizar esta venda? Depois de finalizada não é mais possível adicionar ou remover itens.');">
            <input type="hidden" name="csrf" value="${csrfToken}">
            <button class="btn" type="submit">✔ Finalizar venda</button>
          </form>`
              : ''
          }
        </div>
      </div>

      ${venda.status === 'concluida' ? `<div class="flash flash-success">Venda finalizada em ${formatDate(venda.finalizada_at)}.</div>` : ''}

      <div class="stat-grid">
        <div class="stat-card"><div class="num">${formatMoney(venda.valor_total)}</div><div class="label">Valor total da venda</div></div>
        <div class="stat-card"><div class="num">${itens.length}</div><div class="label">Itens vendidos</div></div>
        <div class="stat-card"><div class="num">${formatDate(venda.created_at).split(' ')[0]}</div><div class="label">Data da venda</div></div>
      </div>

      ${vendaItensSection(venda, itens, pecasDisponiveis, servicosDisponiveis || [], csrfToken)}

      ${nfeVendaSection(venda, configFiscal || {}, csrfToken)}

      ${
        venda.observacoes
          ? `<div class="card"><h2>Observações</h2><p>${escapeHtml(venda.observacoes).replace(/\n/g, '<br>')}</p></div>`
          : ''
      }
    `,
  });
}

const NFE_STATUS_INFO = {
  autorizado: { label: 'Autorizada', cls: 'badge-ok' },
  cancelado: { label: 'Cancelada', cls: 'badge-desativada' },
  processando_autorizacao: { label: 'Processando na SEFAZ', cls: 'badge-orcamento' },
  processando: { label: 'Processando na SEFAZ', cls: 'badge-orcamento' },
  erro_autorizacao: { label: 'Recusada pela SEFAZ', cls: 'badge-desativada' },
  denegado: { label: 'Denegada', cls: 'badge-desativada' },
  erro: { label: 'Erro na emissão', cls: 'badge-desativada' },
};

function nfeVendaSection(venda, config, csrfToken) {
  const ambiente = config.ambiente === 'producao' ? 'producao' : 'homologacao';
  const temToken = ambiente === 'producao' ? !!config.focus_token_producao : !!config.focus_token_homologacao;
  const ambienteBadge = ambiente === 'producao'
    ? '<span class="badge badge-ok">Produção</span>'
    : '<span class="badge badge-orcamento">Homologação (teste)</span>';

  const status = venda.nfe_status;
  const info = status ? NFE_STATUS_INFO[status] || { label: status, cls: 'badge-orcamento' } : null;

  // Cabeçalho da seção
  let corpo = '';

  if (!temToken) {
    corpo = `<p class="muted">A emissão de NF-e ainda não está configurada. Vá em <a class="link-btn" href="/configuracoes/fiscal">Configurações → Fiscal</a> e informe o token da Focus NFe para o ambiente <strong>${ambiente}</strong>.</p>`;
  } else if (!status || status === 'erro' || status === 'erro_autorizacao' || status === 'denegado') {
    const erroMsg = status && venda.nfe_mensagem
      ? `<div class="flash flash-error" style="margin-bottom:12px;">Última tentativa: ${escapeHtml(venda.nfe_mensagem)}</div>`
      : '';
    corpo = `
      ${erroMsg}
      <p class="muted">Emitir a NF-e desta venda no ambiente de ${ambienteBadge}. Só entram os itens de mercadoria (peças e veículos); serviços não entram na NF-e.</p>
      <form method="POST" action="/vendas/${venda.id}/nfe/emitir" onsubmit="return confirm('Emitir NF-e desta venda no ambiente ${ambiente}?');">
        <input type="hidden" name="csrf" value="${csrfToken}">
        <button class="btn" type="submit">📄 ${status ? 'Tentar emitir de novo' : 'Emitir NF-e'}</button>
      </form>`;
  } else if (status === 'processando' || status === 'processando_autorizacao') {
    corpo = `
      <p>A nota foi enviada e está sendo processada pela SEFAZ. Consulte o status em alguns segundos.</p>
      <form method="POST" action="/vendas/${venda.id}/nfe/consultar">
        <input type="hidden" name="csrf" value="${csrfToken}">
        <button class="btn btn-secondary" type="submit">🔄 Consultar status</button>
      </form>`;
  } else if (status === 'autorizado') {
    const linhas = [];
    if (venda.nfe_numero) linhas.push(`<strong>Número:</strong> ${escapeHtml(venda.nfe_numero)}${venda.nfe_serie ? ' / série ' + escapeHtml(venda.nfe_serie) : ''}`);
    if (venda.nfe_chave) linhas.push(`<strong>Chave:</strong> <span style="font-family:monospace;font-size:12px;">${escapeHtml(venda.nfe_chave)}</span>`);
    const botoes = [];
    if (venda.nfe_danfe_url) botoes.push(`<a class="btn btn-secondary" href="/vendas/${venda.id}/nfe/danfe" target="_blank" rel="noopener">🖨 DANFE (PDF)</a>`);
    if (venda.nfe_xml_url) botoes.push(`<a class="btn btn-secondary" href="/vendas/${venda.id}/nfe/xml" target="_blank" rel="noopener">⬇ XML</a>`);
    corpo = `
      <div style="margin-bottom:12px;">${linhas.join('<br>')}</div>
      <div class="actions-row" style="margin-top:0;">${botoes.join('')}</div>
      <details style="margin-top:16px;">
        <summary class="muted" style="cursor:pointer;">Cancelar esta NF-e</summary>
        <form method="POST" action="/vendas/${venda.id}/nfe/cancelar" onsubmit="return confirm('Cancelar a NF-e autorizada? Isso é definitivo.');" style="margin-top:10px;">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="field full">
            <label for="justificativa">Justificativa (mín. 15 caracteres)</label>
            <input type="text" id="justificativa" name="justificativa" minlength="15" required placeholder="Ex.: Venda cancelada a pedido do cliente.">
          </div>
          <button class="btn btn-danger btn-sm" type="submit" style="margin-top:8px;">Cancelar NF-e</button>
        </form>
      </details>`;
  }

  return `
    <div class="card">
      <h2 style="display:flex;align-items:center;gap:10px;">Nota Fiscal (NF-e) ${info ? `<span class="badge ${info.cls}">${info.label}</span>` : ''} ${temToken ? ambienteBadge : ''}</h2>
      ${corpo}
    </div>`;
}

module.exports = {
  vendasListPage,
  vendaFormPage,
  vendaShowPage,
  STATUS_LABELS,
  FORMA_PAGAMENTO_LABELS,
  formaPagamentoLabel,
};
