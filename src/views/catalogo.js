'use strict';

const { layout } = require('./layout');
const { escapeHtml } = require('../utils');

const CORES_HEX = {
  preto: '#111', branco: '#f4f4f4', cinza: '#9aa0a6', prata: '#c8ccd0', vermelho: '#d1352a',
  azul: '#2a63d1', verde: '#2a9d4a', amarelo: '#e5c010', laranja: '#e8731a', rosa: '#e86aa8',
  roxo: '#7a3fb0', carbono: '#2a2a2a', marrom: '#7a4a1a', dourado: '#c9a227', vinho: '#6e1a2a', bege: '#d8c9a8',
};
function corHex(nome) {
  const k = String(nome || '').toLowerCase().trim();
  for (const c in CORES_HEX) if (k.indexOf(c) !== -1) return CORES_HEX[c];
  return '#c9a227';
}

// Monta o link do WhatsApp (wa.me) com mensagem já preenchida citando o modelo.
function waLink(whatsapp, nome) {
  const num = String(whatsapp || '').replace(/\D/g, '');
  if (!num) return null;
  const numFull = num.length <= 11 ? '55' + num : num;
  const msg = encodeURIComponent('Olá! Tenho interesse no modelo ' + nome + '. Pode me passar o preço?');
  return `https://wa.me/${numFull}?text=${msg}`;
}

function fichaDe(p) {
  return [
    ['Motor', p.ficha_motor],
    ['Autonomia', p.ficha_autonomia],
    ['Velocidade máx.', p.ficha_velocidade],
    ['Bateria', p.ficha_bateria],
    ['Pneu / Aro', p.ficha_pneu],
    ['Peso suportado', p.ficha_peso],
    ['Recarga', p.ficha_recarga],
  ].filter((f) => f[1] && String(f[1]).trim());
}

// Página PÚBLICA do catálogo (cliente abre pelo link, sem login).
function catalogoPublicoPage({ config, produtos }) {
  const c = config || {};
  const titulo = c.catalogo_titulo || 'Catálogo';
  const subtitulo = c.catalogo_subtitulo || 'Catálogo Digital';
  const categorias = [];
  for (const p of produtos) {
    const cat = (p.categoria || '').trim() || 'Outros';
    if (!categorias.includes(cat)) categorias.push(cat);
  }
  const tabs =
    `<button class="cat-tab ativo" data-cat="__todos__" onclick="filtrarCat(this,'__todos__')">TODOS</button>` +
    categorias
      .map((cat) => `<button class="cat-tab" data-cat="${escapeHtml(cat)}" onclick="filtrarCat(this,'${escapeHtml(cat).replace(/'/g, "\\'")}')">${escapeHtml(cat.toUpperCase())}</button>`)
      .join('');

  const cards = produtos
    .map((p) => {
      const cat = (p.categoria || '').trim() || 'Outros';
      const cores = p.cores ? String(p.cores).split('||').filter(Boolean) : [];
      const ficha = fichaDe(p);
      const wa = waLink(c.catalogo_whatsapp, p.nome);
      const fotoHtml = p.foto_caminho
        ? `<img src="/uploads/${escapeHtml(p.foto_caminho)}" alt="${escapeHtml(p.nome)}" loading="lazy">`
        : `<div class="sem-foto">sem foto</div>`;
      const coresHtml = cores.length
        ? `<div class="cores">${cores
            .map((cor) => `<span class="cor-chip"><span class="cor-dot" style="background:${corHex(cor)}"></span>${escapeHtml(cor)}</span>`)
            .join('')}</div>`
        : '';
      const fichaHtml = ficha.length
        ? `<div class="ficha">${ficha
            .map((f) => `<div class="ficha-item"><span>${escapeHtml(f[0])}</span><strong>${escapeHtml(f[1])}</strong></div>`)
            .join('')}</div>`
        : '';
      const selo = p.catalogo_destaque
        ? `<span class="selo">${escapeHtml(p.catalogo_destaque)}</span>`
        : '';
      const botao = wa
        ? `<a class="btn-zap" href="${wa}" target="_blank" rel="noopener">💬 Consultar preço</a>`
        : `<span class="btn-zap btn-zap-off">Consultar preço</span>`;
      return `
      <article class="card" data-cat="${escapeHtml(cat)}">
        <div class="card-foto">${fotoHtml}${selo}</div>
        <div class="card-corpo">
          <h2>${escapeHtml(p.nome)}</h2>
          ${coresHtml}
          ${fichaHtml}
          ${botao}
        </div>
      </article>`;
    })
    .join('');

  const enderecos = [c.catalogo_endereco1, c.catalogo_endereco2]
    .filter((e) => e && e.trim())
    .map((e) => `<div class="endereco">📍 ${escapeHtml(e)}</div>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(titulo)} — ${escapeHtml(subtitulo)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background: #0d0d0f; color: #f3f3f3; padding-bottom: 40px; }
  .topo { background: linear-gradient(180deg,#1a1a1f,#0d0d0f); padding: 20px 16px 12px; border-bottom: 1px solid #26262c; }
  .topo h1 { font-size: 22px; color: #e8c349; letter-spacing: .5px; }
  .topo .sub { font-size: 12px; color: #9a9aa2; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }
  .enderecos { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
  .endereco { font-size: 12.5px; color: #c9c9cf; }
  .tabs { display: flex; gap: 8px; overflow-x: auto; padding: 14px 16px; position: sticky; top: 0; background: #0d0d0f; z-index: 10; border-bottom: 1px solid #1c1c22; }
  .cat-tab { white-space: nowrap; background: #1c1c22; color: #cfcfd6; border: 1px solid #2a2a31; border-radius: 999px; padding: 8px 18px; font-size: 13px; font-weight: 700; cursor: pointer; letter-spacing: .5px; }
  .cat-tab.ativo { background: #e8c349; color: #1a1a1f; border-color: #e8c349; }
  .grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; padding: 16px; max-width: 1100px; margin: 0 auto; }
  .card { background: #17171c; border: 1px solid #26262c; border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; }
  .card-foto { position: relative; background: linear-gradient(180deg,#232329,#141418); aspect-ratio: 4/3; display: flex; align-items: center; justify-content: center; }
  .card-foto img { width: 100%; height: 100%; object-fit: contain; }
  .sem-foto { color: #55555e; font-size: 13px; }
  .selo { position: absolute; bottom: 10px; right: 10px; background: #e8c349; color: #1a1a1f; font-size: 11px; font-weight: 800; padding: 5px 12px; border-radius: 999px; letter-spacing: .5px; }
  .card-corpo { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 10px; }
  .card-corpo h2 { font-size: 20px; color: #fff; }
  .cores { display: flex; flex-wrap: wrap; gap: 10px; }
  .cor-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: #b9b9c0; }
  .cor-dot { width: 14px; height: 14px; border-radius: 50%; border: 1px solid #44444c; display: inline-block; }
  .ficha { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; background: #121217; border: 1px solid #23232a; border-radius: 10px; padding: 10px 12px; }
  .ficha-item { display: flex; flex-direction: column; gap: 1px; font-size: 12px; }
  .ficha-item span { color: #7c7c85; font-size: 10.5px; text-transform: uppercase; letter-spacing: .3px; }
  .ficha-item strong { color: #ececf0; font-size: 13px; }
  .btn-zap { margin-top: 4px; background: linear-gradient(90deg,#e8c349,#d4a92a); color: #1a1a1f; text-align: center; padding: 12px; border-radius: 10px; font-weight: 800; text-decoration: none; font-size: 15px; }
  .btn-zap-off { background: #33333a; color: #8a8a92; }
  .vazio { text-align: center; color: #7c7c85; padding: 60px 20px; }
  .rodape { text-align: center; color: #55555e; font-size: 12px; padding: 24px 16px 0; }
</style>
</head>
<body>
  <div class="topo">
    <h1>${escapeHtml(titulo)}</h1>
    <div class="sub">${escapeHtml(subtitulo)}</div>
    ${enderecos ? `<div class="enderecos">${enderecos}</div>` : ''}
  </div>
  ${categorias.length > 1 ? `<div class="tabs">${tabs}</div>` : ''}
  ${
    produtos.length
      ? `<div class="grade" id="grade">${cards}</div>`
      : `<div class="vazio">Nenhum produto no catálogo ainda.</div>`
  }
  <div class="rodape">Catálogo digital — valores sob consulta.</div>
  <script>
    function filtrarCat(btn, cat) {
      document.querySelectorAll('.cat-tab').forEach(function (t) { t.classList.remove('ativo'); });
      btn.classList.add('ativo');
      document.querySelectorAll('.card').forEach(function (card) {
        card.style.display = (cat === '__todos__' || card.getAttribute('data-cat') === cat) ? '' : 'none';
      });
    }
  </script>
</body>
</html>`;
}

// Tela ADMIN de configuração do catálogo (dentro do sistema).
function catalogoConfigPage({ user, flash, config, csrfToken }) {
  const c = config || {};
  const linkOrigem = c.__origin ? c.__origin + '/catalogo' : '/catalogo';
  return layout({
    title: 'Catálogo digital',
    activeNav: 'catalogo-config',
    user,
    flash,
    children: `
      <div class="page-header"><div><h1>Catálogo digital</h1><p class="subtitle">A vitrine pública que você manda pro cliente. Só aparecem produtos marcados como "Mostrar no catálogo".</p></div></div>
      <div class="card">
        <p style="margin-top:0;">Link do seu catálogo (mande no WhatsApp/Instagram):</p>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
          <code style="background:var(--bg);padding:8px 12px;border-radius:8px;border:1px solid var(--border);font-size:14px;">${escapeHtml(linkOrigem)}</code>
          <a class="btn btn-secondary" href="/catalogo" target="_blank">Abrir catálogo</a>
        </div>
      </div>
      <div class="card">
        <form method="POST" action="/catalogo/config">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field">
              <label for="catalogo_titulo">Nome da loja (título)</label>
              <input type="text" id="catalogo_titulo" name="catalogo_titulo" placeholder="Ex.: Golden Motors" value="${escapeHtml(c.catalogo_titulo || '')}">
            </div>
            <div class="field">
              <label for="catalogo_subtitulo">Subtítulo</label>
              <input type="text" id="catalogo_subtitulo" name="catalogo_subtitulo" placeholder="Ex.: Catálogo Digital" value="${escapeHtml(c.catalogo_subtitulo || '')}">
            </div>
            <div class="field full">
              <label for="catalogo_whatsapp">WhatsApp do botão "Consultar preço" (com DDD)</label>
              <input type="text" id="catalogo_whatsapp" name="catalogo_whatsapp" placeholder="Ex.: 11 98765-4321" value="${escapeHtml(c.catalogo_whatsapp || '')}">
            </div>
            <div class="field">
              <label for="catalogo_endereco1">Endereço 1 (opcional)</label>
              <input type="text" id="catalogo_endereco1" name="catalogo_endereco1" value="${escapeHtml(c.catalogo_endereco1 || '')}">
            </div>
            <div class="field">
              <label for="catalogo_endereco2">Endereço 2 (opcional)</label>
              <input type="text" id="catalogo_endereco2" name="catalogo_endereco2" value="${escapeHtml(c.catalogo_endereco2 || '')}">
            </div>
          </div>
          <div class="actions-row">
            <button class="btn" type="submit">Salvar catálogo</button>
          </div>
        </form>
      </div>
    `,
  });
}

module.exports = { catalogoPublicoPage, catalogoConfigPage };
