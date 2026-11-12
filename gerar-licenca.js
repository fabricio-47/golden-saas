#!/usr/bin/env node
'use strict';

// Gera o código de liberação da licença do Golden SaaS.
//
// IMPORTANTE: a variável LICENSE_SECRET precisa ser a MESMA que está
// configurada na instância do cliente (no servidor). Sem isso o código
// gerado aqui não vai funcionar lá.
//
// Uso:
//   LICENSE_SECRET="sua-chave-secreta" node gerar-licenca.js 2026-12-31
//   LICENSE_SECRET="sua-chave-secreta" node gerar-licenca.js +30
//
// O primeiro libera até a data exata; o segundo libera por N dias a partir de hoje.

const crypto = require('node:crypto');

const secret = process.env.LICENSE_SECRET || 'golden-saas-chave-padrao-troque-no-servidor';
const arg = process.argv[2];

function assina(ymd) {
  return crypto.createHmac('sha256', secret).update(ymd).digest('hex').slice(0, 8).toUpperCase();
}
function gerar(iso) {
  const ymd = iso.replace(/-/g, '');
  return 'GS-' + ymd + '-' + assina(ymd);
}

if (!arg) {
  console.error('Uso: node gerar-licenca.js AAAA-MM-DD   |   node gerar-licenca.js +30');
  process.exit(1);
}

let iso;
if (/^\+\d+$/.test(arg)) {
  const d = new Date();
  d.setDate(d.getDate() + parseInt(arg.slice(1), 10));
  iso = d.toISOString().slice(0, 10);
} else if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
  iso = arg;
} else {
  console.error('Data inválida. Use AAAA-MM-DD (ex: 2026-12-31) ou +N dias (ex: +30).');
  process.exit(1);
}

if (secret === 'golden-saas-chave-padrao-troque-no-servidor') {
  console.warn('AVISO: você não definiu LICENSE_SECRET. Use a mesma chave do servidor do cliente.\n');
}

console.log('Liberado até: ' + iso);
console.log('Código:       ' + gerar(iso));
