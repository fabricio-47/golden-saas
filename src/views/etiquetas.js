'use strict';

const { layout } = require('./layout');
const { escapeHtml } = require('../utils');

function etiquetasPage({ user, flash, pecas, selectedId, config, lojaNome, podeConfigurar, csrfToken }) {
  const cfg = config || {};
  const produtosJson = JSON.stringify(
    (pecas || [])
      .filter((p) => p.codigo_barras)
      .map((p) => ({ id: p.id, nome: p.nome, preco: Number(p.preco_venda) || 0, codigo: p.codigo_barras }))
  );
  const options = (pecas || [])
    .filter((p) => p.codigo_barras)
    .map((p) => `<option value="${p.id}" ${String(p.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(p.nome)} — ${escapeHtml(p.codigo_barras)}</option>`)
    .join('');

  const checked = (v) => (Number(v) ? 'checked' : '');

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
            <select id="etq_produto" onchange="etqGerar()">
              <option value="">Selecione...</option>
              ${options}
            </select>
            ${options ? '' : '<p class="muted">Nenhum produto com código de barras ainda. Cadastre produtos (o código é gerado automático) para imprimir etiquetas.</p>'}
          </div>
          <div class="field">
            <label for="etq_qtd">Quantidade de etiquetas</label>
            <input type="number" id="etq_qtd" min="1" max="200" value="1" onchange="etqGerar()">
          </div>
        </div>
      </div>

      <div class="card">
        <h2 style="margin-top:0;">Configuração da etiqueta</h2>
        <p class="muted" style="margin-top:-6px;">Ajuste e veja na pré-visualização ao lado. ${podeConfigurar ? 'Clique em <strong>Salvar como padrão</strong> para valer em todos os computadores.' : 'Essas opções valem só para esta impressão. O padrão da loja é definido pela direção.'}</p>
        <form method="POST" action="/etiquetas/config" id="etq_form">
          <input type="hidden" name="csrf" value="${escapeHtml(csrfToken || '')}">
          <input type="hidden" name="produto" id="etq_form_produto" value="${escapeHtml(selectedId || '')}">
          <div class="form-grid">
            <div class="field">
              <label for="etq_largura">Largura (mm)</label>
              <input type="number" step="1" min="10" max="200" id="etq_largura" name="etq_largura_mm" value="${escapeHtml(String(cfg.larguraMm))}" oninput="etqGerar()">
            </div>
            <div class="field">
              <label for="etq_altura">Altura (mm)</label>
              <input type="number" step="1" min="8" max="200" id="etq_altura" name="etq_altura_mm" value="${escapeHtml(String(cfg.alturaMm))}" oninput="etqGerar()">
            </div>
            <div class="field">
              <label for="etq_fonte">Tamanho da fonte</label>
              <select id="etq_fonte" name="etq_fonte_px" onchange="etqGerar()">
                <option value="10" ${Number(cfg.fontePx) === 10 ? 'selected' : ''}>Pequena</option>
                <option value="13" ${Number(cfg.fontePx) === 13 ? 'selected' : ''}>Média</option>
                <option value="16" ${Number(cfg.fontePx) === 16 ? 'selected' : ''}>Grande</option>
                <option value="20" ${Number(cfg.fontePx) === 20 ? 'selected' : ''}>Muito grande</option>
              </select>
            </div>
            <div class="field">
              <label for="etq_colunas">Etiquetas por linha</label>
              <select id="etq_colunas" name="etq_colunas" onchange="etqGerar()">
                <option value="0" ${Number(cfg.colunas) === 0 ? 'selected' : ''}>Automático (preenche a largura)</option>
                <option value="1" ${Number(cfg.colunas) === 1 ? 'selected' : ''}>1 por linha (rolo)</option>
                <option value="2" ${Number(cfg.colunas) === 2 ? 'selected' : ''}>2 por linha</option>
                <option value="3" ${Number(cfg.colunas) === 3 ? 'selected' : ''}>3 por linha</option>
                <option value="4" ${Number(cfg.colunas) === 4 ? 'selected' : ''}>4 por linha</option>
                <option value="5" ${Number(cfg.colunas) === 5 ? 'selected' : ''}>5 por linha</option>
              </select>
            </div>
          </div>
          <div class="field" style="margin-top:6px;">
            <label>O que aparece na etiqueta</label>
            <div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:4px;">
              <label style="display:flex;align-items:center;gap:6px;font-weight:normal;"><input type="checkbox" id="etq_mnome" name="etq_mostrar_nome" value="1" ${checked(cfg.mostrarNome)} onchange="etqGerar()"> Nome do produto</label>
              <label style="display:flex;align-items:center;gap:6px;font-weight:normal;"><input type="checkbox" id="etq_mpreco" name="etq_mostrar_preco" value="1" ${checked(cfg.mostrarPreco)} onchange="etqGerar()"> Preço</label>
              <label style="display:flex;align-items:center;gap:6px;font-weight:normal;"><input type="checkbox" id="etq_mcodigo" name="etq_mostrar_codigo" value="1" ${checked(cfg.mostrarCodigo)} onchange="etqGerar()"> Número do código</label>
              <label style="display:flex;align-items:center;gap:6px;font-weight:normal;"><input type="checkbox" id="etq_mloja" name="etq_mostrar_loja" value="1" ${checked(cfg.mostrarLoja)} onchange="etqGerar()"> Nome da loja</label>
            </div>
          </div>
          <div class="actions-row" style="margin-top:12px;">
            <button type="button" class="btn btn-secondary" onclick="etqImprimir()">🖨 Imprimir / salvar PDF</button>
            ${podeConfigurar ? '<button type="submit" class="btn">Salvar como padrão</button>' : ''}
          </div>
        </form>
      </div>

      <div class="card">
        <h2 style="margin-top:0;">Pré-visualização</h2>
        <div id="etq_preview"></div>
      </div>

      <script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js"></script>
      <script>
        var ETQ_PRODUTOS = ${produtosJson};
        var ETQ_LOJA = ${JSON.stringify(lojaNome || 'Golden Motors')};
        function etqMoney(v){ return 'R$ ' + (Number(v)||0).toFixed(2).replace('.', ','); }
        function etqFormato(cod){ return (/^[0-9]{13}$/.test(cod)) ? 'EAN13' : 'CODE128'; }
        function etqChk(id){ var e=document.getElementById(id); return e && e.checked; }
        function etqNum(id, def){ var e=document.getElementById(id); var n=e?parseFloat(String(e.value).replace(',','.')):NaN; return isFinite(n)?n:def; }
        function etqLer(){
          return {
            larguraMm: Math.max(10, Math.min(200, etqNum('etq_largura', 50))),
            alturaMm: Math.max(8, Math.min(200, etqNum('etq_altura', 30))),
            fontePx: Math.max(6, Math.min(40, etqNum('etq_fonte', 13))),
            colunas: Math.max(0, Math.min(10, Math.round(etqNum('etq_colunas', 0)))),
            nome: etqChk('etq_mnome'), preco: etqChk('etq_mpreco'),
            codigo: etqChk('etq_mcodigo'), loja: etqChk('etq_mloja')
          };
        }
        function etqContainerStyle(c){
          if (c.colunas > 0) return 'display:grid;grid-template-columns:repeat(' + c.colunas + ', max-content);gap:6px;';
          return 'display:flex;flex-wrap:wrap;gap:6px;';
        }
        function etqLabelHtml(prod, c){
          var f = c.fontePx;
          var body = '';
          if (c.loja) body += '<div style="font-size:' + Math.round(f*0.7) + 'px;color:#333;line-height:1.1;">' + (ETQ_LOJA||'').replace(/</g,'&lt;') + '</div>';
          if (c.nome) body += '<div style="font-size:' + f + 'px;font-weight:600;line-height:1.1;overflow:hidden;">' + (prod.nome||'').replace(/</g,'&lt;') + '</div>';
          if (c.preco) body += '<div style="font-size:' + Math.round(f*1.15) + 'px;font-weight:700;line-height:1.2;">' + etqMoney(prod.preco) + '</div>';
          body += '<svg class="etq-bc" data-code="' + prod.codigo + '" data-dv="' + (c.codigo?'1':'0') + '" style="max-width:100%;height:auto;display:block;margin:2px auto 0;"></svg>';
          return '<div class="etq-label" style="box-sizing:border-box;border:1px solid #ccc;border-radius:4px;padding:4px 6px;width:' + c.larguraMm + 'mm;height:' + c.alturaMm + 'mm;overflow:hidden;text-align:center;background:#fff;color:#000;display:flex;flex-direction:column;justify-content:center;align-items:stretch;">' + body + '</div>';
        }
        function etqRenderBarcodes(root, c){
          (root||document).querySelectorAll('.etq-bc').forEach(function(svg){
            try {
              JsBarcode(svg, svg.getAttribute('data-code'), {
                format: etqFormato(svg.getAttribute('data-code')),
                width: 1.4, height: Math.max(20, Math.round(c.alturaMm * 1.3)),
                displayValue: svg.getAttribute('data-dv') === '1',
                fontSize: Math.max(9, Math.round(c.fontePx * 0.8)), margin: 2
              });
            } catch(e){ svg.outerHTML = '<div style="color:#a1352a;font-size:11px;">código inválido</div>'; }
          });
        }
        function etqSelecionado(){
          var id = document.getElementById('etq_produto').value;
          var fp = document.getElementById('etq_form_produto'); if (fp) fp.value = id || '';
          return id ? ETQ_PRODUTOS.find(function(p){ return String(p.id)===String(id); }) : null;
        }
        function etqGerar(){
          var prod = etqSelecionado();
          var c = etqLer();
          var prev = document.getElementById('etq_preview');
          prev.setAttribute('style', etqContainerStyle(c));
          if (!prod) { prev.setAttribute('style',''); prev.innerHTML = '<p class="muted">Selecione um produto para ver a etiqueta.</p>'; return; }
          var qtd = Math.max(1, Math.min(200, parseInt(document.getElementById('etq_qtd').value,10)||1));
          var html = '';
          for (var i=0;i<qtd;i++) html += etqLabelHtml(prod, c);
          prev.innerHTML = html;
          etqRenderBarcodes(prev, c);
        }
        function etqImprimir(){
          var prod = etqSelecionado();
          if (!prod) { alert('Selecione um produto primeiro.'); return; }
          var c = etqLer();
          var qtd = Math.max(1, Math.min(200, parseInt(document.getElementById('etq_qtd').value,10)||1));
          var labels = '';
          for (var i=0;i<qtd;i++) labels += etqLabelHtml(prod, c);
          var dvGlobal = c.codigo ? 'true' : 'false';
          var barH = Math.max(20, Math.round(c.alturaMm * 1.3));
          var barFont = Math.max(9, Math.round(c.fontePx * 0.8));
          var w = window.open('', '_blank');
          w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiquetas</title>' +
            '<style>@page{margin:4mm;}body{font-family:Arial,sans-serif;margin:0;padding:4px;}#wrap{' + etqContainerStyle(c) + '}.etq-label{page-break-inside:avoid;}</style>' +
            '<scr' + 'ipt src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js"></scr' + 'ipt></head>' +
            '<body><div id="wrap">' + labels + '</div>' +
            '<scr' + 'ipt>window.onload=function(){document.querySelectorAll(".etq-bc").forEach(function(s){try{JsBarcode(s,s.getAttribute("data-code"),{format:(/^[0-9]{13}$/.test(s.getAttribute("data-code"))?"EAN13":"CODE128"),width:1.4,height:' + barH + ',displayValue:' + dvGlobal + ',fontSize:' + barFont + ',margin:2});}catch(e){}});setTimeout(function(){window.print();},400);};</scr' + 'ipt></body></html>');
          w.document.close();
        }
        // gera automático se já veio um produto selecionado
        if (document.getElementById('etq_produto').value) etqGerar(); else etqGerar();
      </script>
    `,
  });
}

module.exports = { etiquetasPage };
