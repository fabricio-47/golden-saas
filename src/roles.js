'use strict';

// Níveis de acesso do sistema, do mais amplo para o mais restrito.
// Direção e Gerência podem gerenciar usuários e ver o log de auditoria de login;
// Vendedor e Mecânico têm acesso operacional completo (clientes, veículos, O.S.,
// estoque), mas não gerenciam outros usuários nem veem a auditoria.
const ROLES = ['direcao', 'gerencia', 'vendedor', 'mecanico'];

const ROLE_LABELS = {
  direcao: 'Direção',
  gerencia: 'Gerência',
  vendedor: 'Vendedor',
  mecanico: 'Mecânico',
};

function hasManagementAccess(user) {
  return !!user && (user.role === 'direcao' || user.role === 'gerencia');
}

module.exports = { ROLES, ROLE_LABELS, hasManagementAccess };
