'use strict';

const { layout } = require('./layout');
const { escapeHtml } = require('../utils');

function mask(token) {
  if (!token) return null;
  const t = String(token);
  if (t.length <= 4) return '••••';
  return '••••' + t.slice(-4);
}

function configFiscalPage({ user, flash, config, csrfToken }) {
  const c = config || {};
  const ambiente = c.ambiente || 'homologacao';
  const emProducao = ambiente === 'producao';
  const tokenHomoMask = mask(c.focus_token_homologacao);
  const tokenProdMask = mask(c.focus_token_producao);
  const temTokenAtivo = emProducao ? !!c.focus_token_producao : !!c.focus_token_homologacao;

  const bannerAmbiente = emProducao
    ? `<div class="card" style="border-left:4px solid #a1352a;background:rgba(161,53,42,0.06);">
         <strong style="color:#a1352a;">⚠️ Ambiente de PRODUÇÃO ativo.</strong>
         <p class="muted" style="margin:6px 0 0;">As notas emitidas agora têm <strong>valor jurídico</strong>. Só mantenha neste modo depois de ter testado tudo em homologação com o contador.</p>
       </div>`
    : `<div class="card" style="border-left:4px solid #2f6b3a;background:rgba(47,107,58,0.06);">
         <strong style="color:#1f6b3a;">🧪 Ambiente de HOMOLOGAÇÃO (teste) ativo.</strong>
         <p class="muted" style="margin:6px 0 0;">As notas emitidas aqui <strong>não têm valor jurídico</strong> — é o ambiente certo para testar a integração sem risco.</p>
       </div>`;

  const statusToken = temTokenAtivo
    ? '<span class="badge badge-ok">Token configurado</span>'
    : '<span class="badge badge-desativada">Sem token para o ambiente ativo</span>';

  return layout({
    title: 'Configurações Fiscais',
    activeNav: 'config-fiscal',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Fiscal / Nota Fiscal (NF-e)</h1>
          <p class="subtitle">Integração com a Focus NFe para emissão de NF-e de produto</p>
        </div>
        <div style="margin-top:4px;">${statusToken}</div>
      </div>

      ${bannerAmbiente}

      <div class="card" style="margin-top:4px;">
        <p class="muted" style="margin-top:0;">
          Os campos de <strong>padrões fiscais</strong> abaixo (NCM, CFOP, CSOSN, origem) devem ser
          definidos <strong>com o seu contador</strong>. Eles só são usados quando um produto não tem os
          seus próprios valores cadastrados. Preencher errado aqui = nota errada.
        </p>
      </div>

      <div class="card">
        <form method="POST" action="/configuracoes/fiscal">
          <input type="hidden" name="csrf" value="${csrfToken}">

          <h2 style="margin-top:0;">Ambiente e tokens da Focus</h2>
          <div class="form-grid">
            <div class="field">
              <label for="ambiente">Ambiente ativo *</label>
              <select id="ambiente" name="ambiente">
                <option value="homologacao" ${!emProducao ? 'selected' : ''}>Homologação (teste, sem valor jurídico)</option>
                <option value="producao" ${emProducao ? 'selected' : ''}>Produção (nota oficial)</option>
              </select>
            </div>
            <div class="field"></div>
            <div class="field">
              <label for="token_homologacao">Token de Homologação ${tokenHomoMask ? `(atual: ${tokenHomoMask})` : ''}</label>
              <input type="text" id="token_homologacao" name="token_homologacao" autocomplete="off" placeholder="${tokenHomoMask ? 'Deixe em branco para manter o atual' : 'Cole o token de homologação da Focus'}">
            </div>
            <div class="field">
              <label for="token_producao">Token de Produção ${tokenProdMask ? `(atual: ${tokenProdMask})` : ''}</label>
              <input type="text" id="token_producao" name="token_producao" autocomplete="off" placeholder="${tokenProdMask ? 'Deixe em branco para manter o atual' : 'Só depois de validar em homologação'}">
            </div>
          </div>

          <h2>Dados da operação</h2>
          <div class="form-grid">
            <div class="field">
              <label for="regime_tributario">Regime tributário *</label>
              <select id="regime_tributario" name="regime_tributario">
                <option value="1" ${Number(c.regime_tributario) === 1 ? 'selected' : ''}>1 — Simples Nacional</option>
                <option value="2" ${Number(c.regime_tributario) === 2 ? 'selected' : ''}>2 — Simples Nacional (excesso de sublimite)</option>
                <option value="3" ${Number(c.regime_tributario) === 3 ? 'selected' : ''}>3 — Regime Normal (Lucro Presumido/Real)</option>
              </select>
            </div>
            <div class="field">
              <label for="natureza_operacao">Natureza da operação *</label>
              <input type="text" id="natureza_operacao" name="natureza_operacao" value="${escapeHtml(c.natureza_operacao || 'Venda de mercadoria')}">
            </div>
            <div class="field">
              <label for="serie_nfe">Série da NF-e (opcional)</label>
              <input type="text" id="serie_nfe" name="serie_nfe" value="${escapeHtml(c.serie_nfe || '')}" placeholder="Normalmente configurada no painel da Focus">
            </div>
          </div>

          <h2>Padrões fiscais (definir com o contador)</h2>
          <p class="muted" style="margin-top:-6px;">Usados quando o produto não tem valor próprio. A scooter vendida como "veículo" na venda usa estes padrões.</p>
          <div class="form-grid">
            <div class="field">
              <label for="ncm_padrao">NCM padrão</label>
              <input type="text" id="ncm_padrao" name="ncm_padrao" value="${escapeHtml(c.ncm_padrao || '')}" placeholder="Ex.: 8711.60.00">
            </div>
            <div class="field">
              <label for="cfop_padrao">CFOP dentro do estado (RJ→RJ)</label>
              <input type="text" id="cfop_padrao" name="cfop_padrao" value="${escapeHtml(c.cfop_padrao || '')}" placeholder="Ex.: 5102">
            </div>
            <div class="field">
              <label for="cfop_interestadual_padrao">CFOP para fora do estado</label>
              <input type="text" id="cfop_interestadual_padrao" name="cfop_interestadual_padrao" value="${escapeHtml(c.cfop_interestadual_padrao || '')}" placeholder="Ex.: 6102">
            </div>
            <div class="field">
              <label for="csosn_padrao">CSOSN / CST padrão</label>
              <input type="text" id="csosn_padrao" name="csosn_padrao" value="${escapeHtml(c.csosn_padrao || '')}" placeholder="Ex.: 102 (Simples)">
            </div>
            <div class="field">
              <label for="origem_padrao">Origem da mercadoria</label>
              <select id="origem_padrao" name="origem_padrao">
                <option value="0" ${Number(c.origem_padrao) === 0 ? 'selected' : ''}>0 — Nacional</option>
                <option value="1" ${Number(c.origem_padrao) === 1 ? 'selected' : ''}>1 — Estrangeira (importação direta)</option>
                <option value="2" ${Number(c.origem_padrao) === 2 ? 'selected' : ''}>2 — Estrangeira (mercado interno)</option>
                <option value="3" ${Number(c.origem_padrao) === 3 ? 'selected' : ''}>3 — Nacional (>40% importado)</option>
                <option value="8" ${Number(c.origem_padrao) === 8 ? 'selected' : ''}>8 — Nacional (conteúdo de importação)</option>
              </select>
            </div>
            <div class="field">
              <label for="unidade_padrao">Unidade comercial padrão</label>
              <input type="text" id="unidade_padrao" name="unidade_padrao" value="${escapeHtml(c.unidade_padrao || 'UN')}" placeholder="UN, PC, etc.">
            </div>
          </div>

          <div class="actions-row">
            <button class="btn" type="submit">Salvar configurações fiscais</button>
          </div>
        </form>
      </div>
    `,
  });
}

module.exports = { configFiscalPage };
