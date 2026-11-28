'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatMoney, formatDate } = require('../utils');

const STATUS_LABELS = { aberta: 'Aguardando pagamento', concluida: 'Pago', cancelada: 'Cancelada' };

const FORMA_PAGAMENTO_LABELS = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  debito: 'Cartão de débito',
  credito: 'Cartão de crédito',
  misto: 'Misto (várias formas)',
};

function formaPagamentoLabel(venda) {
  if (!venda.forma_pagamento) return '-';
  const base = FORMA_PAGAMENTO_LABELS[venda.forma_pagamento] || venda.forma_pagamento;
  if (venda.forma_pagamento === 'credito' && venda.parcelas && venda.parcelas > 1) {
    return `${base} (${venda.parcelas}x)`;
  }
  return base;
}

function pagamentosVendaSection(pagamentos) {
  if (!pagamentos || pagamentos.length <= 1) return '';
  const linhas = pagamentos
    .map((p) => {
      let label = FORMA_PAGAMENTO_LABELS[p.forma] || p.forma;
      if (p.forma === 'credito' && p.parcelas && p.parcelas > 1) label += ` (${p.parcelas}x)`;
      return `<tr><td>${escapeHtml(label)}</td><td style="text-align:right;">${formatMoney(p.valor)}</td></tr>`;
    })
    .join('');
  const soma = pagamentos.reduce((s, p) => s + (Number(p.valor) || 0), 0);
  return `
    <div class="card">
      <h2>Formas de pagamento</h2>
      <table>
        <thead><tr><th>Forma</th><th style="text-align:right;">Valor</th></tr></thead>
        <tbody>${linhas}</tbody>
        <tfoot><tr><td style="font-weight:700;">Total pago</td><td style="text-align:right;font-weight:700;">${formatMoney(soma)}</td></tr></tfoot>
      </table>
    </div>`;
}

function vendaStatusBadge(venda) {
  if (venda.status === 'concluida') return '<span class="badge badge-concluida">Pago</span>';
  if (venda.status === 'cancelada') return '<span class="badge badge-desativada">Cancelada</span>';
  return '<span class="badge badge-execucao">Aguardando pagamento</span>';
}

function vendasListPage({ user, flash, vendas, lojas, lojaFiltroId, mostrarColunaLoja, statusFiltro = '', contagem = {}, somaStatus = {}, vendedores = [], vendedorFiltroId = '', q = '', deFiltro = '', ateFiltro = '' }) {
  const mostrarColunaVendedor = (vendedores && vendedores.length > 0);
  const rows = vendas
    .map(
      (v) => `
    <tr>
      <td><a class="link-btn" href="/vendas/${v.id}">${escapeHtml(v.numero)}</a></td>
      <td>${escapeHtml(v.cliente_nome)}</td>
      ${mostrarColunaLoja ? `<td>${v.loja_nome ? escapeHtml(v.loja_nome) : '<span class="muted">Geral</span>'}</td>` : ''}
      ${mostrarColunaVendedor ? `<td>${v.vendedor_nome ? escapeHtml(v.vendedor_nome) : '<span class="muted">—</span>'}</td>` : ''}
      <td>${formatMoney(v.valor_total)}</td>
      <td>${formaPagamentoLabel(v)}</td>
      <td>${vendaStatusBadge(v)}</td>
      <td>${formatDate(v.created_at)}</td>
    </tr>`
    )
    .join('');

  // Barra de filtros: busca (cliente/número/vendedor) + loja + vendedor. Mantém o status.
  const filtroBarHtml = `
    <form method="GET" action="/vendas" class="actions-row" style="margin-top:0;margin-bottom:16px;gap:8px;flex-wrap:wrap;">
      <input type="hidden" name="status" value="${escapeHtml(statusFiltro)}">
      <input type="text" name="q" value="${escapeHtml(q)}" placeholder="Buscar cliente, número ou vendedor..." style="min-width:240px;flex:1;">
      ${
        lojas && lojas.length > 1
          ? `<select name="loja_id" onchange="this.form.submit()">
               <option value="">Todas as lojas</option>
               ${lojas.map((l) => `<option value="${l.id}" ${String(lojaFiltroId) === String(l.id) ? 'selected' : ''}>${escapeHtml(l.nome)}</option>`).join('')}
             </select>`
          : ''
      }
      ${
        vendedores && vendedores.length
          ? `<select name="vendedor_id" onchange="this.form.submit()">
               <option value="">Todos os vendedores</option>
               ${vendedores.map((vd) => `<option value="${vd.id}" ${String(vendedorFiltroId) === String(vd.id) ? 'selected' : ''}>${escapeHtml(vd.name)}</option>`).join('')}
             </select>`
          : ''
      }
      <label style="display:flex;align-items:center;gap:4px;font-size:13px;" class="muted">de <input type="date" name="de" value="${escapeHtml(deFiltro)}" onchange="this.form.submit()" style="width:auto;"></label>
      <label style="display:flex;align-items:center;gap:4px;font-size:13px;" class="muted">até <input type="date" name="ate" value="${escapeHtml(ateFiltro)}" onchange="this.form.submit()" style="width:auto;"></label>
      <button class="btn btn-sm" type="submit">Buscar</button>
      ${q || vendedorFiltroId || lojaFiltroId || deFiltro || ateFiltro ? '<a class="btn btn-sm btn-secondary" href="/vendas">Limpar</a>' : ''}
    </form>`;

  // Dashboard de status: cards clicáveis que filtram a lista. Mantém loja/vendedor/busca/período.
  const extra = [
    lojaFiltroId ? 'loja_id=' + encodeURIComponent(lojaFiltroId) : '',
    vendedorFiltroId ? 'vendedor_id=' + encodeURIComponent(vendedorFiltroId) : '',
    q ? 'q=' + encodeURIComponent(q) : '',
    deFiltro ? 'de=' + encodeURIComponent(deFiltro) : '',
    ateFiltro ? 'ate=' + encodeURIComponent(ateFiltro) : '',
  ].filter(Boolean).join('&');
  const totalCount = (contagem.aberta || 0) + (contagem.concluida || 0) + (contagem.cancelada || 0);
  const totalSoma = (somaStatus.aberta || 0) + (somaStatus.concluida || 0) + (somaStatus.cancelada || 0);
  const card = (st, label, cor, count, valor) => {
    const ativo = String(statusFiltro) === st;
    const href = st ? `/vendas?status=${st}${extra ? '&' + extra : ''}` : `/vendas${extra ? '?' + extra : ''}`;
    return `<a class="stat-card" href="${href}" style="text-decoration:none;color:inherit;${ativo ? 'outline:2px solid ' + cor + ';outline-offset:-2px;' : ''}">
      <div class="num" style="${cor ? 'color:' + cor + ';' : ''}">${count}</div>
      <div class="label">${label}</div>
      <div class="label" style="font-size:12px;opacity:.8;">${formatMoney(valor)}</div>
    </a>`;
  };
  const statusCardsHtml = `
    <div class="stat-grid" style="margin-bottom:16px;">
      ${card('', 'Todas', '', totalCount, totalSoma)}
      ${card('aberta', 'Aguardando pagamento', '#8a6d00', contagem.aberta || 0, somaStatus.aberta || 0)}
      ${card('concluida', 'Pago', '#1b7a43', contagem.concluida || 0, somaStatus.concluida || 0)}
      ${card('cancelada', 'Cancelada', '#a1352a', contagem.cancelada || 0, somaStatus.cancelada || 0)}
    </div>`;

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
      ${statusCardsHtml}
      ${filtroBarHtml}
      <div class="card">
        ${
          vendas.length
            ? `<table>
          <thead><tr><th>Número</th><th>Cliente</th>${mostrarColunaLoja ? '<th>Loja</th>' : ''}${mostrarColunaVendedor ? '<th>Vendedor</th>' : ''}<th>Valor</th><th>Pagamento</th><th>Status</th><th>Data</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
            : `<div class="empty">${q || vendedorFiltroId ? 'Nenhuma venda encontrada com esse filtro. <a class="link-btn" href="/vendas">Limpar filtros</a>' : 'Nenhuma venda registrada ainda. <a class="link-btn" href="/vendas/novo">Registrar a primeira</a>'}</div>`
        }
      </div>
    `,
  });
}

function vendaFormPage({ user, flash, clientes, lojas, lojaFixaNome, csrfToken, pecasDisponiveis = [], senhaCaixaConfig = false }) {
  const clienteOptions = clientes.map((c) => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
  const temMultiLoja = (lojas || []).length > 1;
  const produtosJson = JSON.stringify(
    (pecasDisponiveis || []).map((p) => ({
      id: p.id,
      nome: p.nome,
      preco: Number(p.preco_venda) || 0,
      estoque: p.quantidade,
      foto: p.foto_caminho ? '/uploads/' + p.foto_caminho : null,
      codigo: p.codigo_barras || null,
      cores: (p.cores || []).map((c) => ({ cor: c.cor, qtd: c.quantidade })),
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
        <form method="POST" action="/vendas" enctype="multipart/form-data">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field">
              <label for="nv_cliente_busca">Cliente *</label>
              <input type="text" id="nv_cliente_busca" list="nv_clientes_dl" placeholder="Digite o nome do cliente..." autocomplete="off" oninput="nvResolveCliente()">
              <datalist id="nv_clientes_dl">
                ${clientes.map((c) => `<option value="${escapeHtml(c.nome)}"></option>`).join('')}
              </datalist>
              <input type="hidden" name="cliente_id" id="cliente_id">
              <a class="link-btn" href="/clientes/novo" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;">+ Cadastrar novo cliente (abre em nova aba)</a>
              <p class="muted" id="nv_cliente_msg" style="margin:4px 0 0;min-height:14px;"></p>
            </div>
            ${lojaFieldHtml}
          </div>

          <h2 style="margin-top:20px;">Produtos da venda</h2>
          <div class="field full" style="background:rgba(201,162,39,0.08);padding:12px;border-radius:8px;border:1px solid var(--border);">
            <label for="nv_barcode">📷 Código de barras (bipe o leitor ou digite e aperte Enter)</label>
            <input type="text" id="nv_barcode" placeholder="Bipe o produto aqui..." autocomplete="off" onkeydown="nvBarcodeKey(event)">
            <p class="muted" id="nv_barcode_msg" style="margin-top:4px;min-height:16px;"></p>
          </div>
          <div class="form-grid">
            <div class="field" style="grid-column: span 2;">
              <label for="nv_produto">Produto do estoque (ou escolha na lista)</label>
              <select id="nv_produto" onchange="nvProdChange()">
                <option value="">Selecione...</option>
                ${pecaOptionsNovo}
              </select>
            </div>
            <div class="field">
              <label for="nv_qtd">Quantidade</label>
              <input type="number" id="nv_qtd" min="1" step="1" value="1">
            </div>
            <div class="field" id="nv_cor_campo" style="display:none;grid-column: span 2;">
              <label for="nv_cor">Cor (baixa do estoque desta cor) *</label>
              <select id="nv_cor"></select>
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
            <div style="min-width:300px;">
              <div style="display:flex;justify-content:space-between;padding:4px 0;"><span class="muted">Subtotal dos produtos</span><strong id="nv_subtotal">R$ 0,00</strong></div>
              <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;gap:12px;"><span class="muted">Desconto (R$)</span><input type="number" name="desconto" id="nv_desconto" min="0" step="0.01" value="" placeholder="0,00" style="width:130px;text-align:right;" oninput="nvRecalc()"></div>
              <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid var(--border);"><span style="font-size:18px;font-weight:700;">Total</span><span id="nv_total" style="font-size:18px;font-weight:700;color:#1f6b3a;">R$ 0,00</span></div>
            </div>
          </div>

          <input type="hidden" name="itens_json" id="nv_itens_json" value="[]">

          <h2 style="margin-top:20px;">Pagamento</h2>
          <p class="muted" style="margin-top:-6px;">Pode lançar <strong>mais de uma forma</strong> (ex.: parte no dinheiro, parte no cartão). Opcional.</p>
          <div class="form-grid">
            <div class="field">
              <label for="pg_forma">Forma</label>
              <select id="pg_forma" onchange="pgToggleParcelas()">
                <option value="dinheiro">Dinheiro</option>
                <option value="pix">Pix</option>
                <option value="debito">Cartão de débito</option>
                <option value="credito">Cartão de crédito</option>
              </select>
            </div>
            <div class="field">
              <label for="pg_valor">Valor (R$)</label>
              <input type="number" id="pg_valor" min="0" step="0.01" placeholder="0,00">
            </div>
            <div class="field" id="pg_campo_parcelas" style="display:none;">
              <label for="pg_parcelas">Parcelas (crédito)</label>
              <input type="number" id="pg_parcelas" min="1" max="24" value="1">
            </div>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" onclick="pgAdd()">+ Adicionar pagamento</button>
          <p class="muted" id="pg_resto" style="margin-top:8px;"></p>
          <table style="margin-top:4px;">
            <thead><tr><th>Forma</th><th style="text-align:right;">Valor</th><th></th></tr></thead>
            <tbody id="pg_corpo"><tr id="pg_vazio"><td colspan="3" class="muted" style="padding:10px 0;">Nenhum pagamento lançado.</td></tr></tbody>
          </table>
          <input type="hidden" name="pagamentos_json" id="pg_json" value="[]">

          <div class="card" style="margin-top:16px;background:#f7faf8;border:1px dashed #b9c6bf;">
            <h2 style="margin-top:0;">Receber agora <span class="muted" style="font-weight:normal;">(opcional)</span></h2>
            <p class="muted" style="margin-top:-6px;">Clique em <strong>"Criar e receber"</strong> pra já dar baixa no pagamento sem precisar abrir a venda depois. Se o pagamento for pix ou cartão, anexe o comprovante aqui.</p>
            <div class="form-grid">
              ${senhaCaixaConfig ? `<div class="field">
                <label for="nv_senha_caixa">Senha do caixa</label>
                <input type="password" name="senha_caixa" id="nv_senha_caixa" autocomplete="off" placeholder="Só pra receber agora">
              </div>` : ''}
              <div class="field">
                <label for="nv_comprovante">Comprovante (pix/cartão)</label>
                <input type="file" name="comprovante" id="nv_comprovante" accept="image/*,application/pdf">
                <small class="muted">Obrigatório só quando houver pagamento digital.</small>
              </div>
            </div>
          </div>

          <div class="actions-row">
            <button class="btn" type="submit" name="receber_agora" value="1" onclick="return confirm('Confirmar o recebimento do pagamento desta venda agora? Isso dá baixa na venda.');">✔ Criar e receber</button>
            <button class="btn btn-secondary" type="submit">Só criar (recebo depois)</button>
            <a class="btn btn-secondary" href="/vendas">Cancelar</a>
          </div>
        </form>
      </div>
      <script>
        var NV_PRODUTOS = ${produtosJson};
        var nvItens = [];
        function nvMoney(v) { return 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ','); }
        function nvEsc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

        // ---- Cliente: campo único com busca por nome (datalist) ----
        var NV_CLIENTES = ${JSON.stringify((clientes || []).map((c) => ({ id: c.id, nome: c.nome })))};
        function nvResolveCliente() {
          var nome = (document.getElementById('nv_cliente_busca').value || '').trim().toLowerCase();
          var hid = document.getElementById('cliente_id');
          var msg = document.getElementById('nv_cliente_msg');
          var achou = NV_CLIENTES.find(function (c) { return String(c.nome).toLowerCase() === nome; });
          hid.value = achou ? achou.id : '';
          if (!nome) { msg.textContent = ''; }
          else if (achou) { msg.innerHTML = '<span style="color:#1f6b3a;">Cliente selecionado.</span>'; }
          else { msg.innerHTML = '<span style="color:#a1352a;">Nome não está na lista — escolha uma sugestão ou cadastre o cliente.</span>'; }
        }
        // Ao voltar da aba de cadastro, recarrega a lista pra achar o cliente novo.
        window.addEventListener('focus', function () {
          fetch('/vendas/clientes-json').then(function (r) { return r.json(); }).then(function (lista) {
            if (!Array.isArray(lista)) return;
            NV_CLIENTES = lista;
            var dl = document.getElementById('nv_clientes_dl');
            dl.innerHTML = lista.map(function (c) { return '<option value="' + nvEsc(c.nome) + '"></option>'; }).join('');
            nvResolveCliente();
          }).catch(function () {});
        });
        document.querySelector('form[action="/vendas"]').addEventListener('submit', function (e) {
          if (!document.getElementById('cliente_id').value) {
            e.preventDefault();
            alert('Escolha um cliente da lista (ou cadastre um na aba que abre e volte aqui).');
            document.getElementById('nv_cliente_busca').focus();
          }
        });
        function nvProdChange() {
          var id = document.getElementById('nv_produto').value;
          var prod = id ? NV_PRODUTOS.find(function (p) { return String(p.id) === String(id); }) : null;
          var campo = document.getElementById('nv_cor_campo');
          var selCor = document.getElementById('nv_cor');
          if (prod && prod.cores && prod.cores.length) {
            selCor.innerHTML = prod.cores.map(function (c) {
              return '<option value="' + nvEsc(c.cor) + '">' + nvEsc(c.cor) + ' (estoque: ' + c.qtd + ')</option>';
            }).join('');
            campo.style.display = '';
          } else {
            selCor.innerHTML = ''; campo.style.display = 'none';
          }
        }
        function nvAddEstoque() {
          var sel = document.getElementById('nv_produto');
          var id = sel.value;
          if (!id) { alert('Selecione um produto.'); return; }
          var qtd = parseInt(document.getElementById('nv_qtd').value, 10) || 1;
          var prod = NV_PRODUTOS.find(function (p) { return String(p.id) === String(id); });
          if (!prod) return;
          var cor = null;
          if (prod.cores && prod.cores.length) {
            cor = document.getElementById('nv_cor').value;
            if (!cor) { alert('Escolha a cor que está saindo.'); return; }
          }
          nvItens.push({ peca_id: prod.id, nome: prod.nome + (cor ? ' (' + cor + ')' : ''), preco: prod.preco, qtd: qtd, foto: prod.foto || null, cor: cor });
          sel.value = ''; document.getElementById('nv_qtd').value = 1; nvProdChange();
          nvRender();
        }
        function nvBarcodeKey(e) {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          var inp = document.getElementById('nv_barcode');
          var cod = (inp.value || '').trim();
          var msg = document.getElementById('nv_barcode_msg');
          if (!cod) return;
          var prod = NV_PRODUTOS.find(function (p) { return p.codigo && String(p.codigo) === cod; });
          if (!prod) {
            msg.innerHTML = '<span style="color:#a1352a;">Nenhum produto com o código ' + cod + '.</span>';
            inp.select();
            return;
          }
          if (prod.cores && prod.cores.length) {
            msg.innerHTML = '<span style="color:#a1352a;">' + nvEsc(prod.nome) + ' tem cores — escolha pela lista acima pra dizer qual cor está saindo.</span>';
            inp.select();
            return;
          }
          // se já está na lista, soma 1; senão adiciona
          var existente = nvItens.find(function (it) { return it.peca_id === prod.id; });
          if (existente) existente.qtd += 1;
          else nvItens.push({ peca_id: prod.id, nome: prod.nome, preco: prod.preco, qtd: 1, foto: prod.foto || null });
          msg.innerHTML = '<span style="color:#1f6b3a;">+ ' + prod.nome + '</span>';
          inp.value = '';
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
          document.getElementById('nv_itens_json').value = JSON.stringify(nvItens.map(function (it) {
            return { peca_id: it.peca_id, nome: it.nome, preco: it.preco, qtd: it.qtd, cor: it.cor || null };
          }));
          nvRecalc();
        }
        function nvSubtotal() { return nvItens.reduce(function (s, it) { return s + it.preco * it.qtd; }, 0); }
        function nvDesconto() { var d = parseFloat(document.getElementById('nv_desconto').value); return (isNaN(d) || d < 0) ? 0 : d; }
        function nvTotal() { return Math.max(0, nvSubtotal() - nvDesconto()); }
        function nvRecalc() {
          document.getElementById('nv_subtotal').textContent = nvMoney(nvSubtotal());
          document.getElementById('nv_total').textContent = nvMoney(nvTotal());
          pgAtualizaResto();
        }

        // ----- Pagamentos (misto) -----
        var PG_LABELS = { dinheiro: 'Dinheiro', pix: 'Pix', debito: 'Cartão de débito', credito: 'Cartão de crédito' };
        var pgItens = [];
        function pgToggleParcelas() {
          document.getElementById('pg_campo_parcelas').style.display = document.getElementById('pg_forma').value === 'credito' ? '' : 'none';
        }
        function pgAdd() {
          var forma = document.getElementById('pg_forma').value;
          var valor = parseFloat(document.getElementById('pg_valor').value);
          if (isNaN(valor) || valor <= 0) { alert('Informe o valor desse pagamento.'); return; }
          var parcelas = forma === 'credito' ? (parseInt(document.getElementById('pg_parcelas').value, 10) || 1) : null;
          pgItens.push({ forma: forma, valor: valor, parcelas: parcelas });
          document.getElementById('pg_valor').value = '';
          pgRender();
        }
        function pgRemover(i) { pgItens.splice(i, 1); pgRender(); }
        function pgRender() {
          var corpo = document.getElementById('pg_corpo');
          if (pgItens.length === 0) {
            corpo.innerHTML = '<tr id="pg_vazio"><td colspan="3" class="muted" style="padding:10px 0;">Nenhum pagamento lançado.</td></tr>';
          } else {
            corpo.innerHTML = pgItens.map(function (it, i) {
              var label = PG_LABELS[it.forma] || it.forma;
              if (it.forma === 'credito' && it.parcelas > 1) label += ' (' + it.parcelas + 'x)';
              return '<tr><td>' + label + '</td><td style="text-align:right;">' + nvMoney(it.valor) + '</td>' +
                '<td style="text-align:right;"><button type="button" class="btn btn-sm btn-danger" onclick="pgRemover(' + i + ')">Remover</button></td></tr>';
            }).join('');
          }
          document.getElementById('pg_json').value = JSON.stringify(pgItens);
          pgAtualizaResto();
        }
        function pgAtualizaResto() {
          var el = document.getElementById('pg_resto');
          if (!el) return;
          var totalVenda = nvTotal();
          var pago = pgItens.reduce(function (s, it) { return s + it.valor; }, 0);
          var resto = Math.round((totalVenda - pago) * 100) / 100;
          if (totalVenda === 0 && pago === 0) { el.textContent = ''; return; }
          if (Math.abs(resto) < 0.005) {
            el.innerHTML = '<span style="color:#1f6b3a;font-weight:600;">Pagamento bate com o total. 👍</span>';
          } else if (resto > 0) {
            el.innerHTML = 'Falta lançar <strong>' + nvMoney(resto) + '</strong> &nbsp;·&nbsp; total da venda: ' + nvMoney(totalVenda) + '.';
          } else {
            el.innerHTML = '<span style="color:#a1352a;">Pagamentos passam do total em <strong>' + nvMoney(-resto) + '</strong>.</span>';
          }
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

  // Mapa produto -> cores, pra o seletor de cor aparecer só quando o produto tem cores.
  const coresMap = {};
  (pecasDisponiveis || []).forEach((p) => {
    if (p.cores && p.cores.length) coresMap[p.id] = p.cores.map((c) => ({ cor: c.cor, qtd: c.quantidade }));
  });
  // Mapa produto -> preço de venda, pra o preço aparecer e poder ser ajustado (desconto).
  const precoMap = {};
  (pecasDisponiveis || []).forEach((p) => {
    precoMap[p.id] = p.preco_venda;
  });

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
            <div class="field" id="campo-cor" style="display:none;">
              <label for="item_cor">Cor (baixa do estoque desta cor) *</label>
              <select id="item_cor" name="cor"></select>
            </div>
            <div class="field" id="campo-preco" style="display:none;">
              <label for="item_preco">Preço unit. (R$)</label>
              <input type="number" id="item_preco" name="preco_unitario" min="0" step="0.01">
              <small class="muted">Vem do cadastro — mude aqui pra dar desconto só nesta venda.</small>
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
          var VENDA_CORES = ${JSON.stringify(coresMap)};
          var PRECO_MAP = ${JSON.stringify(precoMap)};
          function vEsc(s){ return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
          function toggleProduto() {
            var val = document.getElementById('produto_id').value;
            var isVeiculo = val === 'veiculo';
            var isPeca = (!isVeiculo && val && String(val).indexOf('servico:') !== 0 && PRECO_MAP[val] !== undefined);
            document.getElementById('campo-quantidade').style.display = isVeiculo ? 'none' : '';
            document.getElementById('campo-veiculo').style.display = isVeiculo ? '' : 'none';
            var campoCor = document.getElementById('campo-cor');
            var selCor = document.getElementById('item_cor');
            var cores = (!isVeiculo && VENDA_CORES[val]) ? VENDA_CORES[val] : null;
            if (cores && cores.length) {
              selCor.innerHTML = cores.map(function(c){ return '<option value="'+vEsc(c.cor)+'">'+vEsc(c.cor)+' (estoque: '+c.qtd+')</option>'; }).join('');
              selCor.required = true;
              campoCor.style.display = '';
            } else {
              selCor.innerHTML = '';
              selCor.required = false;
              campoCor.style.display = 'none';
            }
            var campoPreco = document.getElementById('campo-preco');
            var inpPreco = document.getElementById('item_preco');
            if (isPeca) {
              inpPreco.value = PRECO_MAP[val];
              campoPreco.style.display = '';
            } else {
              inpPreco.value = '';
              campoPreco.style.display = 'none';
            }
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

function vendaShowPage({ user, flash, venda, itens, pecasDisponiveis, servicosDisponiveis, csrfToken, configFiscal, pagamentos, podeAlterar = true, senhaCaixaConfig = false, vendedores = [] }) {
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
            &nbsp;·&nbsp; Vendedor: ${venda.vendedor_nome ? escapeHtml(venda.vendedor_nome) : '<span class="muted">—</span>'}
            &nbsp;·&nbsp; Pagamento: ${formaPagamentoLabel(venda)}
          </p>
        </div>
        <div class="actions-row" style="margin-top:0;">
          ${
            venda.status === 'aberta'
              ? `<form method="POST" action="/vendas/${venda.id}/cancelar" onsubmit="return confirm('Cancelar esta venda? Os itens voltam pro estoque e a venda fica marcada como Cancelada. Não dá pra desfazer.');" style="margin:0;">
                   <input type="hidden" name="csrf" value="${csrfToken}">
                   <button class="btn btn-danger btn-sm" type="submit">Cancelar venda</button>
                 </form>`
              : ''
          }
        </div>
      </div>

      ${podeAlterar ? `
      <div class="card" style="margin-bottom:16px;">
        <form method="POST" action="/vendas/${venda.id}/vendedor" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin:0;">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="field" style="margin:0;"><label>Vendedor da venda</label>
            <select name="vendedor_id">
              <option value="">— sem vendedor —</option>
              ${vendedores.map((vd) => `<option value="${vd.id}" ${String(venda.vendedor_id) === String(vd.id) ? 'selected' : ''}>${escapeHtml(vd.name)}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-sm btn-secondary" type="submit">Trocar vendedor</button>
        </form>
      </div>` : ''}

      ${(() => {
        if (venda.status === 'concluida') {
          const compLink = venda.comprovante_caminho
            ? ` · <a class="link-btn" href="/uploads/${escapeHtml(venda.comprovante_caminho)}" target="_blank" rel="noopener">ver comprovante</a>`
            : '';
          const cfgNfe = configFiscal || {};
          const ambNfe = cfgNfe.ambiente === 'producao' ? 'producao' : 'homologacao';
          const temTokenNfe = ambNfe === 'producao' ? !!cfgNfe.focus_token_producao : !!cfgNfe.focus_token_homologacao;
          const stNfe = venda.nfe_status;
          const podeEmitirNfe = temTokenNfe && (!stNfe || stNfe === 'erro' || stNfe === 'erro_autorizacao' || stNfe === 'denegado');
          const nfeCta = podeEmitirNfe
            ? `<div class="card" style="border-left:4px solid #1f6d3a;background:#f2fbf5;">
                 <h2 style="margin-top:0;">Falta só a nota</h2>
                 <p class="muted" style="margin-top:-4px;">A venda já foi recebida. Emita a NF-e agora, se precisar — só as mercadorias entram na nota.</p>
                 <form method="POST" action="/vendas/${venda.id}/nfe/emitir" onsubmit="return confirm('Emitir NF-e desta venda no ambiente ${ambNfe}?');" style="margin:0;">
                   <input type="hidden" name="csrf" value="${csrfToken}">
                   <button class="btn" type="submit">📄 ${stNfe ? 'Tentar emitir a NF-e de novo' : 'Emitir NF-e agora'}</button>
                 </form>
               </div>`
            : '';
          return `<div class="flash flash-success">Pagamento confirmado (baixa) em ${formatDate(venda.finalizada_at)}.${compLink}</div>${nfeCta}`;
        }
        if (venda.status === 'cancelada') {
          return '<div class="flash flash-error">Venda cancelada — os itens voltaram pro estoque.</div>';
        }
        if (venda.status !== 'aberta' || !itens.length) return '';
        const temDigital = (pagamentos || []).some((p) => ['pix', 'debito', 'credito'].includes(p.forma));
        return `
        <div class="card" style="border-left:4px solid #8a6d1f;">
          <h2 style="margin-top:0;">Dar baixa (confirmar pagamento)</h2>
          <p class="muted" style="margin-top:-4px;">Só o caixa confirma, depois que o dinheiro entrou na conta da empresa${temDigital ? ' — anexando o comprovante' : ''}.</p>
          <form method="POST" action="/vendas/${venda.id}/finalizar" enctype="multipart/form-data" onsubmit="return confirm('Dar baixa nesta venda? Isso confirma que o pagamento foi recebido. Depois não dá pra alterar os itens.');">
            <input type="hidden" name="csrf" value="${csrfToken}">
            <div class="form-grid">
              ${senhaCaixaConfig ? `<div class="field"><label for="senha_caixa">Senha do caixa</label><input type="password" id="senha_caixa" name="senha_caixa" required autocomplete="off"></div>` : ''}
              ${temDigital ? `<div class="field"><label for="comprovante">Comprovante do pagamento (obrigatório — PDF/foto)</label><input type="file" id="comprovante" name="comprovante" accept="image/*,application/pdf" required></div>` : ''}
            </div>
            <button class="btn" type="submit">✔ Dar baixa</button>
          </form>
          ${!senhaCaixaConfig ? '<p class="muted" style="margin-top:8px;">Dica: defina a <a class="link-btn" href="/configuracoes/caixa">senha do caixa</a> em Configurações para exigir senha na baixa.</p>' : ''}
        </div>`;
      })()}

      <div class="stat-grid">
        <div class="stat-card"><div class="num">${formatMoney(venda.valor_total)}</div><div class="label">Valor total da venda${Number(venda.desconto) > 0 ? ` (desconto de ${formatMoney(venda.desconto)})` : ''}</div></div>
        <div class="stat-card"><div class="num">${itens.length}</div><div class="label">Itens vendidos</div></div>
        <div class="stat-card"><div class="num">${formatDate(venda.created_at).split(' ')[0]}</div><div class="label">Data da venda</div></div>
      </div>

      ${vendaItensSection(venda, itens, pecasDisponiveis, servicosDisponiveis || [], csrfToken)}

      ${pagamentosVendaSection(pagamentos)}

      ${nfeVendaSection(venda, configFiscal || {}, csrfToken, podeAlterar)}

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

function nfeVendaSection(venda, config, csrfToken, podeAlterar = true) {
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
      ${podeAlterar ? `<details style="margin-top:16px;">
        <summary class="muted" style="cursor:pointer;">Cancelar esta NF-e</summary>
        <form method="POST" action="/vendas/${venda.id}/nfe/cancelar" onsubmit="return confirm('Cancelar a NF-e autorizada? Isso é definitivo.');" style="margin-top:10px;">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="field full">
            <label for="justificativa">Justificativa (mín. 15 caracteres)</label>
            <input type="text" id="justificativa" name="justificativa" minlength="15" required placeholder="Ex.: Venda cancelada a pedido do cliente.">
          </div>
          <button class="btn btn-danger btn-sm" type="submit" style="margin-top:8px;">Cancelar NF-e</button>
        </form>
      </details>` : ''}`;
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
