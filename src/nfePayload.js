'use strict';

// Lógica PURA de montagem do corpo da NF-e (sem banco, sem rede) — fácil de
// testar isoladamente. O servidor injeta venda, itens, cliente e config.

function focusCreds(config) {
  const ambiente = config.ambiente === 'producao' ? 'producao' : 'homologacao';
  const token = ambiente === 'producao' ? config.focus_token_producao : config.focus_token_homologacao;
  return { ambiente, token };
}

function soDigitos(s) {
  return String(s || '').replace(/\D/g, '');
}

// ISO 8601 no horário de São Paulo (-03:00, sem horário de verão desde 2019).
function dataEmissaoISO(date = new Date()) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date);
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}-03:00`;
}

// Só mercadorias (peça ou veículo) — serviço em venda seria NFS-e, fica de fora.
function itensMercadoria(itens) {
  return itens.filter((i) => !i.tipo_servico_id);
}

// Monta o corpo da NF-e a partir da venda. Retorna { nfe, erros, creds }.
// Se `erros` tiver algo, a emissão deve ser bloqueada antes de chamar a Focus.
function buildNfePayload(venda, itens, cliente, config) {
  const erros = [];
  const creds = focusCreds(config);
  if (!creds.token) {
    erros.push(`Nenhum token da Focus configurado para o ambiente "${creds.ambiente}". Ajuste em Configurações → Fiscal.`);
  }

  const mercadorias = itensMercadoria(itens);
  if (mercadorias.length === 0) {
    erros.push('A venda não tem itens de mercadoria (peça ou veículo) para emitir NF-e.');
  }

  const docDest = soDigitos((cliente && cliente.cpf_cnpj) || '');
  if (!docDest) erros.push('O cliente não tem CPF/CNPJ cadastrado (obrigatório na NF-e). Edite o cliente.');
  const isCnpj = docDest.length === 14;
  const ufDest = ((cliente && cliente.uf) || '').trim().toUpperCase();
  const codMun = soDigitos((cliente && cliente.codigo_municipio) || '');

  // CFOP padrão: dentro do estado se o destinatário for RJ (ou sem UF),
  // interestadual caso contrário. O CFOP do produto sempre vence quando existe.
  const dentroEstado = !ufDest || ufDest === 'RJ';
  const cfopPadrao = dentroEstado ? config.cfop_padrao : config.cfop_interestadual_padrao || config.cfop_padrao;

  const items = mercadorias.map((it, idx) => {
    const ncm = it.ncm || config.ncm_padrao;
    const cfop = it.cfop || cfopPadrao;
    const csosn = it.csosn || config.csosn_padrao;
    const origem = it.origem_mercadoria != null ? it.origem_mercadoria : config.origem_padrao;
    const unidade = it.unidade_comercial || config.unidade_padrao || 'UN';
    if (!ncm) erros.push(`Item "${it.nome_peca}": NCM não definido (nem no produto, nem no padrão fiscal).`);
    if (!cfop) erros.push(`Item "${it.nome_peca}": CFOP não definido.`);
    if (!csosn) erros.push(`Item "${it.nome_peca}": CSOSN/CST não definido.`);
    const valorUnit = Number(it.preco_unitario) || 0;
    const qtd = Number(it.quantidade) || 1;
    return {
      numero_item: idx + 1,
      codigo_produto: it.peca_id ? `PECA-${it.peca_id}` : it.bicicleta_id ? `VEIC-${it.bicicleta_id}` : `ITEM-${it.id}`,
      descricao: it.nome_peca,
      codigo_ncm: ncm ? soDigitos(ncm) : undefined,
      cfop: cfop ? soDigitos(cfop) : undefined,
      unidade_comercial: unidade,
      quantidade_comercial: qtd,
      valor_unitario_comercial: +valorUnit.toFixed(2),
      valor_bruto: +(qtd * valorUnit).toFixed(2),
      unidade_tributavel: unidade,
      quantidade_tributavel: qtd,
      valor_unitario_tributavel: +valorUnit.toFixed(2),
      icms_origem: Number(origem) || 0,
      icms_situacao_tributaria: csosn || undefined,
    };
  });

  const valorTotal = items.reduce((s, i) => s + (i.valor_bruto || 0), 0);

  const nfe = {
    natureza_operacao: config.natureza_operacao || 'Venda de mercadoria',
    data_emissao: dataEmissaoISO(),
    tipo_documento: 1, // 1 = saída
    finalidade_emissao: 1, // 1 = normal
    consumidor_final: isCnpj ? 0 : 1,
    presenca_comprador: 1, // operação presencial
    regime_tributario_emitente: Number(config.regime_tributario) || 1,
    modalidade_frete: 9, // sem frete
    nome_destinatario: cliente && cliente.nome,
    [isCnpj ? 'cnpj_destinatario' : 'cpf_destinatario']: docDest || undefined,
    indicador_inscricao_estadual_destinatario: isCnpj && cliente && cliente.ie ? 1 : 9,
    inscricao_estadual_destinatario: isCnpj && cliente && cliente.ie ? soDigitos(cliente.ie) : undefined,
    logradouro_destinatario: (cliente && cliente.logradouro) || undefined,
    numero_destinatario: (cliente && cliente.numero) || undefined,
    complemento_destinatario: (cliente && cliente.complemento) || undefined,
    bairro_destinatario: (cliente && cliente.bairro) || undefined,
    municipio_destinatario: (cliente && cliente.municipio) || undefined,
    codigo_municipio_destinatario: codMun || undefined,
    uf_destinatario: ufDest || undefined,
    cep_destinatario: cliente && cliente.cep ? soDigitos(cliente.cep) : undefined,
    valor_produtos: +valorTotal.toFixed(2),
    valor_total: +valorTotal.toFixed(2),
    items,
  };
  if (config.serie_nfe) nfe.serie = config.serie_nfe;

  return { nfe, erros, creds };
}

module.exports = { focusCreds, soDigitos, dataEmissaoISO, itensMercadoria, buildNfePayload };
