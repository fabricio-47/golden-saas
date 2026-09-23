'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatDate } = require('../utils');

const STATUS_LABELS = {
  pendente: 'Aguardando assinatura',
  assinado: 'Assinado',
  cancelado: 'Cancelado',
};
const STATUS_BADGE = {
  pendente: 'badge-orcamento',
  assinado: 'badge-ok',
  cancelado: 'badge-desativada',
};

function onlyDigits(v) {
  return (v || '').replace(/\D/g, '');
}

// Monta um link "wa.me" com o telefone do cliente e uma mensagem pronta.
// Não usa nenhuma API do WhatsApp Business — é o mesmo link que abrir o
// WhatsApp Web com a conversa e a mensagem já preenchidas; quem manda é
// sempre uma pessoa, clicando em "Enviar" no próprio WhatsApp.
function whatsappLink(telefone, mensagem) {
  let digits = onlyDigits(telefone);
  if (!digits) return null;
  if (digits.length <= 11) digits = '55' + digits; // assume Brasil se não veio com DDI
  return `https://wa.me/${digits}?text=${encodeURIComponent(mensagem)}`;
}

function contratosListPage({ user, flash, contratos, baseUrl }) {
  const rows = contratos
    .map((c) => {
      const link = `${baseUrl}/contratos/assinar/${c.token}`;
      return `
    <tr>
      <td><a class="link-btn" href="/contratos/${c.id}">${escapeHtml(c.titulo)}</a></td>
      <td>${escapeHtml(c.cliente_nome)}</td>
      <td><span class="badge ${STATUS_BADGE[c.status] || ''}">${STATUS_LABELS[c.status] || c.status}</span></td>
      <td>${formatDate(c.created_at)}</td>
      <td>${c.status === 'pendente' ? `<span class="muted" style="font-size:12px;word-break:break-all;">${escapeHtml(link)}</span>` : '-'}</td>
    </tr>`;
    })
    .join('');

  return layout({
    title: 'Contratos',
    activeNav: 'contratos',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Contratos</h1>
          <p class="subtitle">Envie um contrato em PDF para o cliente assinar online, por um link enviado por e-mail ou WhatsApp.</p>
        </div>
        <a class="btn" href="/contratos/novo">+ Novo Contrato</a>
      </div>
      <div class="card">
        ${
          contratos.length
            ? `<table><thead><tr><th>Título</th><th>Cliente</th><th>Status</th><th>Criado em</th><th>Link de assinatura</th></tr></thead><tbody>${rows}</tbody></table>`
            : '<div class="empty">Nenhum contrato cadastrado ainda.</div>'
        }
      </div>
    `,
  });
}

function contratoFormPage({ user, flash, clientes, csrfToken, clienteFixoId }) {
  const options = clientes
    .map((c) => `<option value="${c.id}" ${String(clienteFixoId) === String(c.id) ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`)
    .join('');
  return layout({
    title: 'Novo contrato',
    activeNav: 'contratos',
    user,
    flash,
    children: `
      <div class="page-header"><div><h1>Novo contrato</h1></div></div>
      <div class="card">
        <form method="POST" action="/contratos" enctype="multipart/form-data">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field full">
              <label for="cliente_id">Cliente *</label>
              <select id="cliente_id" name="cliente_id" required>
                <option value="">Selecione...</option>
                ${options}
              </select>
            </div>
            <div class="field full">
              <label for="titulo">Título do contrato *</label>
              <input type="text" id="titulo" name="titulo" required placeholder="Ex: Contrato de Compra e Venda - Moto Elétrica XPTO" value="Contrato de Compra e Venda">
            </div>
            <div class="field full">
              <label for="arquivo">Arquivo do contrato (PDF) *</label>
              <div class="upload-box">
                <input type="file" id="arquivo" name="arquivo" accept="application/pdf" required>
              </div>
              <p class="muted" style="margin-top:6px;">Envie o PDF já pronto (você pode gerar em qualquer editor/Word e exportar como PDF). O sistema gera um link único para o cliente ler e assinar online.</p>
            </div>
          </div>
          <div class="actions-row">
            <button class="btn" type="submit">Cadastrar e gerar link</button>
            <a class="btn btn-secondary" href="/contratos">Cancelar</a>
          </div>
        </form>
      </div>
    `,
  });
}

function contratoShowPage({ user, flash, contrato, cliente, csrfToken, baseUrl, emailIsConfigured }) {
  const link = `${baseUrl}/contratos/assinar/${contrato.token}`;
  const mensagemWhats = `Olá ${cliente.nome}! Segue o link para você ler e assinar online o contrato "${contrato.titulo}": ${link}`;
  const whatsHref = whatsappLink(cliente.telefone, mensagemWhats);

  const acoesPendente = `
    <div class="card">
      <h2>Enviar link de assinatura</h2>
      <p class="muted" style="margin-bottom:12px;">Link único do cliente: <br><code style="word-break:break-all;">${escapeHtml(link)}</code></p>
      <div class="actions-row" style="flex-wrap:wrap;">
        ${
          cliente.email
            ? `<form method="POST" action="/contratos/${contrato.id}/enviar-email"><input type="hidden" name="csrf" value="${csrfToken}"><button class="btn" type="submit" ${emailIsConfigured ? '' : 'disabled title="Configure o envio de e-mail (BREVO_API_KEY) primeiro"'}>Enviar por e-mail</button></form>`
            : '<span class="muted">Cliente sem e-mail cadastrado.</span>'
        }
        ${
          whatsHref
            ? `<a class="btn btn-secondary" href="${whatsHref}" target="_blank" rel="noopener">Enviar por WhatsApp</a>`
            : '<span class="muted">Cliente sem telefone cadastrado.</span>'
        }
        <button class="btn btn-secondary" type="button" onclick="navigator.clipboard.writeText('${link}');this.textContent='Link copiado!';">Copiar link</button>
      </div>
      <p class="muted" style="margin-top:12px;">O botão de WhatsApp abre o WhatsApp Web/app com a mensagem pronta — você só confirma o envio, como mandar manualmente. Isso não depende de nenhuma API paga do WhatsApp.</p>
    </div>
    <div class="card">
      <form method="POST" action="/contratos/${contrato.id}/cancelar" onsubmit="return confirm('Cancelar este contrato? O link deixará de funcionar.');">
        <input type="hidden" name="csrf" value="${csrfToken}">
        <button class="btn btn-danger" type="submit">Cancelar contrato</button>
      </form>
    </div>
  `;

  const acoesAssinado = `
    <div class="card">
      <h2>Assinatura registrada</h2>
      <p><strong>Assinado por:</strong> ${escapeHtml(contrato.assinante_nome || '-')}</p>
      <p><strong>CPF/CNPJ informado:</strong> ${escapeHtml(contrato.assinante_documento || 'não informado')}</p>
      <p><strong>Data/hora:</strong> ${formatDate(contrato.assinado_em)}</p>
      <p><strong>IP:</strong> ${escapeHtml(contrato.assinante_ip || '-')}</p>
      <div class="actions-row" style="margin-top:12px;">
        <a class="btn" href="/contratos/${contrato.id}/arquivo?tipo=assinado" target="_blank">Baixar PDF assinado</a>
        <a class="btn btn-secondary" href="/contratos/${contrato.id}/arquivo?tipo=original" target="_blank">Ver original</a>
      </div>
    </div>
  `;

  return layout({
    title: contrato.titulo,
    activeNav: 'contratos',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>${escapeHtml(contrato.titulo)}</h1>
          <p class="subtitle">Cliente: ${escapeHtml(cliente.nome)} · <span class="badge ${STATUS_BADGE[contrato.status] || ''}">${STATUS_LABELS[contrato.status] || contrato.status}</span></p>
        </div>
        <a class="btn btn-secondary" href="/contratos">Voltar</a>
      </div>
      ${contrato.status === 'pendente' ? acoesPendente : ''}
      ${contrato.status === 'assinado' ? acoesAssinado : ''}
      ${contrato.status === 'cancelado' ? '<div class="card"><p class="muted">Este contrato foi cancelado. O link de assinatura não funciona mais.</p></div>' : ''}
    `,
  });
}

// ---------- páginas PÚBLICAS (sem login, acessadas pelo cliente pelo link) ----------

function publicShell({ title, children }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { --gold: #d4af37; --bg-dark: #14140f; --text-dark: #23221c; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background:#f7f6f3; color:var(--text-dark); }
    header { background: var(--bg-dark); color:#fff; padding:16px 20px; font-weight:700; font-size:18px; }
    header span { color: var(--gold); }
    .wrap { max-width: 760px; margin: 0 auto; padding: 20px; }
    .card { background:#fff; border:1px solid #e5e2d8; border-radius:10px; padding:20px; margin-bottom:20px; }
    .btn { display:inline-block; background:var(--gold); color:#1a1a12; padding:12px 20px; border-radius:6px; font-size:15px; font-weight:700; border:none; cursor:pointer; }
    .btn:disabled { opacity:0.5; cursor:not-allowed; }
    .btn-secondary { background:#e5e2d8; color:var(--text-dark); }
    label { display:block; font-size:13px; font-weight:600; margin-bottom:6px; }
    input[type=text] { width:100%; padding:10px 12px; border:1px solid #d8d4c6; border-radius:6px; font-size:14px; margin-bottom:14px; }
    .field { margin-bottom: 14px; }
    canvas { border:2px dashed #d8d4c6; border-radius:8px; width:100%; touch-action: none; background:#fff; }
    .pdf-frame { width:100%; height:60vh; border:1px solid #e5e2d8; border-radius:8px; }
    .muted { color:#8a8474; font-size:13px; }
    .flash-error { background:#fbdcd6; color:#9a2f1f; padding:12px 16px; border-radius:8px; margin-bottom:16px; }
    .flash-success { background:#dcf0e2; color:#1f6b3a; padding:12px 16px; border-radius:8px; margin-bottom:16px; }
  </style>
</head>
<body>
  <header>Golden<span>SaaS</span> · Assinatura de Contrato</header>
  <div class="wrap">${children}</div>
</body>
</html>`;
}

function contratoAssinarPage({ contrato, cliente, error }) {
  return publicShell({
    title: `Assinar: ${contrato.titulo}`,
    children: `
      <div class="card">
        <h2 style="margin-top:0;">${escapeHtml(contrato.titulo)}</h2>
        <p class="muted">Leia o documento abaixo com atenção antes de assinar.</p>
        <embed class="pdf-frame" src="/contratos/assinar/${contrato.token}/arquivo" type="application/pdf">
        <p class="muted" style="margin-top:8px;"><a href="/contratos/assinar/${contrato.token}/arquivo" target="_blank">Abrir o documento em outra aba</a> (recomendado no celular)</p>
      </div>
      <div class="card">
        ${error ? `<div class="flash-error">${escapeHtml(error)}</div>` : ''}
        <form method="POST" action="/contratos/assinar/${contrato.token}" id="signForm">
          <div class="field">
            <label for="nome">Nome completo *</label>
            <input type="text" id="nome" name="nome" required value="${escapeHtml(cliente.nome || '')}">
          </div>
          <div class="field">
            <label for="documento">CPF ou CNPJ *</label>
            <input type="text" id="documento" name="documento" required placeholder="000.000.000-00">
          </div>
          <div class="field">
            <label>Assine no quadro abaixo, usando o mouse ou o dedo (no celular) *</label>
            <canvas id="pad" width="600" height="200"></canvas>
            <p class="muted" style="margin-top:6px;"><a href="#" id="limpar">Limpar assinatura</a></p>
          </div>
          <div class="field">
            <label style="display:flex;align-items:center;gap:8px;font-weight:400;">
              <input type="checkbox" id="aceite" required style="width:auto;">
              Li e concordo com os termos deste documento.
            </label>
          </div>
          <input type="hidden" name="assinatura_png" id="assinatura_png">
          <button class="btn" type="submit" id="btnEnviar" disabled>Confirmar assinatura</button>
        </form>
        <p class="muted" style="margin-top:16px;">
          Ao assinar, o sistema registra seu nome, documento informado, data/hora, endereço IP e a imagem da assinatura,
          como comprovante de aceite eletrônico (assinatura eletrônica simples, sem certificado digital ICP-Brasil).
        </p>
      </div>
      <script>
        const canvas = document.getElementById('pad');
        const ctx = canvas.getContext('2d');
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#14140f';
        let drawing = false;
        let hasSignature = false;

        function pos(e) {
          const rect = canvas.getBoundingClientRect();
          const scaleX = canvas.width / rect.width;
          const scaleY = canvas.height / rect.height;
          const point = e.touches ? e.touches[0] : e;
          return { x: (point.clientX - rect.left) * scaleX, y: (point.clientY - rect.top) * scaleY };
        }
        function start(e) { e.preventDefault(); drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
        function move(e) {
          if (!drawing) return;
          e.preventDefault();
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          hasSignature = true;
          atualizarBotao();
        }
        function end() { drawing = false; }
        canvas.addEventListener('mousedown', start);
        canvas.addEventListener('mousemove', move);
        window.addEventListener('mouseup', end);
        canvas.addEventListener('touchstart', start, { passive: false });
        canvas.addEventListener('touchmove', move, { passive: false });
        canvas.addEventListener('touchend', end);

        document.getElementById('limpar').addEventListener('click', function (e) {
          e.preventDefault();
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          hasSignature = false;
          atualizarBotao();
        });

        const aceite = document.getElementById('aceite');
        aceite.addEventListener('change', atualizarBotao);
        function atualizarBotao() {
          document.getElementById('btnEnviar').disabled = !(hasSignature && aceite.checked);
        }

        document.getElementById('signForm').addEventListener('submit', function () {
          document.getElementById('assinatura_png').value = canvas.toDataURL('image/png');
        });
      </script>
    `,
  });
}

function contratoJaProcessadoPage({ status }) {
  const mensagem =
    status === 'assinado'
      ? 'Este contrato já foi assinado anteriormente. Se precisar de uma cópia, entre em contato com quem enviou o link.'
      : 'Este link de assinatura foi cancelado e não está mais disponível.';
  return publicShell({
    title: 'Contrato indisponível',
    children: `<div class="card"><p>${escapeHtml(mensagem)}</p></div>`,
  });
}

function contratoAssinadoPage({ contrato }) {
  return publicShell({
    title: 'Assinatura confirmada',
    children: `
      <div class="card">
        <div class="flash-success">Assinatura registrada com sucesso!</div>
        <p>Obrigado, <strong>${escapeHtml(contrato.assinante_nome)}</strong>. Seu aceite foi registrado em ${formatDate(contrato.assinado_em)}.</p>
        <a class="btn" href="/contratos/assinar/${contrato.token}/arquivo?tipo=assinado" target="_blank">Baixar cópia do documento assinado</a>
      </div>
    `,
  });
}

module.exports = {
  contratosListPage,
  contratoFormPage,
  contratoShowPage,
  contratoAssinarPage,
  contratoJaProcessadoPage,
  contratoAssinadoPage,
  whatsappLink,
};
