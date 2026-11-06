'use strict';

// Cliente da API Focus NFe (https://focusnfe.com.br).
// Autenticação: HTTP Basic com o token da empresa como usuário e senha vazia.
// Ambiente de homologação = testes (sem valor jurídico). Produção = nota oficial.
//
// IMPORTANTE: este módulo só faz a chamada HTTP. Ele NÃO decide campos fiscais
// (NCM, CFOP, CSOSN, etc.) — isso vem da configuração/produtos, definidos com o
// contador. Nunca emita em produção sem antes validar em homologação.

const https = require('node:https');

const BASES = {
  homologacao: 'https://homologacao.focusnfe.com.br',
  producao: 'https://api.focusnfe.com.br',
};

function baseUrl(ambiente) {
  return BASES[ambiente] || BASES.homologacao;
}

// Faz uma requisição à API Focus. Resolve sempre (mesmo em erro HTTP) com
// { status, data, raw } — quem chama decide o que fazer com o status. Só
// rejeita em falha de rede/timeout.
function request({ ambiente, token, method, path, body, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    if (!token) {
      reject(new Error('Token da Focus NFe não configurado para este ambiente.'));
      return;
    }
    const url = new URL(baseUrl(ambiente) + path);
    const payload = body ? JSON.stringify(body) : null;
    // Basic auth: token como usuário, senha vazia -> base64("TOKEN:")
    const authHeader = 'Basic ' + Buffer.from(`${token}:`).toString('base64');
    const options = {
      method,
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
    };
    if (payload) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = https.request(options, (res) => {
      let chunks = '';
      res.on('data', (c) => {
        chunks += c;
      });
      res.on('end', () => {
        let data = null;
        try {
          data = chunks ? JSON.parse(chunks) : null;
        } catch (_e) {
          data = null;
        }
        resolve({ status: res.statusCode, data, raw: chunks });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Tempo esgotado ao falar com a Focus NFe.'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// Emite uma NF-e. `ref` é o identificador único da nota no nosso sistema.
// Retorno típico: 202 (processando, assíncrono) ou 201 (autorizada na hora).
function emitirNfe({ ambiente, token }, ref, nfe) {
  return request({
    ambiente,
    token,
    method: 'POST',
    path: `/v2/nfe?ref=${encodeURIComponent(ref)}`,
    body: nfe,
  });
}

// Consulta o status de uma NF-e já enviada (pela ref).
function consultarNfe({ ambiente, token }, ref, completa = false) {
  return request({
    ambiente,
    token,
    method: 'GET',
    path: `/v2/nfe/${encodeURIComponent(ref)}${completa ? '?completa=1' : ''}`,
  });
}

// Baixa um arquivo da Focus (DANFE em PDF, XML) pelo caminho relativo que a
// API retorna. Esses caminhos exigem o token (Basic auth), por isso o download
// passa pelo nosso servidor em vez de um link direto no navegador.
function baixarArquivo({ ambiente, token }, caminho) {
  return new Promise((resolve, reject) => {
    if (!token) {
      reject(new Error('Token da Focus NFe não configurado para este ambiente.'));
      return;
    }
    const url = new URL(baseUrl(ambiente) + caminho);
    const authHeader = 'Basic ' + Buffer.from(`${token}:`).toString('base64');
    const req = https.request(
      {
        method: 'GET',
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: { Authorization: authHeader },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] })
        );
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Tempo esgotado ao baixar da Focus NFe.')));
    req.end();
  });
}

// Cancela uma NF-e autorizada. Justificativa com no mínimo 15 caracteres.
function cancelarNfe({ ambiente, token }, ref, justificativa) {
  return request({
    ambiente,
    token,
    method: 'DELETE',
    path: `/v2/nfe/${encodeURIComponent(ref)}`,
    body: { justificativa },
  });
}

module.exports = { emitirNfe, consultarNfe, cancelarNfe, baixarArquivo, baseUrl, BASES };
