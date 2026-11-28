'use strict';

const { escapeHtml } = require('../utils');
const { version: APP_VERSION } = require('../../package.json');
const { hasManagementAccess, nivelNome, userCanAccessModulo } = require('../roles');
const { somenteCrm } = require('../crmSegmentos');

const STYLE = `
  :root {
    --bg-dark: #14140f;
    --bg-darker: #0d0d0a;
    --gold: #d4af37;
    --gold-soft: #e8cf7a;
    --bg-light: #f7f6f3;
    --text-light: #f5f3ec;
    --text-muted: #a8a297;
    --text-dark: #23221c;
    --border: #2a2a22;
    --card: #1c1c15;
    --danger: #c0503f;
    --ok: #4f9d69;
    --warn: #c98a2c;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg-light);
    color: var(--text-dark);
  }
  a { color: inherit; text-decoration: none; }
  .app-shell { display: flex; min-height: 100vh; }
  .sidebar {
    width: 240px;
    background: var(--bg-dark);
    color: var(--text-light);
    display: flex;
    flex-direction: column;
    padding: 24px 0;
    flex-shrink: 0;
  }
  .brand {
    font-size: 20px;
    font-weight: 700;
    padding: 0 24px 24px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 16px;
    letter-spacing: 0.5px;
  }
  .brand span { color: var(--gold); }
  .nav-item {
    padding: 12px 24px;
    font-size: 14px;
    color: var(--text-muted);
    border-left: 3px solid transparent;
    display: block;
  }
  .nav-item:hover { color: var(--text-light); background: rgba(255,255,255,0.03); }
  .nav-item.active { color: var(--gold-soft); border-left-color: var(--gold); background: rgba(212,175,55,0.08); font-weight: 600; }
  .nav-group summary {
    cursor: pointer;
    padding: 12px 24px;
    font-size: 14px;
    color: var(--text-muted);
    display: flex;
    justify-content: space-between;
    align-items: center;
    list-style: none;
  }
  .nav-group summary::-webkit-details-marker { display: none; }
  .nav-group summary:hover { color: var(--text-light); background: rgba(255,255,255,0.03); }
  .nav-group summary:after { content: '▸'; font-size: 10px; transition: transform 0.15s; }
  .nav-group[open] summary:after { transform: rotate(90deg); }
  .nav-item.nav-sub { padding-left: 40px; font-size: 13px; }
  .sidebar-footer { margin-top: auto; padding: 16px 24px 0; border-top: 1px solid var(--border); }
  .sidebar-user { font-size: 13px; color: var(--text-muted); margin-bottom: 8px; }
  .sidebar-role { font-size: 11px; color: var(--gold-soft); margin-bottom: 8px; }
  .btn-logout { font-size: 13px; color: var(--gold-soft); }
  .sidebar-version { font-size: 11px; color: var(--text-muted); margin-top: 12px; opacity: 0.7; }
  .main { flex: 1; padding: 32px 40px; max-width: 1100px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  h2 { font-size: 18px; margin: 0 0 16px; }
  .subtitle { color: #6b6558; margin: 0 0 24px; font-size: 14px; }
  .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; flex-wrap: wrap; gap: 12px; }
  .btn {
    display: inline-block;
    background: var(--gold);
    color: #1a1a12;
    padding: 10px 18px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    border: none;
    cursor: pointer;
  }
  .btn:hover { background: var(--gold-soft); }
  .btn-secondary { background: #e5e2d8; color: var(--text-dark); }
  .btn-secondary:hover { background: #d8d4c6; }
  .btn-danger { background: var(--danger); color: white; }
  .btn-sm { padding: 6px 12px; font-size: 13px; }
  .card {
    background: white;
    border: 1px solid #e5e2d8;
    border-radius: 10px;
    padding: 20px 24px;
    margin-bottom: 20px;
  }
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 28px; }
  .stat-card {
    background: var(--bg-dark);
    color: var(--text-light);
    border-radius: 10px;
    padding: 18px 20px;
  }
  .stat-card { min-width: 0; overflow: hidden; }
  .stat-card .num { font-size: 28px; font-weight: 700; color: var(--gold-soft); white-space: nowrap; }
  .stat-card .label { font-size: 13px; color: var(--text-muted); margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; padding: 10px 12px; color: #6b6558; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 2px solid #e5e2d8; }
  td { padding: 12px; border-bottom: 1px solid #efece3; vertical-align: top; }
  tr:hover td { background: #fbfaf6; }
  .empty { color: #8a8474; padding: 24px; text-align: center; font-size: 14px; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
  .badge-orcamento { background: #fde8d8; color: var(--warn); }
  .badge-execucao { background: #dbe9f5; color: #2c6ea8; }
  .badge-concluida { background: #dcf0e2; color: var(--ok); }
  .badge-ok { background: #dcf0e2; color: var(--ok); }
  .badge-atencao { background: #fbe3d8; color: var(--danger); }
  .badge-desativada { background: #e5e2d8; color: #6b6558; }
  .badge-role { background: #e8e4d8; color: #4a463b; }
  .media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; margin-top: 12px; }
  .media-item { position: relative; border-radius: 8px; overflow: hidden; border: 1px solid #e5e2d8; background: #000; aspect-ratio: 1 / 1; }
  .media-item img, .media-item video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .media-item .media-del { position: absolute; top: 4px; right: 4px; background: rgba(0,0,0,0.6); color: #fff; border: none; border-radius: 4px; width: 22px; height: 22px; font-size: 12px; cursor: pointer; }
  .upload-box { border: 2px dashed #d8d4c6; border-radius: 8px; padding: 16px; text-align: center; }
  .upload-box input[type=file] { width: 100%; }
  .value-breakdown { display: flex; gap: 24px; flex-wrap: wrap; }
  .value-breakdown .item { flex: 1; min-width: 140px; }
  form .field { margin-bottom: 16px; }
  label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: #4a463b; }
  input[type=text], input[type=email], input[type=tel], input[type=number], input[type=password], textarea, select {
    width: 100%; padding: 10px 12px; border: 1px solid #d8d4c6; border-radius: 6px; font-size: 14px; font-family: inherit; background: white;
  }
  textarea { min-height: 80px; resize: vertical; }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 20px; }
  .form-grid .field.full { grid-column: 1 / -1; }
  .flash { padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 14px; }
  .flash-success { background: #dcf0e2; color: #1f6b3a; }
  .flash-error { background: #fbdcd6; color: #9a2f1f; }
  .checklist-row { display: grid; grid-template-columns: 2fr 1fr 2fr; gap: 12px; align-items: center; padding: 10px 0; border-bottom: 1px solid #efece3; }
  .checklist-row label.item-name { font-weight: 500; color: var(--text-dark); margin: 0; }
  .radio-group { display: flex; gap: 14px; font-size: 13px; font-weight: 400; }
  .radio-group label { display: flex; align-items: center; gap: 4px; font-weight: 400; margin: 0; }
  .radio-group input { width: auto; }
  .login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg-dark); }
  .login-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 40px; width: 360px; }
  .login-card h1 { color: var(--text-light); text-align: center; margin-bottom: 4px; }
  .login-card .gold { color: var(--gold); }
  .login-card .subtitle { color: var(--text-muted); text-align: center; margin-bottom: 28px; }
  .login-card label { color: var(--text-muted); }
  .login-card .hint { margin-top: 16px; font-size: 12px; color: var(--text-muted); text-align: center; }
  .actions-row { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; }
  .muted { color: #8a8474; font-size: 13px; }
  .link-btn { color: #2c6ea8; font-size: 13px; }

  /* --- campo de arquivo com texto em português (o navegador sempre mostra
     "Choose File / No file chosen" em inglês, então disfarçamos com um botão
     próprio por cima do input real, que continua funcionando normalmente) --- */
  .file-input-ptbr { position: relative; display: flex; align-items: center; gap: 10px; min-height: 40px; }
  .file-input-ptbr input[type=file] { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; margin: 0; }
  .file-input-btn { background: #e5e2d8; color: var(--text-dark); padding: 9px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; white-space: nowrap; flex-shrink: 0; }
  .file-input-name { font-size: 13px; color: #6b6558; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* --- menu mobile (off-canvas) --- */
  .nav-toggle-checkbox { display: none; }
  .mobile-topbar { display: none; }
  .nav-overlay { display: none; }

  @media (max-width: 720px) {
    .mobile-topbar {
      display: flex;
      align-items: center;
      gap: 12px;
      background: var(--bg-dark);
      color: var(--text-light);
      padding: 14px 16px;
      position: sticky;
      top: 0;
      z-index: 40;
    }
    .hamburger-btn {
      font-size: 22px;
      line-height: 1;
      cursor: pointer;
      padding: 4px 10px;
      border-radius: 6px;
      user-select: none;
    }
    .hamburger-btn:active { background: rgba(255,255,255,0.08); }
    .mobile-topbar-brand { font-weight: 700; letter-spacing: 0.5px; font-size: 16px; }
    .mobile-topbar-brand span { color: var(--gold); }

    .app-shell { flex-direction: column; min-height: 100vh; }

    .sidebar {
      position: fixed;
      top: 0;
      bottom: 0;
      left: -280px;
      width: 260px;
      z-index: 50;
      transition: left 0.2s ease;
      overflow-y: auto;
      padding: 16px 0;
    }
    .nav-toggle-checkbox:checked ~ .sidebar { left: 0; box-shadow: 4px 0 24px rgba(0,0,0,0.35); }

    .nav-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.45);
      z-index: 45;
    }
    .nav-toggle-checkbox:checked ~ .nav-overlay { display: block; }

    .sidebar .nav-item, .sidebar .nav-group summary { padding: 14px 24px; }

    .main { padding: 16px; }
    .form-grid { grid-template-columns: 1fr; }
    .checklist-row { grid-template-columns: 1fr; }
    .value-breakdown { gap: 16px; }

    table { display: block; overflow-x: auto; white-space: nowrap; -webkit-overflow-scrolling: touch; }

    .login-wrap { padding: 16px; }
    .login-card { width: 100%; max-width: 360px; padding: 28px 22px; }
  }
`;

// Assistente de IA (canto inferior direito). Conversa fica só nesta aba (sessionStorage).
const IA_WIDGET = String.raw`
<style>
  #ia-btn{position:fixed;right:18px;bottom:18px;z-index:9998;background:#111;color:#d4af37;border:1px solid #d4af37;border-radius:24px;padding:10px 16px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);font-size:14px}
  #ia-box{position:fixed;right:18px;bottom:70px;z-index:9999;width:380px;max-width:calc(100vw - 24px);height:540px;max-height:calc(100vh - 100px);background:#fff;border:1px solid #ddd;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden}
  #ia-box.aberto{display:flex}
  #ia-top{background:#111;color:#fff;padding:10px 12px;display:flex;align-items:center;gap:8px;font-weight:700}
  #ia-top span{color:#d4af37}
  #ia-top button{margin-left:auto;background:none;border:none;color:#ccc;cursor:pointer;font-size:12px}
  #ia-msgs{flex:1;overflow-y:auto;padding:12px;background:#f7f6f2;font-size:14px;line-height:1.45}
  .ia-m{margin:0 0 10px;padding:8px 10px;border-radius:10px;max-width:92%;white-space:pre-wrap;word-wrap:break-word}
  .ia-u{background:#111;color:#fff;margin-left:auto}
  .ia-a{background:#fff;border:1px solid #e5e2d8;color:#222}
  #ia-form{display:flex;gap:6px;padding:8px;border-top:1px solid #eee;background:#fff}
  #ia-form textarea{flex:1;resize:none;height:44px;border:1px solid #ccc;border-radius:8px;padding:8px;font:inherit;font-size:14px}
  #ia-form button{background:#d4af37;color:#111;border:none;border-radius:8px;padding:0 14px;font-weight:700;cursor:pointer}
  @media print{#ia-btn,#ia-box{display:none!important}}
</style>
<button id="ia-btn" type="button" title="Tire dúvidas e peça sugestões">&#10024; Assistente</button>
<div id="ia-box" role="dialog" aria-label="Assistente">
  <div id="ia-top">&#10024; Assistente <span>Golden</span><button type="button" id="ia-limpar">limpar conversa</button></div>
  <div id="ia-msgs"></div>
  <form id="ia-form"><textarea id="ia-txt" placeholder="Pergunte algo (Enter envia)"></textarea><button type="submit">Enviar</button></form>
</div>
<script>
(function(){
  var K='ia_conversa', box=document.getElementById('ia-box'), msgs=document.getElementById('ia-msgs'), txt=document.getElementById('ia-txt'), form=document.getElementById('ia-form');
  var conversa=[]; try{conversa=JSON.parse(sessionStorage.getItem(K)||'[]')}catch(e){}
  var ocupado=false, csrf=null;
  function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  function fmt(s){return esc(s).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/(^|\s)(\/[a-z0-9\-\/]+)/g,'$1<a href="$2">$2</a>')}
  function desenha(){
    if(!conversa.length){msgs.innerHTML='<div class="ia-m ia-a">Oi! Posso tirar dúvidas de como usar o sistema e, se você for da gerência, analisar os números e sugerir o que fazer. Ex.: "quem está com parcela da locação vencida?" ou "como dou baixa numa venda?"</div>';return}
    msgs.innerHTML=conversa.map(function(m){return '<div class="ia-m '+(m.role==='user'?'ia-u':'ia-a')+'">'+fmt(m.content)+'</div>'}).join('')+(ocupado?'<div class="ia-m ia-a">pensando…</div>':'');
    msgs.scrollTop=msgs.scrollHeight;
  }
  function salva(){try{sessionStorage.setItem(K,JSON.stringify(conversa.slice(-30)))}catch(e){}}
  function token(){return csrf?Promise.resolve(csrf):fetch('/ia/token',{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){csrf=j.csrf;return csrf})}
  document.getElementById('ia-btn').onclick=function(){box.classList.toggle('aberto');desenha();if(box.classList.contains('aberto'))txt.focus()};
  document.getElementById('ia-limpar').onclick=function(){conversa=[];salva();desenha()};
  txt.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit()}});
  form.onsubmit=function(e){
    e.preventDefault(); var t=txt.value.trim(); if(!t||ocupado)return;
    conversa.push({role:'user',content:t}); txt.value=''; ocupado=true; desenha(); salva();
    token().then(function(c){
      var b=new URLSearchParams(); b.set('csrf',c); b.set('mensagens',JSON.stringify(conversa.slice(-20)));
      return fetch('/ia/chat',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:b.toString()});
    }).then(function(r){return r.json()}).then(function(j){
      conversa.push({role:'assistant',content:j.texto||j.erro||'(sem resposta)'});
    }).catch(function(){conversa.push({role:'assistant',content:'Falhou a conexão. Tente de novo.'});csrf=null})
    .then(function(){ocupado=false;salva();desenha()});
  };
})();
</script>`;

function layout({ title, activeNav, user, flash, children }) {
  const canManage = hasManagementAccess(user);
  // Módulo de cada item do menu — usado pra esconder links que o usuário
  // não tem acesso, em vez de deixar link morto que dá 403 ao clicar.
  // 'contratos' não é um módulo (não tem checkbox em Níveis de permissão),
  // por isso fica sempre visível, igual já era o comportamento no backend.
  const podeVer = (modulo) => !modulo || userCanAccessModulo(user, modulo);
  const gestLoc = canManage || podeVer('locacao_gestao');
  // Ordem e agrupamento do menu inspirados no padrão de ERPs de gestão
  // (Cadastros / Vendas / Ordens de serviço / Estoque / Financeiro / Contratos / Configurações).
  // Cada entrada é um link solto ('link') ou um grupo expansível ('group');
  // a ordem deste array é exatamente a ordem exibida na barra lateral.
  const navEntries = [
    { type: 'link', key: 'dashboard', href: '/', label: 'Dashboard', modulo: 'painel' },
    ...(podeVer('crm')
      ? [{
          type: 'group',
          key: 'crm-group',
          label: 'CRM',
          items: [
            { key: 'crm-dia', href: '/crm', label: 'Meu dia' },
            { key: 'crm-funil', href: '/crm/funil', label: 'Funil' },
            { key: 'crm-leads', href: '/crm/leads', label: 'Leads' },
            { key: 'crm-followups', href: '/crm/follow-ups', label: 'Follow-ups' },
            { key: 'crm-propostas', href: '/crm/propostas', label: 'Propostas' },
            { key: 'crm-respostas', href: '/crm/respostas', label: 'Respostas rápidas' },
            ...(canManage ? [{ key: 'crm-origens', href: '/crm/origens', label: 'Origem e resultados' }, { key: 'crm-config', href: '/crm/config', label: 'Configurar CRM' }] : []),
          ],
        }]
      : []),
    {
      type: 'group',
      key: 'cadastros-group',
      label: 'Cadastros',
      items: [
        { key: 'clientes', href: '/clientes', label: 'Clientes', modulo: 'clientes' },
        { key: 'fornecedores', href: '/fornecedores', label: 'Fornecedores', modulo: 'estoque' },
        { key: 'funcionarios', href: '/funcionarios', label: 'Funcionários', modulo: null },
        { key: 'transportadoras', href: '/transportadoras', label: 'Transportadoras', modulo: 'estoque' },
        { key: 'bicicletas', href: '/bicicletas', label: 'Veículos', modulo: 'bicicletas' },
      ].filter((item) => podeVer(item.modulo)),
    },
    {
      type: 'group',
      key: 'itens-group',
      label: 'Itens',
      items: [
        { key: 'estoque', href: '/estoque', label: 'Produtos', modulo: 'estoque' },
        { key: 'servicos', href: '/servicos', label: 'Serviços', modulo: 'os' },
        { key: 'etiquetas', href: '/etiquetas', label: 'Etiquetas (cód. barras)', modulo: 'estoque' },
      ].filter((item) => podeVer(item.modulo)),
    },
    { type: 'link', key: 'orcamentos', href: '/orcamentos', label: 'Orçamentos', modulo: 'vendas' },
    {
      type: 'group',
      key: 'vendas-group',
      label: 'Vendas',
      items: [
        { key: 'vendas', href: '/vendas', label: 'Balcão', modulo: 'vendas' },
        { key: 'consulta-preco', href: '/consulta-preco', label: 'Consulta de preço', modulo: 'vendas' },
      ].filter((item) => podeVer(item.modulo)),
    },
    {
      type: 'group',
      key: 'os-group',
      label: 'Ordens de serviços',
      items: [
        { key: 'os', href: '/os', label: 'Gerenciar O.S.', modulo: 'os' },
        { key: 'os-painel', href: '/os/painel', label: 'Painel', modulo: 'os' },
        { key: 'garantias', href: '/garantias', label: 'Garantias', modulo: 'os' },
      ].filter((item) => podeVer(item.modulo)),
    },
    ...((process.env.LOCACAO_ENABLED === '1' || process.env.LOCACAO_ENABLED === 'true') && podeVer('locacao')
      ? [{ type: 'group', key: 'locacao-group', label: 'Locação', items: [...(gestLoc ? [{ key: 'locacao-painel', href: '/locacao', label: 'Painel' }] : []), { key: 'frota', href: '/frota', label: 'Frota / alugar' }, { key: 'locacoes', href: '/locacoes', label: 'Locações' }, { key: 'agendamentos', href: '/frota/agendamentos', label: 'Agendamentos' }, { key: 'documentos-locacao', href: '/frota/documentos', label: 'Contratos/Documentos' }, ...(gestLoc ? [{ key: 'cobranca', href: '/frota/cobranca', label: 'Cobrança' }, { key: 'agenda-cobranca', href: '/frota/agenda-cobranca', label: 'Agenda de cobrança' }, { key: 'despesas-frota', href: '/frota/despesas', label: 'Despesas' }, { key: 'revisoes', href: '/frota/revisoes', label: 'Revisões' }, { key: 'lucratividade', href: '/frota/relatorios', label: 'Lucratividade' }, { key: 'faturamento-mensal', href: '/frota/faturamento-mensal', label: 'Faturamento mensal' }, { key: 'contratos-modelos', href: '/frota/contratos-modelos', label: 'Modelos de contrato' }] : [])] }]
      : []),
    {
      type: 'group',
      key: 'estoque-group',
      label: 'Estoque',
      items: [
        { key: 'entrada-estoque', href: '/estoque/entrada', label: 'Registrar Entrada', modulo: 'estoque', soGerencia: true },
        { key: 'transferencias', href: '/transferencias', label: 'Transferências', modulo: 'estoque' },
      ].filter((item) => podeVer(item.modulo) && (!item.soGerencia || canManage)),
    },
    {
      type: 'group',
      key: 'financeiro-group',
      label: 'Financeiro',
      items: [
        { key: 'financeiro-resumo', href: '/financeiro', label: 'Visão geral', modulo: 'financeiro' },
        { key: 'caixa-especie', href: '/financeiro/caixa-especie', label: 'Caixa em espécie', modulo: 'financeiro' },
        { key: 'contas-pagar', href: '/contas-pagar', label: 'Contas a Pagar', modulo: 'financeiro' },
        { key: 'contas-receber', href: '/contas-receber', label: 'Contas a Receber', modulo: 'financeiro' },
      ].filter((item) => podeVer(item.modulo)),
    },
    { type: 'link', key: 'contratos', href: '/contratos', label: 'Contratos', modulo: null },
  ]
    .filter((entry) => (entry.type === 'link' ? podeVer(entry.modulo) : entry.items.length > 0));

  if (canManage) {
    navEntries.push({ type: 'link', key: 'relatorios', href: '/relatorios', label: 'Relatórios' });
    navEntries.push({
      type: 'group',
      key: 'config-group',
      label: 'Configurações',
      items: [
        { key: 'config-caixa', href: '/configuracoes/caixa', label: 'Caixa' },
        { key: 'config-fiscal', href: '/configuracoes/fiscal', label: 'Fiscal / Nota Fiscal' },
        { key: 'catalogo-config', href: '/catalogo/config', label: 'Catálogo digital' },
        { key: 'campos-extras', href: '/campos-extras', label: 'Campos extras (clientes)' },
        { key: 'lojas', href: '/lojas', label: 'Lojas' },
        { key: 'usuarios', href: '/usuarios', label: 'Usuários' },
        { key: 'niveis', href: '/niveis', label: 'Níveis de permissão' },
        { key: 'auditoria', href: '/auditoria', label: 'Auditoria' },
        { key: 'backup', href: '/backup', label: 'Backup' },
      ],
    });
  }

  // Instalação vendida só com o CRM (SOMENTE_CRM=1): mostra apenas CRM, Clientes e o essencial de Configurações.
  if (somenteCrm()) {
    const manter = { 'crm-group': null, 'cadastros-group': ['clientes'], 'config-group': ['usuarios', 'niveis', 'auditoria', 'backup'] };
    for (let i = navEntries.length - 1; i >= 0; i--) {
      const e = navEntries[i];
      if (!(e.key in manter)) { navEntries.splice(i, 1); continue; }
      if (manter[e.key]) e.items = e.items.filter((it) => manter[e.key].includes(it.key));
    }
  }

  const navHtml = navEntries
    .map((entry) => {
      if (entry.type === 'link') {
        return `<a class="nav-item ${entry.key === activeNav ? 'active' : ''}" href="${entry.href}">${entry.label}</a>`;
      }
      const groupHasActive = entry.items.some((item) => item.key === activeNav);
      const itemsHtml = entry.items
        .map(
          (item) =>
            `<a class="nav-item nav-sub ${item.key === activeNav ? 'active' : ''}" href="${item.href}">${item.label}</a>`
        )
        .join('');
      return `<details class="nav-group" ${groupHasActive ? 'open' : ''}>
        <summary>${entry.label}</summary>
        ${itemsHtml}
      </details>`;
    })
    .join('');

  const flashHtml = flash
    ? `<div class="flash flash-${flash.type}">${escapeHtml(flash.message)}</div>`
    : '';

  const roleLabelHtml = user ? `<div class="sidebar-role">${escapeHtml(nivelNome(user))}</div>` : '';

  const licencaBanner = user && user.licencaAviso
    ? `<div class="flash" style="background:${user.licencaAviso.critico ? '#fbe2d6' : '#fdf3d6'};color:#7a5200;border:1px solid ${user.licencaAviso.critico ? '#e0a090' : '#e6d49a'};">${escapeHtml(user.licencaAviso.texto)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} · Golden SaaS</title>
  <link rel="manifest" href="/manifest.webmanifest">
  <meta name="theme-color" content="#111111">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Golden SaaS">
  <link rel="icon" type="image/png" href="/icon-192.png">
  <link rel="apple-touch-icon" href="/icon-192.png">
  <style>${STYLE}</style>
</head>
<body>
  <div class="app-shell">
    <input type="checkbox" id="nav-toggle" class="nav-toggle-checkbox">
    <div class="mobile-topbar">
      <label for="nav-toggle" class="hamburger-btn" aria-label="Abrir menu">&#9776;</label>
      <div class="mobile-topbar-brand">Golden<span>SaaS</span></div>
      <button type="button" onclick="location.reload()" aria-label="Atualizar" title="Atualizar" style="margin-left:auto;background:none;border:none;color:inherit;font-size:22px;cursor:pointer;line-height:1;">&#128260;</button>
    </div>
    <label for="nav-toggle" class="nav-overlay" aria-hidden="true"></label>
    <aside class="sidebar">
      <div class="brand">Golden<span>SaaS</span></div>
      <nav>${navHtml}</nav>
      <div class="sidebar-footer">
        <button type="button" onclick="location.reload()" title="Recarregar a tela e pegar os dados mais novos" style="width:100%;margin-bottom:10px;padding:8px;background:rgba(255,255,255,0.08);color:#fff;border:1px solid rgba(255,255,255,0.18);border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">&#128260; Atualizar</button>
        <div class="sidebar-user">${escapeHtml(user ? user.name : '')}</div>
        ${roleLabelHtml}
        <form method="POST" action="/logout"><button class="btn-logout" style="background:none;border:none;cursor:pointer;padding:0;">Sair</button></form>
        <div class="sidebar-version">Golden SaaS v${escapeHtml(APP_VERSION)}</div>
      </div>
    </aside>
    <main class="main">
      ${licencaBanner}
      ${flashHtml}
      ${children}
    </main>
  </div>
  <script>
    (function () {
      document.querySelectorAll('input[type=file]').forEach(function (input) {
        if (input.dataset.ptbrWrapped) return;
        input.dataset.ptbrWrapped = '1';

        var wrap = document.createElement('div');
        wrap.className = 'file-input-ptbr';
        input.parentNode.insertBefore(wrap, input);

        var btn = document.createElement('span');
        btn.className = 'file-input-btn';
        btn.textContent = 'Escolher arquivo';

        var nome = document.createElement('span');
        nome.className = 'file-input-name';
        nome.textContent = 'Nenhum arquivo selecionado';

        wrap.appendChild(btn);
        wrap.appendChild(nome);
        wrap.appendChild(input);

        input.addEventListener('change', function () {
          if (!input.files || input.files.length === 0) {
            nome.textContent = 'Nenhum arquivo selecionado';
          } else if (input.files.length === 1) {
            nome.textContent = input.files[0].name;
          } else {
            nome.textContent = input.files.length + ' arquivos selecionados';
          }
        });
      });
    })();
  </script>
  <script>
    // Número grande do card (ex.: R$ 689.500,00) diminui a fonte até caber no card.
    (function(){
      function ajusta(){
        document.querySelectorAll('.stat-card .num').forEach(function(el){
          el.style.fontSize='';
          var fs=parseFloat(getComputedStyle(el).fontSize)||28;
          while(el.scrollWidth>el.clientWidth && fs>14){ fs-=1; el.style.fontSize=fs+'px'; }
        });
      }
      ajusta(); window.addEventListener('resize',ajusta);
    })();
  </script>
  ${user ? IA_WIDGET : ''}
  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js').catch(function () {});
      });
    }
  </script>
</body>
</html>`;
}

function loginLayout({ title, error, children }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} · Golden SaaS</title>
  <link rel="manifest" href="/manifest.webmanifest">
  <meta name="theme-color" content="#111111">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Golden SaaS">
  <link rel="icon" type="image/png" href="/icon-192.png">
  <link rel="apple-touch-icon" href="/icon-192.png">
  <style>${STYLE}</style>
</head>
<body>
  <div class="login-wrap">
    <div class="login-card">
      <h1>Golden<span class="gold">SaaS</span></h1>
      <p class="subtitle">O padrão de ouro em gestão de e-bikes</p>
      ${error ? `<div class="flash flash-error">${escapeHtml(error)}</div>` : ''}
      ${children}
      <div class="sidebar-version" style="text-align:center;margin-top:20px;">Golden SaaS v${escapeHtml(APP_VERSION)}</div>
    </div>
  </div>
  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js').catch(function () {});
      });
    }
  </script>
</body>
</html>`;
}

module.exports = { layout, loginLayout };
