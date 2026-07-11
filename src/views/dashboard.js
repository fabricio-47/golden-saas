'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatDate } = require('../utils');

const STATUS_LABELS = {
  aberta: 'Aberta',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
};

function dashboardPage({ user, flash, counts, recentOS, lowBatteryBikes }) {
  const rows = recentOS
    .map(
      (os) => `
    <tr>
      <td><a class="link-btn" href="/os/${os.id}">${escapeHtml(os.numero)}</a></td>
      <td>${escapeHtml(os.cliente_nome)}</td>
      <td>${escapeHtml(os.marca || '')} ${escapeHtml(os.modelo)}</td>
      <td><span class="badge badge-${os.status}">${STATUS_LABELS[os.status] || os.status}</span></td>
      <td>${formatDate(os.data_entrada)}</td>
    </tr>`
    )
    .join('');

  const bikeRows = lowBatteryBikes
    .map(
      (b) => `
    <tr>
      <td><a class="link-btn" href="/bicicletas/${b.id}">${escapeHtml(b.marca || '')} ${escapeHtml(b.modelo)}</a></td>
      <td>${escapeHtml(b.cliente_nome)}</td>
      <td>${b.bateria_soh_percent !== null ? b.bateria_soh_percent + '%' : '-'}</td>
      <td>${b.bateria_ciclos_carga !== null ? b.bateria_ciclos_carga : '-'}</td>
    </tr>`
    )
    .join('');

  return layout({
    title: 'Dashboard',
    activeNav: 'dashboard',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Dashboard</h1>
          <p class="subtitle">Visão geral da sua oficina</p>
        </div>
        <a class="btn" href="/os/novo">+ Nova Ordem de Serviço</a>
      </div>

      <div class="stat-grid">
        <div class="stat-card"><div class="num">${counts.aberta}</div><div class="label">O.S. Abertas</div></div>
        <div class="stat-card"><div class="num">${counts.em_andamento}</div><div class="label">Em Andamento</div></div>
        <div class="stat-card"><div class="num">${counts.concluida}</div><div class="label">Concluídas</div></div>
        <div class="stat-card"><div class="num">${counts.clientes}</div><div class="label">Clientes</div></div>
        <div class="stat-card"><div class="num">${counts.bicicletas}</div><div class="label">Bicicletas cadastradas</div></div>
      </div>

      <div class="card">
        <h2>Ordens de Serviço recentes</h2>
        ${
          recentOS.length
            ? `<table>
          <thead><tr><th>Número</th><th>Cliente</th><th>Bicicleta</th><th>Status</th><th>Entrada</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
            : '<div class="empty">Nenhuma ordem de serviço ainda. <a class="link-btn" href="/os/novo">Criar a primeira</a></div>'
        }
      </div>

      <div class="card">
        <h2>⚠ Baterias que merecem atenção (SOH abaixo de 90%)</h2>
        ${
          lowBatteryBikes.length
            ? `<table>
          <thead><tr><th>Bicicleta</th><th>Cliente</th><th>Saúde da bateria (SOH)</th><th>Ciclos de carga</th></tr></thead>
          <tbody>${bikeRows}</tbody>
        </table>`
            : '<div class="empty">Nenhuma bicicleta com bateria em atenção no momento.</div>'
        }
      </div>
    `,
  });
}

module.exports = { dashboardPage, STATUS_LABELS };
