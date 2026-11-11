'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatMoney, formatDateOnly } = require('../utils');

const STATUS_LABELS = {
  aberto: 'Aberto',
  aprovado: 'Aprovado',
  recusado: 'Recusado',
  convertido: 'Convertido em O.S.',
};
const STATUS_COR = {
  aberto: '#a66a00',
  aprovado: '#2f6b3a',
  recusado: '#a1352a',
  convertido: '#2f6b3a',
};
function statusBadge(status) {
  const s = STATUS_LABELS[status] ? status : 'aberto';
  return `<span class="badge" style="background:${STATUS_COR[s]};color:#fff;">${STATUS_LABELS[s]}</span>`;
}

function orcamentosListPage({ user, flash, orcamentos, statusFilter }) {
  const rows = orcamentos
    .map(
      (o) => `
    <tr>
      <td><a class="link-btn" href="/orcamentos/${o.id}">${escapeHtml(o.numero)}</a></td>
      <td>${escapeHtml(o.cliente_nome)}</td>
      <td>${o.marca || o.modelo ? `${escapeHtml(o.marca || '')} ${escapeHtml(o.modelo || '')}` : '<span class="muted">—</span>'}</td>
      <td>${statusBadge(o.status)}</td>
      <td>${formatMoney(o.valor_total)}</td>
      <td>${o.validade ? formatDateOnly(o.validade) : '<span class="muted">—</span>'}</td>
    </tr>`
    )
    .join('');

  const filterLink = (value, label) =>
    `<a class="btn btn-sm ${statusFilter === value ? 'btn' : 'btn-secondary'}" href="/orcamentos${value ? `?status=${value}` : ''}">${label}</a>`;

  return layout({
    title: 'Orçamentos',
    activeNav: 'orcamentos',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Orçamentos</h1>
          <p class="subtitle">Orce antes de consertar — o cliente aprova e vira O.S.</p>
        </div>
        <a class="btn" href="/orcamentos/novo">+ Novo Orçamento</a>
      </div>
      <div class="actions-row" style="margin-top:0;margin-bottom:20px;">
        ${filterLink('', 'Todos')}
        ${filterLink('aberto', 'Abertos')}
        ${filterLink('aprovado', 'Aprovados')}
        ${filterLink('recusado', 'Recusados')}
        ${filterLink('convertido', 'Convertidos')}
      </div>
      <div class="card">
        ${
          orcamentos.length
            ? `<table>
          <thead><tr><th>Número</th><th>Cliente</th><th>Veículo</th><th>Status</th><th>Valor</th><th>Validade</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
            : '<div class="empty">Nenhum orçamento encontrado.</div>'
        }
      </div>
    `,
  });
}

function orcamentoFormPage({ user, flash, clientes, bicicletas, csrfToken, defaultClienteId, pecasDisponiveis, servicosDisponiveis }) {
  const clienteOptions = clientes
    .map((c) => `<option value="${c.id}" ${defaultClienteId == c.id ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`)
    .join('');
  const bicicletaOptions = bicicletas
    .map(
      (b) =>
        `<option value="${b.id}" data-cliente="${b.cliente_id}">${escapeHtml(b.marca || '')} ${escapeHtml(b.modelo)} — ${escapeHtml(b.cliente_nome)}</option>`
    )
    .join('');

  const pecas = pecasDisponiveis || [];
  const servicos = servicosDisponiveis || [];
  const produtoOptions = pecas
    .map((p) => {
      const foto = p.foto_caminho ? '/uploads/' + p.foto_caminho : '';
      return `<option value="prod:${p.id}" data-nome="${escapeHtml(p.nome)}" data-preco="${Number(p.preco_venda) || 0}" data-tipo="produto" data-foto="${escapeHtml(foto)}">${escapeHtml(p.nome)} — ${formatMoney(p.preco_venda)}</option>`;
    })
    .join('');
  const servicoOptions = servicos
    .map((s) => `<option value="serv:${s.id}" data-nome="${escapeHtml(s.nome)}" data-preco="${Number(s.valor) || 0}" data-tipo="servico" data-foto="">${escapeHtml(s.nome)} — ${formatMoney(s.valor)}</option>`)
    .join('');
  const produtosBarcodeJson = JSON.stringify(
    pecas.map((p) => ({
      nome: p.nome,
      preco: Number(p.preco_venda) || 0,
      codigo: p.codigo_barras || null,
      foto: p.foto_caminho ? '/uploads/' + p.foto_caminho : null,
    }))
  );

  return layout({
    title: 'Novo Orçamento',
    activeNav: 'orcamentos',
    user,
    flash,
    children: `
      <div class="page-header"><div><h1>Novo Orçamento</h1><p class="subtitle">Preencha os dados e já adicione os itens — tudo numa tela só.</p></div></div>
      <form method="POST" action="/orcamentos">
        <input type="hidden" name="csrf" value="${csrfToken}">
        <input type="hidden" name="itens_json" id="itens_json" value="[]">
        <div class="card">
          <div class="form-grid">
            <div class="field">
              <label for="cliente_id">Cliente *</label>
              <select id="cliente_id" name="cliente_id" required onchange="filterBikes()">
                <option value="">Selecione...</option>
                ${clienteOptions}
              </select>
              <button type="button" class="link-btn" style="margin-top:6px;background:none;border:none;padding:0;cursor:pointer;" onclick="orcToggleNovoCliente()">+ Cadastrar novo cliente</button>
              <div id="orc_novo_cliente" style="display:none;margin-top:8px;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);">
                <input type="text" id="nc_nome" placeholder="Nome do cliente *" autocomplete="off" style="margin-bottom:6px;">
                <input type="text" id="nc_telefone" placeholder="Telefone (opcional)" autocomplete="off" style="margin-bottom:6px;">
                <div style="display:flex;gap:8px;">
                  <button type="button" class="btn btn-sm" onclick="orcCriarCliente()">Salvar cliente</button>
                  <button type="button" class="btn btn-sm btn-secondary" onclick="orcToggleNovoCliente()">Cancelar</button>
                </div>
                <p class="muted" id="nc_msg" style="margin:6px 0 0;min-height:14px;"></p>
              </div>
            </div>
            <div class="field">
              <label for="bicicleta_id">Veículo (opcional)</label>
              <select id="bicicleta_id" name="bicicleta_id">
                <option value="">Sem veículo específico</option>
                ${bicicletaOptions}
              </select>
            </div>
            <div class="field">
              <label for="validade">Validade do orçamento</label>
              <input type="date" id="validade" name="validade">
            </div>
            <div class="field full">
              <label for="observacoes">Observações</label>
              <textarea id="observacoes" name="observacoes" placeholder="Ex: diagnóstico, condições, prazo estimado..."></textarea>
            </div>
          </div>
        </div>

        <div class="card">
          <h2 style="margin-top:0;">Itens do orçamento</h2>
          <table id="orc_tabela" style="display:none;"><thead><tr><th>Descrição</th><th>Qtd.</th><th>Valor unit.</th><th>Subtotal</th><th></th></tr></thead><tbody id="orc_tbody"></tbody></table>
          <p class="muted" id="orc_vazio">Nenhum item adicionado ainda. Monte a lista abaixo.</p>
          <p id="orc_total" style="margin-top:12px;display:none;"><strong>Total do orçamento: <span id="orc_total_val">R$ 0,00</span></strong></p>

          <div class="field" style="margin-top:16px;max-width:460px;">
            <label for="orc_barcode">📷 Código de barras (bipe ou digite e aperte Enter)</label>
            <input type="text" id="orc_barcode" placeholder="Bipe o produto aqui..." autocomplete="off" onkeydown="orcBarcodeKey(event)">
            <p class="muted" id="orc_barcode_msg" style="margin-top:4px;min-height:16px;"></p>
          </div>
          <div id="orc_preview_box" style="display:none;align-items:center;gap:10px;margin-bottom:10px;">
            <img id="orc_preview_img" src="" alt="" title="Clique para ampliar" onclick="orcZoom(this.src)" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--border);cursor:zoom-in;">
            <span id="orc_preview_nome" class="muted"></span>
          </div>

          <div class="form-grid" style="margin-top:4px;">
            ${
              produtoOptions || servicoOptions
                ? `<div class="field">
              <label for="orc_catalogo">Do catálogo (opcional)</label>
              <select id="orc_catalogo" onchange="orcDoCatalogo(this)">
                <option value="">Digitar manualmente...</option>
                ${produtoOptions ? `<optgroup label="Produtos">${produtoOptions}</optgroup>` : ''}
                ${servicoOptions ? `<optgroup label="Serviços">${servicoOptions}</optgroup>` : ''}
              </select>
            </div>`
                : ''
            }
            <div class="field">
              <label for="orc_tipo">Tipo</label>
              <select id="orc_tipo">
                <option value="servico">Serviço</option>
                <option value="produto">Produto</option>
              </select>
            </div>
            <div class="field">
              <label for="orc_nome">Descrição</label>
              <input type="text" id="orc_nome" placeholder="Ex: Troca de pneu / Pneu aro 10">
            </div>
            <div class="field">
              <label for="orc_qtd">Qtd.</label>
              <input type="number" id="orc_qtd" min="1" step="1" value="1">
            </div>
            <div class="field">
              <label for="orc_preco">Valor unitário (R$)</label>
              <input type="number" id="orc_preco" min="0" step="0.01">
            </div>
          </div>
          <button type="button" class="btn btn-sm" onclick="orcAddItem()">+ Adicionar item</button>
        </div>

        <div class="actions-row">
          <button class="btn" type="submit">Criar orçamento</button>
          <a class="btn btn-secondary" href="/orcamentos">Cancelar</a>
        </div>
      </form>

      <div id="orc_lightbox" onclick="orcCloseZoom()" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:1000;align-items:center;justify-content:center;cursor:zoom-out;">
        <img id="orc_lightbox_img" src="" alt="" style="max-width:90vw;max-height:90vh;border-radius:8px;">
      </div>

      <script>
        var ORC_PRODUTOS = ${produtosBarcodeJson};
        var orcFotoSelecionada = null;

        var allBikes = Array.prototype.slice.call(document.querySelectorAll('#bicicleta_id option[data-cliente]'))
          .map(function(o){ return { value:o.value, cliente:o.getAttribute('data-cliente'), text:o.textContent }; });
        function filterBikes(){
          var cli = document.getElementById('cliente_id').value;
          var sel = document.getElementById('bicicleta_id');
          sel.innerHTML = '';
          var ph = document.createElement('option'); ph.value=''; ph.textContent='Sem veículo específico'; sel.appendChild(ph);
          allBikes.filter(function(o){ return !cli || o.cliente===cli; }).forEach(function(o){
            var op=document.createElement('option'); op.value=o.value; op.textContent=o.text; sel.appendChild(op);
          });
        }

        // ---- Cadastro rápido de cliente, sem sair da tela ----
        function orcToggleNovoCliente(){
          var box = document.getElementById('orc_novo_cliente');
          var abrir = box.style.display === 'none';
          box.style.display = abrir ? 'block' : 'none';
          if (abrir) document.getElementById('nc_nome').focus();
          document.getElementById('nc_msg').textContent = '';
        }
        function orcCriarCliente(){
          var nome = (document.getElementById('nc_nome').value||'').trim();
          var tel = (document.getElementById('nc_telefone').value||'').trim();
          var msg = document.getElementById('nc_msg');
          if (!nome){ msg.innerHTML = '<span style="color:#a1352a;">Informe o nome.</span>'; return; }
          msg.textContent = 'Salvando...';
          var csrf = document.querySelector('input[name=csrf]').value;
          var dados = 'csrf=' + encodeURIComponent(csrf) + '&nome=' + encodeURIComponent(nome) + '&telefone=' + encodeURIComponent(tel);
          fetch('/clientes/criar-rapido', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: dados })
            .then(function(r){ return r.json(); })
            .then(function(d){
              if (!d.ok){ msg.innerHTML = '<span style="color:#a1352a;">' + (d.error||'Erro ao salvar.') + '</span>'; return; }
              var sel = document.getElementById('cliente_id');
              var op = document.createElement('option');
              op.value = d.id; op.textContent = d.nome; sel.appendChild(op);
              sel.value = d.id;
              filterBikes();
              document.getElementById('nc_nome').value = '';
              document.getElementById('nc_telefone').value = '';
              document.getElementById('orc_novo_cliente').style.display = 'none';
            })
            .catch(function(){ msg.innerHTML = '<span style="color:#a1352a;">Falha de conexão. Tente de novo.</span>'; });
        }

        // ---- Foto / zoom ----
        function orcZoom(src){ if(!src) return; document.getElementById('orc_lightbox_img').src = src; document.getElementById('orc_lightbox').style.display='flex'; }
        function orcCloseZoom(){ document.getElementById('orc_lightbox').style.display='none'; }
        document.addEventListener('keydown', function(e){ if(e.key==='Escape') orcCloseZoom(); });
        function orcMostrarPreview(foto, nome){
          var box = document.getElementById('orc_preview_box');
          if (foto){
            document.getElementById('orc_preview_img').src = foto;
            document.getElementById('orc_preview_nome').textContent = nome || '';
            box.style.display = 'flex';
          } else { box.style.display = 'none'; }
        }

        // ---- Builder de itens do orçamento (uma tela só) ----
        var ORC_ITENS = [];
        function orcMoney(v){ return 'R$ ' + (Number(v)||0).toFixed(2).replace('.', ','); }
        function orcDoCatalogo(sel){
          var o = sel.options[sel.selectedIndex];
          if (o && o.getAttribute('data-nome')){
            document.getElementById('orc_nome').value = o.getAttribute('data-nome');
            document.getElementById('orc_preco').value = o.getAttribute('data-preco');
            document.getElementById('orc_tipo').value = o.getAttribute('data-tipo');
            orcFotoSelecionada = o.getAttribute('data-foto') || null;
            orcMostrarPreview(orcFotoSelecionada, o.getAttribute('data-nome'));
          } else {
            orcFotoSelecionada = null;
            orcMostrarPreview(null);
          }
        }
        function orcBarcodeKey(e){
          if (e.key !== 'Enter') return;
          e.preventDefault();
          var inp = document.getElementById('orc_barcode');
          var cod = (inp.value||'').trim();
          var msg = document.getElementById('orc_barcode_msg');
          if (!cod) return;
          var prod = ORC_PRODUTOS.find(function(p){ return p.codigo && String(p.codigo) === cod; });
          if (!prod){
            msg.innerHTML = '<span style="color:#a1352a;">Nenhum produto com o código ' + cod + '.</span>';
            inp.select();
            return;
          }
          var existente = ORC_ITENS.find(function(it){ return it.tipo==='produto' && it.nome===prod.nome && it.preco===prod.preco; });
          if (existente) existente.qtd += 1;
          else ORC_ITENS.push({ tipo:'produto', nome:prod.nome, qtd:1, preco:prod.preco, foto:prod.foto||null });
          msg.innerHTML = '<span style="color:#1f6b3a;">+ ' + String(prod.nome).replace(/</g,'&lt;') + '</span>';
          orcMostrarPreview(prod.foto, prod.nome);
          inp.value = '';
          orcRender();
        }
        function orcRender(){
          var tb = document.getElementById('orc_tbody');
          var tabela = document.getElementById('orc_tabela');
          var vazio = document.getElementById('orc_vazio');
          var totalBox = document.getElementById('orc_total');
          if (!ORC_ITENS.length){
            tb.innerHTML=''; tabela.style.display='none'; vazio.style.display='block'; totalBox.style.display='none';
          } else {
            tabela.style.display=''; vazio.style.display='none'; totalBox.style.display='block';
            var html=''; var total=0;
            ORC_ITENS.forEach(function(it, idx){
              var sub=(Number(it.preco)||0)*it.qtd; total+=sub;
              var thumb = it.foto
                ? '<img src="' + it.foto + '" alt="" title="Clique para ampliar" onclick="orcZoom(this.src)" style="width:34px;height:34px;object-fit:cover;border-radius:6px;border:1px solid var(--border);vertical-align:middle;margin-right:8px;cursor:zoom-in;">'
                : '';
              html += '<tr><td>' + thumb + String(it.nome).replace(/</g,'&lt;') + ' <span class="muted">(' + (it.tipo==='produto'?'produto':'serviço') + ')</span></td>' +
                '<td>'+it.qtd+'</td><td>'+orcMoney(it.preco)+'</td><td>'+orcMoney(sub)+'</td>' +
                '<td><button type="button" class="btn btn-sm btn-danger" onclick="orcRemove('+idx+')">Remover</button></td></tr>';
            });
            tb.innerHTML=html;
            document.getElementById('orc_total_val').textContent = orcMoney(total);
          }
          document.getElementById('itens_json').value = JSON.stringify(ORC_ITENS.map(function(it){ return { tipo:it.tipo, nome:it.nome, qtd:it.qtd, preco:it.preco }; }));
        }
        function orcAddItem(){
          var nome = (document.getElementById('orc_nome').value||'').trim();
          var preco = parseFloat(document.getElementById('orc_preco').value);
          var qtd = Math.max(1, parseInt(document.getElementById('orc_qtd').value,10)||1);
          var tipo = document.getElementById('orc_tipo').value==='produto'?'produto':'servico';
          if (!nome){ alert('Informe a descrição do item.'); return; }
          if (!isFinite(preco) || preco<0){ alert('Informe um valor unitário válido.'); return; }
          ORC_ITENS.push({ tipo:tipo, nome:nome, qtd:qtd, preco:preco, foto: orcFotoSelecionada || null });
          document.getElementById('orc_nome').value='';
          document.getElementById('orc_preco').value='';
          document.getElementById('orc_qtd').value=1;
          var cat=document.getElementById('orc_catalogo'); if(cat) cat.value='';
          orcFotoSelecionada = null;
          orcMostrarPreview(null);
          orcRender();
        }
        function orcRemove(idx){ ORC_ITENS.splice(idx,1); orcRender(); }
      </script>
    `,
  });
}

function orcamentoShowPage({ user, flash, orcamento, itens, pecasDisponiveis, servicosDisponiveis, csrfToken }) {
  const o = orcamento;
  const editavel = o.status === 'aberto';

  const itensRows = itens
    .map((it) => {
      const subtotal = it.quantidade * it.preco_unitario;
      return `
      <tr>
        <td>${escapeHtml(it.nome)} <span class="muted">(${it.tipo === 'produto' ? 'produto' : 'serviço'})</span></td>
        <td>${it.quantidade}</td>
        <td>${formatMoney(it.preco_unitario)}</td>
        <td>${formatMoney(subtotal)}</td>
        <td>${
          editavel
            ? `<form method="POST" action="/orcamentos/${o.id}/itens/${it.id}/excluir" onsubmit="return confirm('Remover este item?');">
                <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
                <button class="btn btn-sm btn-danger" type="submit">Remover</button>
              </form>`
            : ''
        }</td>
      </tr>`;
    })
    .join('');

  const produtoOptions = pecasDisponiveis
    .map((p) => `<option value="prod:${p.id}" data-nome="${escapeHtml(p.nome)}" data-preco="${p.preco_venda}" data-tipo="produto">${escapeHtml(p.nome)} — ${formatMoney(p.preco_venda)}</option>`)
    .join('');
  const servicoOptions = servicosDisponiveis
    .map((s) => `<option value="serv:${s.id}" data-nome="${escapeHtml(s.nome)}" data-preco="${s.valor}" data-tipo="servico">${escapeHtml(s.nome)} — ${formatMoney(s.valor)}</option>`)
    .join('');

  const addForm = editavel
    ? `<form method="POST" action="/orcamentos/${o.id}/itens" style="margin-top:16px;">
      <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
      <div class="form-grid">
        ${
          produtoOptions || servicoOptions
            ? `<div class="field">
          <label for="catalogo">Do catálogo (opcional)</label>
          <select id="catalogo" onchange="const o=this.options[this.selectedIndex]; if(o.dataset.nome){document.getElementById('item_nome').value=o.dataset.nome;document.getElementById('item_preco').value=o.dataset.preco;document.getElementById('item_tipo').value=o.dataset.tipo;}">
            <option value="">Digitar manualmente...</option>
            ${produtoOptions ? `<optgroup label="Produtos">${produtoOptions}</optgroup>` : ''}
            ${servicoOptions ? `<optgroup label="Serviços">${servicoOptions}</optgroup>` : ''}
          </select>
        </div>`
            : ''
        }
        <div class="field">
          <label for="item_tipo">Tipo</label>
          <select id="item_tipo" name="tipo">
            <option value="servico">Serviço</option>
            <option value="produto">Produto</option>
          </select>
        </div>
        <div class="field">
          <label for="item_nome">Descrição *</label>
          <input type="text" id="item_nome" name="nome" required placeholder="Ex: Troca de pneu / Pneu aro 10">
        </div>
        <div class="field">
          <label for="item_qtd">Qtd.</label>
          <input type="number" id="item_qtd" name="quantidade" min="1" step="1" value="1" required>
        </div>
        <div class="field">
          <label for="item_preco">Valor unitário (R$) *</label>
          <input type="number" id="item_preco" name="preco_unitario" min="0" step="0.01" required>
        </div>
      </div>
      <button class="btn btn-sm" type="submit">+ Adicionar item</button>
    </form>`
    : '';

  const acoes = `
    <div class="actions-row" style="margin-top:0;">
      ${
        o.status === 'aberto'
          ? `<form method="POST" action="/orcamentos/${o.id}/aprovar"><input type="hidden" name="csrf" value="${csrfToken}"><button class="btn" type="submit">✔ Aprovar</button></form>
             <form method="POST" action="/orcamentos/${o.id}/recusar" onsubmit="return confirm('Marcar este orçamento como recusado?');"><input type="hidden" name="csrf" value="${csrfToken}"><button class="btn btn-secondary" type="submit">Recusar</button></form>`
          : ''
      }
      ${
        o.status === 'aprovado'
          ? `<form method="POST" action="/orcamentos/${o.id}/converter" onsubmit="return confirm('Gerar uma Ordem de Serviço a partir deste orçamento?');"><input type="hidden" name="csrf" value="${csrfToken}"><button class="btn" type="submit">➜ Converter em O.S.</button></form>`
          : ''
      }
      ${
        o.status === 'recusado'
          ? `<form method="POST" action="/orcamentos/${o.id}/reabrir"><input type="hidden" name="csrf" value="${csrfToken}"><button class="btn btn-secondary" type="submit">Reabrir</button></form>`
          : ''
      }
      ${
        o.convertido_os_id
          ? `<a class="btn btn-secondary" href="/os/${o.convertido_os_id}">Ver O.S. gerada</a>`
          : ''
      }
    </div>`;

  return layout({
    title: o.numero,
    activeNav: 'orcamentos',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>${escapeHtml(o.numero)} ${statusBadge(o.status)}</h1>
          <p class="subtitle">
            Cliente: <a class="link-btn" href="/clientes/${o.cliente_id}">${escapeHtml(o.cliente_nome)}</a>
            ${o.bicicleta_id ? `&nbsp;·&nbsp; Veículo: <a class="link-btn" href="/bicicletas/${o.bicicleta_id}">${escapeHtml(o.marca || '')} ${escapeHtml(o.modelo || '')}</a>` : ''}
            ${o.validade ? `&nbsp;·&nbsp; Validade: ${formatDateOnly(o.validade)}` : ''}
          </p>
        </div>
        ${acoes}
      </div>

      ${
        o.status === 'convertido'
          ? '<div class="flash flash-success">Este orçamento foi aprovado e convertido em Ordem de Serviço.</div>'
          : ''
      }

      <div class="card">
        <h2>Itens do orçamento</h2>
        ${
          itens.length
            ? `<table><thead><tr><th>Descrição</th><th>Qtd.</th><th>Valor unit.</th><th>Subtotal</th><th></th></tr></thead><tbody>${itensRows}</tbody></table>
               <p style="margin-top:12px;"><strong>Total do orçamento: ${formatMoney(o.valor_total)}</strong></p>`
            : '<p class="muted">Nenhum item adicionado ainda.</p>'
        }
        ${addForm}
        ${!editavel && !itens.length ? '' : ''}
      </div>

      ${
        o.observacoes
          ? `<div class="card"><h2>Observações</h2><p>${escapeHtml(o.observacoes).replace(/\n/g, '<br>')}</p></div>`
          : ''
      }

      <a class="btn btn-secondary" href="/orcamentos">← Voltar</a>
    `,
  });
}

module.exports = { orcamentosListPage, orcamentoFormPage, orcamentoShowPage, STATUS_LABELS };
