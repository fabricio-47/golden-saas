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

// Usuário sem loja_id (Direção/Gerência tipicamente) enxerga todas as lojas.
function canSeeAllLojas(user) {
  return !!user && !user.loja_id;
}

// Pode ver o estoque de uma loja específica: é a própria loja do usuário,
// ou o usuário enxerga todas as lojas, ou tem a permissão explícita de
// ver estoque de outras lojas.
function canSeeLoja(user, lojaId) {
  if (!user) return false;
  if (canSeeAllLojas(user)) return true;
  if (String(user.loja_id) === String(lojaId)) return true;
  return !!user.pode_ver_outras_lojas;
}

// Pode editar/cadastrar/excluir peças de uma loja específica: só a própria
// loja do usuário, ou quem enxerga todas as lojas (Direção/Gerência).
function canEditLoja(user, lojaId) {
  if (!user) return false;
  if (canSeeAllLojas(user)) return true;
  return String(user.loja_id) === String(lojaId);
}

module.exports = { ROLES, ROLE_LABELS, hasManagementAccess, canSeeAllLojas, canSeeLoja, canEditLoja };
