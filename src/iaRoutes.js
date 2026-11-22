'use strict';

// Assistente de IA (Claude) dentro do Golden SaaS.
// - Qualquer usuário logado tira dúvidas de uso do sistema.
// - Direção/Gerência que enxerga todas as lojas também recebe análises e
//   sugestões com base nos dados reais: a IA consulta o banco SOMENTE LEITURA
//   (conexão separada com PRAGMA query_only, só SELECT, colunas sensíveis bloqueadas).
// Requer a variável de ambiente ANTHROPIC_API_KEY. IA_MODELO troca o modelo.

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { db } = require('./db');
const { hasManagementAccess, canSeeAllLojas } = require('./roles');

const MODELO = process.env.IA_MODELO || 'claude-sonnet-5-5';
const MAX_VOLTAS = 8; // chamadas de ferramenta por pergunta
const MAX_LINHAS = 200;
const LIMITE_DIA_USUARIO = Number(process.env.IA_LIMITE_DIA || 60); // perguntas por usuário por dia

db.exec(`CREATE TABLE IF NOT EXISTS ia_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  pergunta TEXT,
  tokens_entrada INTEGER,
  tokens_saida INTEGER,
  erro TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

// ----------------------------------------------------------- banco só leitura
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
let dbLeitura = null;
function conexaoLeitura() {
  if (!dbLeitura) {
    dbLeitura = new DatabaseSync(path.join(DATA_DIR, 'golden-saas.db'));
    dbLeitura.exec('PRAGMA query_only = ON;');
  }
  return dbLeitura;
}

// Nada de senha, token, certificado ou chave sai do banco para a IA.
const SENSIVEL = /(password|senha|salt|token|hash|secret|segredo|api_?key|chave_api|certificado|pfx|cookie|session)/i;
const TABELAS_BLOQUEADAS = /^(sessions?|sqlite_.*|convites_acesso)$/i;

function esquemaBanco() {
  const tabelas = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((t) => t.name);
  const linhas = [];
  for (const t of tabelas) {
    if (TABELAS_BLOQUEADAS.test(t)) continue;
    const cols = db.prepare(`PRAGMA table_info("${t.replace(/"/g, '')}")`).all().map((c) => c.name).filter((c) => !SENSIVEL.test(c));
    linhas.push(`${t}(${cols.join(', ')})`);
  }
  return linhas.join('\n');
}

function consultarSql(sql) {
  const q = String(sql || '').trim().replace(/;+\s*$/, '');
  if (!/^(select|with)\b/i.test(q)) return { erro: 'Só é permitido SELECT (ou WITH ... SELECT).' };
  if (q.includes(';')) return { erro: 'Uma consulta por vez, sem ";".' };
  if (/\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex)\b/i.test(q)) return { erro: 'Comando não permitido.' };
  if (SENSIVEL.test(q)) return { erro: 'Consulta toca em coluna sensível (senha/token/certificado). Refaça sem ela.' };
  if (/\b(sessions?|sqlite_master|convites_acesso)\b/i.test(q)) return { erro: 'Tabela não permitida.' };
  if (/\bselect\s+\*|\.\*/i.test(q) && /\busers\b/i.test(q)) return { erro: 'Na tabela users, liste as colunas (ex.: u.id, u.name).' };
  try {
    const rows = conexaoLeitura().prepare(q).all();
    const cortado = rows.length > MAX_LINHAS;
    return { linhas: rows.slice(0, MAX_LINHAS), total: rows.length, cortado };
  } catch (e) {
    return { erro: String(e.message || e) };
  }
}

function resumoNegocio() {
  const r = conexaoLeitura();
  const um = (sql, ...p) => {
    try { const x = r.prepare(sql).get(...p); return x ? Object.values(x)[0] : null; } catch { return null; }
  };
  const hoje = hojeSP();
  const mes = hoje.slice(0, 7);
  return {
    hoje,
    vendas_mes: { qtd: um("SELECT COUNT(*) FROM vendas WHERE substr(created_at,1,7)=? AND status<>'cancelada'", mes), total: um("SELECT COALESCE(SUM(valor_total),0) FROM vendas WHERE substr(created_at,1,7)=? AND status<>'cancelada'", mes) },
    vendas_aguardando_pagamento: um("SELECT COUNT(*) FROM vendas WHERE status='aberta'"),
    os_abertas: um("SELECT COUNT(*) FROM ordens_servico WHERE ativo=1 AND status IN ('orcamento','execucao')"),
    locacoes_ativas: um("SELECT COUNT(*) FROM locacoes WHERE status='ativa'"),
    parcelas_locacao_vencidas: { qtd: um('SELECT COUNT(*) FROM locacao_parcelas WHERE pago=0 AND vencimento < ?', hoje), valor: um('SELECT COALESCE(SUM(valor),0) FROM locacao_parcelas WHERE pago=0 AND vencimento < ?', hoje) },
    recebido_locacao_mes: um('SELECT COALESCE(SUM(valor),0) FROM locacao_parcelas WHERE pago=1 AND substr(data_pagamento,1,7)=?', mes),
    contas_receber_pendentes: um("SELECT COALESCE(SUM(valor),0) FROM contas_receber WHERE status='pendente'"),
    contas_pagar_pendentes: um("SELECT COALESCE(SUM(valor),0) FROM contas_pagar WHERE status='pendente'"),
    negocios_abertos_crm: um("SELECT COUNT(*) FROM crm_negocios WHERE status='aberto'"),
    produtos_sem_estoque: um('SELECT COUNT(*) FROM pecas WHERE quantidade<=0'),
  };
}

// ----------------------------------------------------------- prompt
const GUIA_SISTEMA = `Menu do Golden SaaS (onde fica cada coisa):
- Dashboard (/): visão geral.
- CRM: Meu dia (/crm), Funil, Leads, Follow-ups, Propostas, Respostas rápidas, Origem e resultados, Configurar CRM.
- Cadastros: Clientes, Fornecedores, Funcionários, Transportadoras, Veículos (/bicicletas).
- Itens: Produtos (/estoque), Serviços, Etiquetas (código de barras).
- Orçamentos (/orcamentos): orçamento aprovado pode ser convertido em O.S.
- Vendas: Balcão (/vendas), Consulta de preço. Venda nasce "aberta" (aguardando pagamento); só o caixa dá baixa.
- Ordens de serviço: Gerenciar O.S. (/os), Painel, Garantias. O.S. tem produtos do estoque, serviços (mão de obra), checklist, fotos, diagnóstico. Pode ser desativada (sai de listas e totais, dá pra reativar).
- Locação: Painel (/locacao), Frota / alugar (/frota: modelos e motos por chassi), Locações, Agendamentos, Cobrança (parcelas), Despesas da frota, Revisões, Lucratividade (/frota/relatorios), Modelos de contrato.
- Estoque: Registrar Entrada, Transferências entre lojas.
- Financeiro: Visão geral, Caixa em espécie, Contas a Pagar, Contas a Receber.
- Contratos, Relatórios (/relatorios: O.S., vendas com vendedor, exportação CSV).
- Configurações: Caixa (senha de baixa), Fiscal / Nota Fiscal, Catálogo digital, Campos extras, Lojas, Usuários, Níveis de permissão, Auditoria, Backup.`;

function promptSistema(user, comDados) {
  const empresa = (() => { try { return db.prepare('SELECT catalogo_titulo t FROM config_geral WHERE id=1').get().t; } catch { return null; } })();
  return `Você é o assistente do Golden SaaS${empresa ? ` da empresa "${empresa}"` : ''}, um sistema de gestão para loja/oficina/locação de motos e bicicletas elétricas.
Responda sempre em português do Brasil, direto e curto, como um gerente experiente. Hoje é ${hojeSP()} (horário de Brasília).
Usuário: ${user.name}.

${GUIA_SISTEMA}

Regras:
- Dúvida de uso: diga o caminho no menu e os passos. Se não souber se uma função existe, diga que não tem certeza; não invente tela nem botão.
- Você NÃO altera nada no sistema. Se pedirem para mudar um dado, explique onde o usuário faz isso.
${
  comDados
    ? `- Você pode ler os dados da empresa com as ferramentas. Para números (faturamento, inadimplência, estoque, ranking), SEMPRE consulte antes de responder; nunca chute valor.
- Valores em R$. Datas no banco estão como texto AAAA-MM-DD (created_at/datetime em UTC).
- Ao dar sugestões, baseie em número concreto e aponte a ação (ex.: "cobrar as 6 parcelas vencidas em Locação > Cobrança").
- Aponte problemas que encontrar nos dados (duplicidade, venda aberta há dias, valor zerado, cadastro incompleto), mesmo sem ser perguntado, se for relevante.
- Não exponha dados pessoais além do necessário (CPF, telefone completo) a não ser que peçam.

Tabelas e colunas disponíveis:
${esquemaBanco()}`
    : '- Este usuário não tem acesso aos dados financeiros pela IA: só responda dúvidas de uso. Se pedir número/relatório, indique a tela onde ele vê.'
}`;
}

const FERRAMENTAS = [
  {
    name: 'resumo_negocio',
    description: 'Resumo rápido do momento: vendas do mês, vendas aguardando pagamento, O.S. abertas, locações ativas, parcelas vencidas, contas a pagar/receber, leads, produtos sem estoque.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'consultar_banco',
    description: `Executa UMA consulta SQL SELECT (SQLite) no banco, somente leitura. Retorna até ${MAX_LINHAS} linhas. Use agregações (SUM, COUNT, GROUP BY) em vez de puxar tudo.`,
    input_schema: { type: 'object', properties: { sql: { type: 'string', description: 'Consulta SELECT do SQLite' } }, required: ['sql'] },
  },
];

async function chamarClaude(payload) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(payload),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((json.error && json.error.message) || `Erro ${resp.status} na API da IA`);
  return json;
}

async function responder(user, historico) {
  const comDados = hasManagementAccess(user) && canSeeAllLojas(user);
  const messages = historico.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 8000) }));
  let entrada = 0;
  let saida = 0;
  for (let volta = 0; volta < MAX_VOLTAS; volta++) {
    const r = await chamarClaude({
      model: MODELO,
      max_tokens: 2000,
      system: promptSistema(user, comDados),
      messages,
      ...(comDados ? { tools: FERRAMENTAS } : {}),
    });
    entrada += (r.usage && r.usage.input_tokens) || 0;
    saida += (r.usage && r.usage.output_tokens) || 0;
    messages.push({ role: 'assistant', content: r.content });
    const usos = (r.content || []).filter((b) => b.type === 'tool_use');
    if (r.stop_reason !== 'tool_use' || !usos.length) {
      const texto = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { texto: texto || '(sem resposta)', entrada, saida };
    }
    messages.push({
      role: 'user',
      content: usos.map((u) => {
        let out;
        if (u.name === 'resumo_negocio') out = resumoNegocio();
        else if (u.name === 'consultar_banco') out = consultarSql(u.input && u.input.sql);
        else out = { erro: 'ferramenta desconhecida' };
        return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 60000) };
      }),
    });
  }
  return { texto: 'Precisei de consultas demais para essa pergunta. Tente perguntar de forma mais específica.', entrada, saida };
}

// ----------------------------------------------------------- rotas
async function handleIa(ctx) {
  const { res, pathname, method, body, user, session, h } = ctx;
  if (pathname !== '/ia/chat' && pathname !== '/ia/token') return false;
  const json = (code, obj) => h.send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  // Token CSRF pro widget (só a própria página lê: outro site não consegue ler a resposta).
  if (pathname === '/ia/token') { json(user ? 200 : 401, { csrf: user ? session.csrfToken : null }); return true; }
  if (method !== 'POST') { json(405, { erro: 'Use POST' }); return true; }
  if (!user) { json(401, { erro: 'Faça login de novo.' }); return true; }
  if (!process.env.ANTHROPIC_API_KEY) {
    json(200, { texto: 'O assistente ainda não está ligado: falta configurar a variável ANTHROPIC_API_KEY no Render (Environment).' });
    return true;
  }
  const usadas = db.prepare("SELECT COUNT(*) c FROM ia_log WHERE user_id=? AND date(created_at,'-3 hours')=?").get(user.id, hojeSP()).c;
  if (usadas >= LIMITE_DIA_USUARIO) { json(200, { texto: `Limite de ${LIMITE_DIA_USUARIO} perguntas por dia atingido. Volta amanhã.` }); return true; }
  let historico = [];
  try { historico = JSON.parse(body.mensagens || '[]'); } catch { historico = []; }
  historico = (Array.isArray(historico) ? historico : []).filter((m) => m && m.content).slice(-20);
  while (historico.length && historico[0].role !== 'user') historico.shift();
  if (!historico.length) { json(400, { erro: 'Mensagem vazia.' }); return true; }
  const pergunta = String(historico[historico.length - 1].content).slice(0, 2000);
  try {
    const r = await responder(user, historico);
    db.prepare('INSERT INTO ia_log (user_id, pergunta, tokens_entrada, tokens_saida) VALUES (?,?,?,?)').run(user.id, pergunta, r.entrada, r.saida);
    json(200, { texto: r.texto });
  } catch (e) {
    db.prepare('INSERT INTO ia_log (user_id, pergunta, erro) VALUES (?,?,?)').run(user.id, pergunta, String(e.message || e));
    json(200, { texto: 'Não consegui responder agora (' + String(e.message || e).slice(0, 200) + ').' });
  }
  return true;
}

module.exports = { handleIa, consultarSql, esquemaBanco, resumoNegocio };
