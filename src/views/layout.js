'use strict';

const { escapeHtml } = require('../utils');
const { version: APP_VERSION } = require('../../package.json');
const { hasManagementAccess, nivelNome, userCanAccessModulo } = require('../roles');

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
  .stat-card .num { font-size: 28px; font-weight: 700; color: var(--gold-soft); }
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

function layout({ title, activeNav, user, flash, children }) {
  const canManage = hasManagementAccess(user);
  // Módulo de cada item do menu — usado pra esconder links que o usuário
  // não tem acesso, em vez de deixar link morto que dá 403 ao clicar.
  // 'contratos' não é um módulo (não tem checkbox em Níveis de permissão),
  // por isso fica sempre visível, igual já era o comportamento no backend.
  const podeVer = (modulo) => !modulo || userCanAccessModulo(user, modulo);
  const navItems = [
    { key: 'dashboard', href: '/', label: 'Dashboard', modulo: 'painel' },
    { key: 'clientes', href: '/clientes', label: 'Clientes', modulo: 'clientes' },
    { key: 'bicicletas', href: '/bicicletas', label: 'Veículos', modulo: 'bicicletas' },
    { key: 'os', href: '/os', label: 'Ordens de Serviço', modulo: 'os' },
    { key: 'vendas', href: '/vendas', label: 'Venda Direto', modulo: 'vendas' },
    { key: 'contratos', href: '/contratos', label: 'Contratos', modulo: null },
  ].filter((item) => podeVer(item.modulo));

  const navGroups = [
    {
      key: 'estoque-group',
      label: 'Estoque',
      items: [
        { key: 'estoque', href: '/estoque', label: 'Estoque', modulo: 'estoque' },
        { key: 'entrada-estoque', href: '/estoque/entrada', label: 'Registrar Entrada', modulo: 'estoque' },
        { key: 'transferencias', href: '/transferencias', label: 'Transferências', modulo: 'estoque' },
        { key: 'fornecedores', href: '/fornecedores', label: 'Fornecedores', modulo: 'estoque' },
        { key: 'servicos', href: '/servicos', label: 'Tipos de Serviço', modulo: 'os' },
      ].filter((item) => podeVer(item.modulo)),
    },
    {
      key: 'financeiro-group',
      label: 'Financeiro',
      items: [
        { key: 'contas-pagar', href: '/contas-pagar', label: 'Contas a Pagar', modulo: 'financeiro' },
        { key: 'contas-receber', href: '/contas-receber', label: 'Contas a Receber', modulo: 'financeiro' },
      ].filter((item) => podeVer(item.modulo)),
    },
  ].filter((group) => group.items.length > 0);
  if (canManage) {
    navGroups.push({
      key: 'config-group',
      label: 'Configurações',
      items: [
        { key: 'lojas', href: '/lojas', label: 'Lojas' },
        { key: 'usuarios', href: '/usuarios', label: 'Usuários' },
        { key: 'niveis', href: '/niveis', label: 'Níveis de permissão' },
        { key: 'auditoria', href: '/auditoria', label: 'Auditoria' },
        { key: 'backup', href: '/backup', label: 'Backup' },
      ],
    });
  }

  const navHtml = navItems
    .map(
      (item) =>
        `<a class="nav-item ${item.key === activeNav ? 'active' : ''}" href="${item.href}">${item.label}</a>`
    )
    .join('');

  const navGroupsHtml = navGroups
    .map((group) => {
      const groupHasActive = group.items.some((item) => item.key === activeNav);
      const itemsHtml = group.items
        .map(
          (item) =>
            `<a class="nav-item nav-sub ${item.key === activeNav ? 'active' : ''}" href="${item.href}">${item.label}</a>`
        )
        .join('');
      return `<details class="nav-group" ${groupHasActive ? 'open' : ''}>
        <summary>${group.label}</summary>
        ${itemsHtml}
      </details>`;
    })
    .join('');

  const flashHtml = flash
    ? `<div class="flash flash-${flash.type}">${escapeHtml(flash.message)}</div>`
    : '';

  const roleLabelHtml = user ? `<div class="sidebar-role">${escapeHtml(nivelNome(user))}</div>` : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} · Golden SaaS</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="app-shell">
    <input type="checkbox" id="nav-toggle" class="nav-toggle-checkbox">
    <div class="mobile-topbar">
      <label for="nav-toggle" class="hamburger-btn" aria-label="Abrir menu">&#9776;</label>
      <div class="mobile-topbar-brand">Golden<span>SaaS</span></div>
    </div>
    <label for="nav-toggle" class="nav-overlay" aria-hidden="true"></label>
    <aside class="sidebar">
      <div class="brand">Golden<span>SaaS</span></div>
      <nav>${navHtml}${navGroupsHtml}</nav>
      <div class="sidebar-footer">
        <div class="sidebar-user">${escapeHtml(user ? user.name : '')}</div>
        ${roleLabelHtml}
        <form method="POST" action="/logout"><button class="btn-logout" style="background:none;border:none;cursor:pointer;padding:0;">Sair</button></form>
        <div class="sidebar-version">Golden SaaS v${escapeHtml(APP_VERSION)}</div>
      </div>
    </aside>
    <main class="main">
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
</body>
</html>`;
}

module.exports = { layout, loginLayout };
