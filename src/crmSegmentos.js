'use strict';

// Configurações do CRM por segmento de negócio. Cada instalação escolhe o seu
// em CRM → Configurar CRM (fica salvo em crm_config.segmento).

const SEGMENTOS = {
  moto: {
    nome: 'Loja de motos / mobilidade elétrica',
    emoji: '🛵',
    etapas: [
      ['Novo Lead', '#2f5fd0', 'aberta'],
      ['Abordado', '#e0662f', 'aberta'],
      ['Qualificado', '#d4931f', 'aberta'],
      ['Follow-Up', '#1f8a9a', 'aberta'],
      ['Chamar mais para frente', '#6b6558', 'aberta'],
      ['Ganho (pago)', '#2f8a4f', 'ganho'],
      ['Perdido', '#a1352a', 'perdido'],
      ['Desqualificado', '#8a4a8a', 'desqualificado'],
    ],
    formasPgto: ['PIX', 'Dinheiro', 'Cartão', 'Crediário próprio', 'Locação com compra garantida', 'Outra'],
    motivosFollowup: ['Retorno de proposta', 'Cliente pediu para chamar depois', 'Negociação', 'Financiamento / crediário', 'Test ride / visita', 'Pós-atendimento', 'Outro'],
    motivosPerda: ['Preço', 'Comprou em outro lugar', 'Sem crédito / reprovado', 'Desistiu', 'Sem resposta', 'Sem estoque do modelo', 'Outro'],
    categoriasResposta: ['Apresentação', 'Preço', 'Parcelamento', 'Locação', 'Disponibilidade', 'Localização', 'Test ride', 'Follow-up', 'Pós-venda', 'Personalizado'],
    usaItensOrcamento: false,
    respostasIniciais: [],
  },
  grafica: {
    nome: 'Gráfica / comunicação visual',
    emoji: '🖨️',
    etapas: [
      ['Novo contato', '#2f5fd0', 'aberta'],
      ['Orçamento enviado', '#e0662f', 'aberta'],
      ['Negociação', '#d4931f', 'aberta'],
      ['Arte em aprovação', '#1f8a9a', 'aberta'],
      ['Aprovado / sinal pago', '#2f8a4f', 'ganho'],
      ['Em produção', '#3f7a5a', 'ganho'],
      ['Pronto para retirada', '#4f9d69', 'ganho'],
      ['Entregue', '#5b6b5f', 'ganho'],
      ['Perdido', '#a1352a', 'perdido'],
    ],
    formasPgto: ['PIX', '50% de sinal + 50% na entrega', 'Cartão', 'Boleto', 'Faturado (empresa)', 'Dinheiro', 'Outra'],
    motivosFollowup: ['Retorno de orçamento', 'Aprovação de arte', 'Negociação', 'Aguardando sinal / pagamento', 'Pedido recorrente', 'Pós-entrega', 'Outro'],
    motivosPerda: ['Preço', 'Prazo', 'Fechou com outra gráfica', 'Desistiu do material', 'Sem resposta', 'Não fazemos esse serviço', 'Outro'],
    categoriasResposta: ['Apresentação', 'Orçamento', 'Prazo', 'Arte', 'Pagamento', 'Retirada / entrega', 'Localização', 'Pós-venda', 'Personalizado'],
    usaItensOrcamento: true,
    respostasIniciais: [
      ['Boas-vindas', 'Apresentação', '/oi', 'Olá, {nome}! Aqui é {vendedor}. Me conta o que você precisa imprimir (material, medida e quantidade) que eu já te passo o orçamento. 😊'],
      ['Pedir dados do orçamento', 'Orçamento', '/dados', 'Para te passar o valor certinho, me informa:\n• Material (ex.: lona, adesivo, cartão de visita)\n• Medida ou formato\n• Quantidade\n• Precisa de criação de arte ou você já tem o arquivo?\n• Para quando precisa?'],
      ['Arquivo da arte', 'Arte', '/arquivo', 'Pode mandar o arquivo em PDF ou CDR, com as fontes convertidas em curvas e 3 mm de sangria. Se preferir, a nossa equipe cria a arte para você.'],
      ['Aprovação de arte', 'Arte', '/aprovar', '{nome}, segue a prova da arte. Confere textos, telefones e cores com atenção: depois de aprovada, vai para a produção do jeito que está. Posso seguir?'],
      ['Sinal para produção', 'Pagamento', '/sinal', 'Para colocar em produção, trabalhamos com 50% de sinal e o restante na retirada. Assim que confirmar o PIX, já entra na fila de produção.'],
      ['Pedido pronto', 'Retirada / entrega', '/pronto', 'Oi, {nome}! Seu pedido está pronto para retirada. 🎉 Qualquer coisa é só me chamar.'],
      ['Retorno de orçamento', 'Orçamento', '/retorno', 'Oi, {nome}! Conseguiu ver o orçamento que te mandei? Se quiser, ajusto quantidade ou material para caber no seu orçamento.'],
    ],
  },
};

const UNIDADES_ITEM = { m2: 'm²', un: 'unidade', cento: 'cento', milheiro: 'milheiro', ml: 'metro linear', servico: 'serviço' };

// Total de um item do orçamento. m² usa largura × altura (em metros) × quantidade.
function totalItem(it) {
  const q = Number(it.quantidade) || 0;
  const p = Number(it.preco_unit) || 0;
  let base;
  if (it.unidade === 'm2') base = (Number(it.largura) || 0) * (Number(it.altura) || 0) * q * p;
  else if (it.unidade === 'cento') base = (q / 100) * p;
  else if (it.unidade === 'milheiro') base = (q / 1000) * p;
  else base = q * p;
  const minimo = Number(it.minimo) || 0;
  return Math.round(Math.max(base, minimo) * 100) / 100;
}

module.exports = { SEGMENTOS, UNIDADES_ITEM, totalItem };

// Segmento ativo desta instalação (padrão: moto, que é o comportamento original).
function segmentoAtual() {
  const { db } = require('./db');
  let key = 'moto';
  try {
    const r = db.prepare("SELECT valor FROM crm_config WHERE chave = 'segmento'").get();
    if (r && SEGMENTOS[r.valor]) key = r.valor;
  } catch (e) { /* tabela ainda não criada */ }
  return { key, ...SEGMENTOS[key] };
}

// Nome da empresa para propostas/mensagens: Configurar CRM → senão título do catálogo.
function nomeEmpresa() {
  const { db } = require('./db');
  try {
    const a = db.prepare("SELECT valor FROM crm_config WHERE chave = 'empresa_nome'").get();
    if (a && a.valor && a.valor.trim()) return a.valor.trim();
    const r = db.prepare('SELECT catalogo_titulo FROM config_geral WHERE id = 1').get();
    return r && r.catalogo_titulo ? String(r.catalogo_titulo).trim() : '';
  } catch (e) {
    return '';
  }
}

// Modo "só CRM": instalação vendida apenas com o CRM (ex.: gráfica).
const somenteCrm = () => process.env.SOMENTE_CRM === '1' || process.env.SOMENTE_CRM === 'true';

module.exports.segmentoAtual = segmentoAtual;
module.exports.nomeEmpresa = nomeEmpresa;
module.exports.somenteCrm = somenteCrm;
