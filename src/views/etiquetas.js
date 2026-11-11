'use strict';

const { layout } = require('./layout');
const { escapeHtml } = require('../utils');

function etiquetasPage({ user, flash, pecas, selectedId }) {
  const produtosJson = JSON.stringify(
    (pecas || [])
      .filter((p) => p.codigo_barras)
      .map((p) => ({ id: p.id, nome: p.nome, preco: Number(p.preco_venda) || 0, codigo: p.codigo_barras }))
  );
  const options = (pecas || [])
    .filter((p) => p.codigo_barras)
    .map((p) => `<option value="${p.id}" ${String(p.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(p.nome)} — ${escapeHtml(p.codigo_barras)}</option>`)
    .join('');

  return layout({
    title: 'Etiquetas de código de barras',
    activeNav: 'etiquetas',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Etiquetas de código de barras</h1>
          <p class="subtitle">Gere e imprima etiquetas com o código de barras, nome e preço do produto</p>
        </div>
      </div>

      <div class="card">
        <div class="form-grid">
          <div class="field" style="grid-column: span 2;">
            <label for="etq_produto">Produto</label>
            <select id="etq_produto">
              <option value="">Selecione...</option>
              ${options}
            </select>
            ${options ? '' : '<p class="muted">Nenhum produto com código de barras ainda. Cadastre produtos (o código é gerado automático) para imprimir etiquetas.</p>'}
          </div>
          <div class="field">
            <label for="etq_qtd">Quantidade de etiquetas</label>
            <input type="number" id="etq_qtd" min="1" max="200" value="1">
          </div>
        </div>
        <div class="actions-row">
          <button type="button" class="btn" onclick="etqGerar()">Gerar etiquetas</button>
          <button type="button" class="btn btn-secondary" onclick="etqImprimir()">🖨 Imprimir / salvar PDF</button>
        </div>
      </div>

      <div class="card">
        <h2 style="margin-top:0;">Pré-visualização</h2>
        <div id="etq_preview" style="display:flex;flex-wrap:wrap;gap:10px;"></div>
      </div>

      <script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js"></script>
      <script>
        var ETQ_PRODUTOS = ${produtosJson};
        function etqMoney(v){ return 'R$ ' + (Number(v)||0).toFixed(2).replace('.', ','); }
        function etqFormato(cod){ return (/^[0-9]{13}$/.test(cod)) ? 'EAN13' : 'CODE128'; }
        function etqLabelHtml(prod){
          return '<div class="etq-label" style="border:1px solid #ccc;border-radius:6px;padding:8px 10px;width:230px;text-align:center;background:#fff;color:#000;">' +
            '<div style="font-size:13px;font-weight:600;line-height:1.2;margin-bottom:2px;">' + (prod.nome||'').replace(/</g,'&lt;') + '</div>' +
            '<div style="font-size:15px;font-weight:700;">' + etqMoney(prod.preco) + '</div>' +
            '<svg class="etq-bc" data-code="' + prod.codigo + '"></svg>' +
            '</div>';
        }
        function etqRenderBarcodes(root){
          (root||document).querySelectorAll('.etq-bc').forEach(function(svg){
            try { JsBarcode(svg, svg.getAttribute('data-code'), { format: etqFormato(svg.getAttribute('data-code')), width: 1.6, height: 45, fontSize: 13, margin: 4 }); }
            catch(e){ svg.outerHTML = '<div style="color:#a1352a;font-size:11px;">código inválido</div>'; }
          });
        }
        function etqSelecionado(){
          var id = document.getElementById('etq_produto').value;
          return id ? ETQ_PRODUTOS.find(function(p){ return String(p.id)===String(id); }) : null;
        }
        function etqGerar(){
          var prod = etqSelecionado();
          var prev = document.getElementById('etq_preview');
          if (!prod) { prev.innerHTML = '<p class="muted">Selecione um produto.</p>'; return; }
          var qtd = Math.max(1, Math.min(200, parseInt(document.getElementById('etq_qtd').value,10)||1));
          var html = '';
          for (var i=0;i<qtd;i++) html += etqLabelHtml(prod);
          prev.innerHTML = html;
          etqRenderBarcodes(prev);
        }
        function etqImprimir(){
          var prod = etqSelecionado();
          if (!prod) { alert('Selecione um produto e gere as etiquetas.'); return; }
          var qtd = Math.max(1, Math.min(200, parseInt(document.getElementById('etq_qtd').value,10)||1));
          var labels = '';
          for (var i=0;i<qtd;i++) labels += etqLabelHtml(prod);
          var w = window.open('', '_blank');
          w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiquetas</title>' +
            '<style>body{font-family:Arial,sans-serif;margin:8px;}#wrap{display:flex;flex-wrap:wrap;gap:6px;}.etq-label{page-break-inside:avoid;}</style>' +
            '<scr' + 'ipt src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js"></scr' + 'ipt></head>' +
            '<body><div id="wrap">' + labels + '</div>' +
            '<scr' + 'ipt>window.onload=function(){document.querySelectorAll(".etq-bc").forEach(function(s){try{JsBarcode(s,s.getAttribute("data-code"),{format:(/^[0-9]{13}$/.test(s.getAttribute("data-code"))?"EAN13":"CODE128"),width:1.6,height:45,fontSize:13,margin:4});}catch(e){}});setTimeout(function(){window.print();},350);};</scr' + 'ipt></body></html>');
          w.document.close();
        }
        // gera automático se veio de um produto específico
        if (document.getElementById('etq_produto').value) etqGerar();
      </script>
    `,
  });
}

module.exports = { etiquetasPage };
