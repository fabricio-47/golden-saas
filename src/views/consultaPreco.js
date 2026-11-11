'use strict';

const { layout } = require('./layout');
const { escapeHtml } = require('../utils');

// Tela de CONSULTA DE PREÇO: calculadora de balcão, 100% no navegador.
// Não salva nada, não baixa estoque, não precisa de cliente. Só soma e mostra.
function consultaPrecoPage({ user, flash, pecas }) {
  const produtosJson = JSON.stringify(
    (pecas || []).map((p) => ({
      id: p.id,
      nome: p.nome,
      preco: Number(p.preco_venda) || 0,
      foto: p.foto_caminho ? '/uploads/' + p.foto_caminho : null,
      codigo: p.codigo_barras || null,
    }))
  );
  const options = (pecas || [])
    .map((p) => `<option value="${p.id}">${escapeHtml(p.nome)} — R$ ${(Number(p.preco_venda) || 0).toFixed(2).replace('.', ',')}</option>`)
    .join('');

  return layout({
    title: 'Consulta de preço',
    activeNav: 'consulta-preco',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Consulta de preço</h1>
          <p class="subtitle">Calcule o total na hora, sem cadastrar cliente. Nada aqui é salvo nem baixa estoque.</p>
        </div>
      </div>

      <div class="card">
        <h2 style="margin-top:0;">Adicionar do estoque</h2>
        <div class="field full" style="background:rgba(201,162,39,0.08);padding:12px;border-radius:8px;border:1px solid var(--border);margin-bottom:12px;">
          <label for="cp_barcode">📷 Código de barras (bipe ou digite e aperte Enter)</label>
          <input type="text" id="cp_barcode" placeholder="Bipe o produto aqui..." autocomplete="off" onkeydown="cpBarcodeKey(event)">
          <p class="muted" id="cp_barcode_msg" style="margin-top:4px;min-height:16px;"></p>
        </div>
        <div class="form-grid">
          <div class="field" style="grid-column: span 2;">
            <label for="cp_produto">Produto</label>
            <select id="cp_produto" onchange="cpPreview()">
              <option value="">Selecione...</option>
              ${options}
            </select>
          </div>
          <div class="field">
            <label for="cp_qtd">Quantidade</label>
            <input type="number" id="cp_qtd" min="1" step="1" value="1">
          </div>
        </div>
        <div id="cp_preview_box" style="display:none;align-items:center;gap:12px;margin:4px 0 12px;">
          <img id="cp_preview_img" src="" alt="" title="Clique para ampliar" onclick="cpZoom(this.src)" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--border);cursor:zoom-in;">
          <span id="cp_preview_nome" class="muted"></span>
        </div>
        <button type="button" class="btn" onclick="cpAddEstoque()">+ Adicionar do estoque</button>

        <h2 style="margin-top:24px;">Adicionar item avulso (fora do estoque)</h2>
        <div class="form-grid">
          <div class="field" style="grid-column: span 2;">
            <label for="cp_desc">Descrição</label>
            <input type="text" id="cp_desc" placeholder="Ex.: Serviço de instalação">
          </div>
          <div class="field">
            <label for="cp_preco">Preço unitário (R$)</label>
            <input type="number" id="cp_preco" min="0" step="0.01" placeholder="0,00">
          </div>
          <div class="field">
            <label for="cp_qtd2">Quantidade</label>
            <input type="number" id="cp_qtd2" min="1" step="1" value="1">
          </div>
        </div>
        <button type="button" class="btn btn-secondary" onclick="cpAddManual()">+ Adicionar item avulso</button>
      </div>

      <div class="card">
        <h2 style="margin-top:0;">Itens da consulta</h2>
        <table id="cp_tabela">
          <thead><tr><th>Item</th><th style="text-align:center;">Qtd.</th><th style="text-align:right;">Preço unit.</th><th style="text-align:right;">Subtotal</th><th></th></tr></thead>
          <tbody id="cp_corpo">
            <tr id="cp_vazio"><td colspan="5" class="muted" style="padding:16px 0;">Nenhum item ainda. Adicione produtos acima.</td></tr>
          </tbody>
        </table>

        <div style="display:flex;justify-content:flex-end;margin-top:16px;">
          <div style="min-width:320px;">
            <div style="display:flex;justify-content:space-between;padding:6px 0;">
              <span class="muted">Subtotal</span>
              <strong id="cp_subtotal">R$ 0,00</strong>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;gap:12px;">
              <span class="muted">Desconto (R$)</span>
              <input type="number" id="cp_desconto" min="0" step="0.01" value="" placeholder="0,00" style="width:120px;text-align:right;" oninput="cpRecalc()">
            </div>
            <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:2px solid var(--border);margin-top:4px;">
              <span style="font-size:18px;font-weight:700;">Total</span>
              <span id="cp_total" style="font-size:22px;font-weight:700;color:#1f6b3a;">R$ 0,00</span>
            </div>
          </div>
        </div>

        <div class="actions-row">
          <button type="button" class="btn" onclick="cpImprimir()">🖨 Imprimir / salvar PDF</button>
          <button type="button" class="btn btn-secondary" onclick="cpLimpar()">Limpar tudo</button>
        </div>
      </div>

      <div id="cp_lightbox" onclick="cpCloseZoom()" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;align-items:center;justify-content:center;cursor:zoom-out;">
        <img id="cp_lightbox_img" src="" alt="" style="max-width:90vw;max-height:90vh;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,0.6);">
      </div>

      <script>
        var CP_PRODUTOS = ${produtosJson};
        var cpItens = [];

        function cpZoom(src) {
          if (!src) return;
          document.getElementById('cp_lightbox_img').src = src;
          document.getElementById('cp_lightbox').style.display = 'flex';
        }
        function cpCloseZoom() {
          document.getElementById('cp_lightbox').style.display = 'none';
        }
        document.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') cpCloseZoom();
        });

        function cpMoney(v) {
          return 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');
        }
        function cpAddEstoque() {
          var sel = document.getElementById('cp_produto');
          var id = sel.value;
          if (!id) { alert('Selecione um produto.'); return; }
          var qtd = parseInt(document.getElementById('cp_qtd').value, 10) || 1;
          var prod = CP_PRODUTOS.find(function (p) { return String(p.id) === String(id); });
          if (!prod) return;
          cpItens.push({ nome: prod.nome, preco: prod.preco, qtd: qtd, foto: prod.foto || null });
          sel.value = '';
          document.getElementById('cp_qtd').value = 1;
          cpPreview();
          cpRender();
        }
        function cpBarcodeKey(e) {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          var inp = document.getElementById('cp_barcode');
          var cod = (inp.value || '').trim();
          var msg = document.getElementById('cp_barcode_msg');
          if (!cod) return;
          var prod = CP_PRODUTOS.find(function (p) { return p.codigo && String(p.codigo) === cod; });
          if (!prod) {
            msg.innerHTML = '<span style="color:#a1352a;">Nenhum produto com o código ' + cod + '.</span>';
            inp.select();
            return;
          }
          var existente = cpItens.find(function (it) { return it.nome === prod.nome && it.preco === prod.preco; });
          if (existente) existente.qtd += 1;
          else cpItens.push({ nome: prod.nome, preco: prod.preco, qtd: 1, foto: prod.foto || null });
          msg.innerHTML = '<span style="color:#1f6b3a;">+ ' + prod.nome + '</span>';
          inp.value = '';
          cpRender();
        }
        function cpPreview() {
          var id = document.getElementById('cp_produto').value;
          var box = document.getElementById('cp_preview_box');
          var prod = id ? CP_PRODUTOS.find(function (p) { return String(p.id) === String(id); }) : null;
          if (prod && prod.foto) {
            document.getElementById('cp_preview_img').src = prod.foto;
            document.getElementById('cp_preview_nome').textContent = prod.nome;
            box.style.display = 'flex';
          } else {
            box.style.display = 'none';
          }
        }
        function cpAddManual() {
          var desc = document.getElementById('cp_desc').value.trim();
          var preco = parseFloat(document.getElementById('cp_preco').value);
          var qtd = parseInt(document.getElementById('cp_qtd2').value, 10) || 1;
          if (!desc) { alert('Digite a descrição do item.'); return; }
          if (isNaN(preco) || preco < 0) { alert('Digite um preço válido.'); return; }
          cpItens.push({ nome: desc, preco: preco, qtd: qtd });
          document.getElementById('cp_desc').value = '';
          document.getElementById('cp_preco').value = '';
          document.getElementById('cp_qtd2').value = 1;
          cpRender();
        }
        function cpRemover(i) {
          cpItens.splice(i, 1);
          cpRender();
        }
        function cpRender() {
          var corpo = document.getElementById('cp_corpo');
          if (cpItens.length === 0) {
            corpo.innerHTML = '<tr id="cp_vazio"><td colspan="5" class="muted" style="padding:16px 0;">Nenhum item ainda. Adicione produtos acima.</td></tr>';
          } else {
            corpo.innerHTML = cpItens.map(function (it, i) {
              var sub = it.preco * it.qtd;
              var thumb = it.foto
                ? '<img src="' + it.foto + '" alt="" title="Clique para ampliar" onclick="cpZoom(this.src)" style="width:36px;height:36px;object-fit:cover;border-radius:6px;border:1px solid var(--border);vertical-align:middle;margin-right:8px;cursor:zoom-in;">'
                : '';
              return '<tr>' +
                '<td>' + thumb + cpEsc(it.nome) + '</td>' +
                '<td style="text-align:center;">' + it.qtd + '</td>' +
                '<td style="text-align:right;">' + cpMoney(it.preco) + '</td>' +
                '<td style="text-align:right;font-weight:600;">' + cpMoney(sub) + '</td>' +
                '<td style="text-align:right;"><button type="button" class="btn btn-danger btn-sm" onclick="cpRemover(' + i + ')">Remover</button></td>' +
              '</tr>';
            }).join('');
          }
          cpRecalc();
        }
        function cpRecalc() {
          var subtotal = cpItens.reduce(function (s, it) { return s + it.preco * it.qtd; }, 0);
          var desc = parseFloat(document.getElementById('cp_desconto').value) || 0;
          var total = Math.max(0, subtotal - desc);
          document.getElementById('cp_subtotal').textContent = cpMoney(subtotal);
          document.getElementById('cp_total').textContent = cpMoney(total);
        }
        function cpLimpar() {
          if (cpItens.length && !confirm('Limpar todos os itens da consulta?')) return;
          cpItens = [];
          document.getElementById('cp_desconto').value = '';
          cpRender();
        }
        function cpEsc(s) {
          return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        function cpImprimir() {
          if (cpItens.length === 0) { alert('Adicione pelo menos um item antes de imprimir.'); return; }
          var subtotal = cpItens.reduce(function (s, it) { return s + it.preco * it.qtd; }, 0);
          var desc = parseFloat(document.getElementById('cp_desconto').value) || 0;
          var total = Math.max(0, subtotal - desc);
          var hoje = new Date().toLocaleDateString('pt-BR');
          var linhas = cpItens.map(function (it) {
            return '<tr><td>' + cpEsc(it.nome) + '</td><td style="text-align:center;">' + it.qtd +
              '</td><td style="text-align:right;">' + cpMoney(it.preco) + '</td><td style="text-align:right;">' + cpMoney(it.preco * it.qtd) + '</td></tr>';
          }).join('');
          var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Consulta de preço</title>' +
            '<style>body{font-family:Arial,sans-serif;color:#222;padding:30px;max-width:640px;margin:0 auto;}' +
            'h1{font-size:20px;margin:0 0 4px;}.sub{color:#666;font-size:13px;margin-bottom:20px;}' +
            'table{width:100%;border-collapse:collapse;margin-bottom:16px;}th,td{padding:8px 6px;border-bottom:1px solid #ddd;font-size:14px;}' +
            'th{text-align:left;color:#666;font-size:12px;text-transform:uppercase;}' +
            '.tot{display:flex;justify-content:space-between;font-size:18px;font-weight:700;border-top:2px solid #333;padding-top:10px;}' +
            '.desc{display:flex;justify-content:space-between;color:#a1352a;font-size:14px;padding:2px 0;}' +
            '.obs{color:#999;font-size:11px;margin-top:30px;}</style></head><body>' +
            '<h1>Consulta de preço — Golden Motors</h1><div class="sub">Emitido em ' + hoje + ' · Documento sem valor fiscal</div>' +
            '<table><thead><tr><th>Item</th><th style="text-align:center;">Qtd.</th><th style="text-align:right;">Preço unit.</th><th style="text-align:right;">Subtotal</th></tr></thead><tbody>' +
            linhas + '</tbody></table>' +
            (desc > 0 ? '<div class="desc"><span>Desconto</span><span>- ' + cpMoney(desc) + '</span></div>' : '') +
            '<div class="tot"><span>Total</span><span>' + cpMoney(total) + '</span></div>' +
            '<div class="obs">Esta é uma consulta de preço e não representa uma venda nem reserva de estoque. Valores sujeitos a alteração.</div>' +
            '</body></html>';
          var w = window.open('', '_blank');
          w.document.write(html);
          w.document.close();
          w.focus();
          setTimeout(function () { w.print(); }, 250);
        }
      </script>
    `,
  });
}

module.exports = { consultaPrecoPage };
