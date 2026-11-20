'use strict';

// Importa clientes, motos, locações, parcelas e ocorrências exportados do WSYS
// Locar. Idempotente: guarda o id de origem em import_map, então rodar de novo
// não duplica nada. "Simular" roda tudo dentro de uma transação e desfaz.

const { db } = require('./db');

db.exec(`
  CREATE TABLE IF NOT EXISTS import_map (
    fonte TEXT NOT NULL,
    tipo TEXT NOT NULL,
    ext_id TEXT NOT NULL,
    local_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (fonte, tipo, ext_id)
  );
`);

const FONTE = 'wsys';
const t = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
const n = (v) => {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  let s = String(v).replace(/[^\d,.-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
};
const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const normNome = (v) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
// "GOLDEN CITY", "City", "CITY" -> "CITY"; "x13 gold" -> "X13GOLD"
const normModelo = (v) => normNome(v).replace(/\bGOLDEN\b/g, '').replace(/[^A-Z0-9]/g, '');
// Datas: aceita "2026-11-17", "2026-11-17 10:00:00" e "17/11/2026".
const data = (v) => {
  const s = t(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
};
const hora = (v) => {
  const m = String(v || '').match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
};

function getMap(tipo, ext) {
  const r = db.prepare('SELECT local_id FROM import_map WHERE fonte=? AND tipo=? AND ext_id=?').get(FONTE, tipo, String(ext));
  return r ? r.local_id : null;
}
function setMap(tipo, ext, localId) {
  db.prepare('INSERT OR REPLACE INTO import_map (fonte, tipo, ext_id, local_id) VALUES (?,?,?,?)').run(FONTE, tipo, String(ext), localId);
}

const TIPO_OC = { multa: 'multa', colisao: 'colisao', 'colisão': 'colisao', avaria: 'avaria', 'danos a terceiros': 'danos_terceiros', outros: 'outros' };
const PERIODO = { 1: 'diaria', 2: 'semanal', 3: 'mensal' };
const DIAS = { diaria: 1, semanal: 7, mensal: 30 };

// Só preenche no cliente existente o que estiver vazio (não sobrescreve edição manual).
function preencherVazios(tabela, id, campos) {
  const atual = db.prepare(`SELECT * FROM ${tabela} WHERE id=?`).get(id);
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(campos)) {
    if (v === null || v === undefined || v === '') continue;
    if (atual[k] === null || atual[k] === undefined || atual[k] === '') {
      sets.push(`${k}=?`);
      vals.push(v);
    }
  }
  if (sets.length) db.prepare(`UPDATE ${tabela} SET ${sets.join(', ')} WHERE id=?`).run(...vals, id);
  return sets.length;
}

function importar(dados, { simular }) {
  const r = {
    clientes: { novos: 0, vinculados: 0, atualizados: 0 },
    modelos: { novos: 0, existentes: 0 },
    motos: { novas: 0, vinculadas: 0 },
    locacoes: { novas: 0, ja_importadas: 0, ja_existiam_no_golden: 0, ativas: 0, encerradas: 0 },
    parcelas: { novas: 0, ja_importadas: 0, pagas: 0, valor_total: 0, valor_pago: 0, sem_locacao: 0, geradas_pelo_plano: 0 },
    ocorrencias: 0,
    avisos: [],
  };
  const aviso = (m) => {
    if (r.avisos.length < 60) r.avisos.push(m);
  };
  db.exec('BEGIN');
  try {
    // ---------------- clientes
    const clientePorExt = {};
    const clientePorNome = {};
    for (const c of dados.clientes || []) {
      if (!t(c.nome)) continue;
      const campos = {
        telefone: t(c.telefone),
        telefone2: t(c.telefone2),
        email: t(c.email),
        endereco: t(c.endereco),
        cpf_cnpj: t(c.cpf_cnpj),
        municipio: t(c.cidade),
        uf: t(c.uf) ? t(c.uf).toUpperCase().slice(0, 2) : null,
        rede_social: t(c.rede_social),
        cnh: t(c.cnh),
        cnh_validade: data(c.cnh_validade),
        rg: t(c.rg),
        rg_orgao: t(c.rg_orgao),
        rg_uf: t(c.rg_uf),
        data_nascimento: data(c.data_nascimento),
      };
      let id = getMap('cliente', c.ext);
      if (id && !db.prepare('SELECT id FROM clientes WHERE id=?').get(id)) id = null;
      if (!id) {
        const cpf = soDigitos(c.cpf_cnpj);
        let ex = null;
        if (cpf.length >= 11) ex = db.prepare("SELECT id FROM clientes WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(cpf_cnpj,''),'.',''),'-',''),'/',''),' ','') = ?").get(cpf);
        if (!ex) ex = db.prepare('SELECT id, nome FROM clientes').all().find((x) => normNome(x.nome) === normNome(c.nome));
        if (ex) {
          id = ex.id;
          r.clientes.vinculados++;
        } else {
          id = Number(
            db
              .prepare(
                `INSERT INTO clientes (nome, telefone, email, endereco, observacoes, cpf_cnpj, municipio, uf) VALUES (?,?,?,?,?,?,?,?)`
              )
              .run(t(c.nome), campos.telefone || '', campos.email || '', campos.endereco || '', 'Importado do WSYS', campos.cpf_cnpj, campos.municipio, campos.uf)
              .lastInsertRowid
          );
          r.clientes.novos++;
        }
        setMap('cliente', c.ext, id);
      }
      if (preencherVazios('clientes', id, campos)) r.clientes.atualizados++;
      clientePorExt[String(c.ext)] = id;
      clientePorNome[normNome(c.nome)] = id;
    }

    // ---------------- modelos + motos
    const modelos = db.prepare('SELECT * FROM frota').all();
    const modeloPorChave = {};
    for (const m of modelos.sort((a, b) => (b.quantidade_total || 0) - (a.quantidade_total || 0))) {
      const k = normModelo(m.identificacao);
      if (!modeloPorChave[k]) modeloPorChave[k] = m.id;
    }
    const unidadePorExt = {};
    const chassiUsado = {}; // chassi -> ext que já usou nesta importação
    for (const v of dados.veiculos || []) {
      let chassi = (t(v.chassi) || t(v.placa) || '').toUpperCase();
      // Chassi repetido no WSYS (erro de cadastro): mantém motos separadas e avisa.
      if (chassi && chassiUsado[chassi] && chassiUsado[chassi] !== String(v.ext)) {
        aviso(`Chassi ${chassi} repetido no WSYS (motos ${chassiUsado[chassi]} e ${v.ext}) — importada como "${chassi} #${v.ext}". Corrija o chassi certo na tela da moto.`);
        chassi = `${chassi} #${v.ext}`;
      }
      if (chassi) chassiUsado[chassi.split(' #')[0]] = chassiUsado[chassi.split(' #')[0]] || String(v.ext);
      if (!chassi) {
        aviso(`Moto ${v.ext} sem chassi e sem placa — ignorada.`);
        continue;
      }
      const k = normModelo(v.modelo) || 'SEMMODELO';
      let frotaId = modeloPorChave[k];
      if (!frotaId) {
        frotaId = Number(
          db
            .prepare('INSERT INTO frota (identificacao, marca, cor, quantidade_total, valor_diaria, valor_semanal, valor_mensal) VALUES (?,?,?,?,?,?,?)')
            .run(normNome(v.modelo) || 'SEM MODELO', t(v.marca), null, 0, n(v.valor_diaria), n(v.valor_semanal), n(v.valor_mensal)).lastInsertRowid
        );
        modeloPorChave[k] = frotaId;
        r.modelos.novos++;
      } else {
        preencherVazios('frota', frotaId, { marca: t(v.marca), valor_semanal: n(v.valor_semanal), valor_diaria: n(v.valor_diaria), valor_mensal: n(v.valor_mensal) });
      }
      let uid = getMap('veiculo', v.ext);
      if (uid && !db.prepare('SELECT id FROM frota_unidades WHERE id=?').get(uid)) uid = null;
      if (!uid) {
        const ex = db.prepare('SELECT id FROM frota_unidades WHERE UPPER(TRIM(chassi))=?').get(chassi);
        if (ex) {
          uid = ex.id;
          r.motos.vinculadas++;
        } else {
          const placa = t(v.placa) && t(v.placa).toUpperCase() !== chassi ? t(v.placa).toUpperCase() : null;
          uid = Number(
            db
              .prepare(
                `INSERT INTO frota_unidades (frota_id, placa, chassi, renavam, cor, ano, km_atual, data_compra, ativo, observacoes) VALUES (?,?,?,?,?,?,?,?,?,?)`
              )
              .run(frotaId, placa, chassi, t(v.renavam), t(v.cor), n(v.ano), n(v.km_atual), data(v.data_compra), v.ativo === false ? 0 : 1, t(v.obs)).lastInsertRowid
          );
          r.motos.novas++;
        }
        setMap('veiculo', v.ext, uid);
      }
      unidadePorExt[String(v.ext)] = uid;
    }
    const modelosUsados = new Set(Object.values(modeloPorChave));
    r.modelos.existentes = [...modelosUsados].length - r.modelos.novos;

    // ---------------- locações
    const locsPorCliente = {}; // cliente local -> [{id, data_saida}]
    for (const l of dados.locacoes || []) {
      const clienteId = clientePorExt[String(l.cliente_ext)] || null;
      const uid = unidadePorExt[String(l.veiculo_ext)] || null;
      const u = uid ? db.prepare('SELECT * FROM frota_unidades WHERE id=?').get(uid) : null;
      if (!u) {
        aviso(`Locação ${l.ext}: moto do WSYS (${l.veiculo_ext}) não encontrada — ignorada.`);
        continue;
      }
      let locId = getMap('locacao', l.ext);
      if (locId && !db.prepare('SELECT id FROM locacoes WHERE id=?').get(locId)) locId = null;
      let semParcelas = false;
      if (locId) {
        r.locacoes.ja_importadas++;
      } else {
        // Já cadastrada à mão no Golden (mesma moto, mesmo cliente, ativa)? Vincula e não mexe nas parcelas dela.
        const ex = db
          .prepare("SELECT id FROM locacoes WHERE status='ativa' AND UPPER(TRIM(chassi))=? AND (cliente_id IS ? OR cliente_id=?)")
          .get(u.chassi, clienteId, clienteId);
        const ativa = !!l.ativa;
        if (ex) {
          locId = ex.id;
          semParcelas = true;
          r.locacoes.ja_existiam_no_golden++;
          aviso(`Locação ${l.ext} já existia no Golden (#${ex.id}); vinculada, parcelas do Golden mantidas.`);
          db.prepare('UPDATE locacoes SET unidade_id=COALESCE(unidade_id, ?) WHERE id=?').run(uid, ex.id);
        } else {
          const periodo = PERIODO[l.forma_locacao] || null;
          locId = Number(
            db
              .prepare(
                `INSERT INTO locacoes (frota_id, unidade_id, cliente_id, chassi, placa, cor, data_saida, hora_saida, devolucao_prevista, hora_retorno,
                   data_devolucao, km_saida, km_retorno, periodo, qtd_periodos, valor_caucao, desconto, observacoes, status,
                   testemunha1_nome, testemunha1_rg, testemunha2_nome, testemunha2_rg, fiador_nome, fiador_dados, valor_combinado)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
              )
              .run(
                u.frota_id, uid, clienteId, u.chassi, u.placa, u.cor, data(l.data_saida) || new Date().toISOString().slice(0, 10), hora(l.hora_saida),
                data(l.data_retorno), hora(l.hora_retorno), ativa ? null : data(l.data_retorno), n(l.km_saida), n(l.km_retorno), periodo,
                n(l.qtd), n(l.valor_caucao), n(l.desconto) || 0, [t(l.obs), `Importado do WSYS (locação ${l.ext})`].filter(Boolean).join(' · '),
                ativa ? 'ativa' : 'devolvida', t(l.testemunha_1), t(l.testemunha_1_rg), t(l.testemunha_2), t(l.testemunha_2_rg), t(l.fiador), t(l.dados_fiador),
                n(l.valor_total_desconto) || n(l.valor_total)
              ).lastInsertRowid
          );
          r.locacoes.novas++;
          // Entrada (o WSYS guarda em "caução"): vira a parcela nº 0, paga na data de saída.
          const entrada = n(l.valor_caucao);
          if (entrada && entrada > 0) {
            const ds = data(l.data_saida) || new Date().toISOString().slice(0, 10);
            db.prepare("INSERT INTO locacao_parcelas (locacao_id, numero, valor, vencimento, pago, data_pagamento, origem) VALUES (?, 0, ?, ?, 1, ?, 'entrada')").run(locId, entrada, ds, ds);
            r.parcelas.entradas = (r.parcelas.entradas || 0) + 1;
            r.parcelas.valor_entradas = Math.round(((r.parcelas.valor_entradas || 0) + entrada) * 100) / 100;
          }
          if (ativa) r.locacoes.ativas++;
          else r.locacoes.encerradas++;
          for (const o of l.ocorrencias || []) {
            db.prepare('INSERT INTO locacao_ocorrencias (locacao_id, tipo, data_hora, valor, descricao, concluido) VALUES (?,?,?,?,?,?)').run(
              locId, TIPO_OC[normNome(o.tipo).toLowerCase()] || 'outros', t(o.data_hora), n(o.valor), t(o.descricao), o.concluido ? 1 : 0
            );
            r.ocorrencias++;
          }
        }
        setMap('locacao', l.ext, locId);
      }
      if (clienteId) (locsPorCliente[clienteId] = locsPorCliente[clienteId] || []).push({ id: locId, ext: l.ext, data_saida: data(l.data_saida) || '', semParcelas, plano: l });
    }

    // ---------------- parcelas (recebimentos do WSYS não têm a locação: liga pelo cliente + data)
    const usadas = new Set();
    for (const p of dados.recebimentos || []) {
      if (getMap('parcela', p.ext)) {
        r.parcelas.ja_importadas++;
        usadas.add(getMap('parcela', p.ext));
        continue;
      }
      const clienteId = clientePorNome[normNome(p.cliente)] || null;
      const venc = data(p.vencimento);
      const cands = ((clienteId && locsPorCliente[clienteId]) || []).slice().sort((a, b) => (a.data_saida < b.data_saida ? 1 : -1));
      // a locação mais recente que começou até o vencimento (ou a mais antiga, se o vencimento for antes de todas)
      const alvo = cands.find((c) => !venc || c.data_saida <= venc) || cands[cands.length - 1];
      if (!alvo) {
        r.parcelas.sem_locacao++;
        aviso(`Recebimento ${p.ext} (${p.cliente}, venc. ${p.vencimento}) sem locação correspondente — não importado.`);
        continue;
      }
      if (alvo.semParcelas) continue;
      const valor = n(p.valor) || 0;
      const pago = p.pago ? 1 : 0;
      const pid = Number(
        db
          .prepare('INSERT INTO locacao_parcelas (locacao_id, numero, valor, vencimento, pago, data_pagamento, forma_pagamento) VALUES (?,?,?,?,?,?,?)')
          .run(alvo.id, n(p.numero) || 1, valor, venc, pago, pago ? data(p.data_pagamento) || venc : null, pago ? t(p.forma) : null).lastInsertRowid
      );
      setMap('parcela', p.ext, pid);
      alvo.temParcela = true;
      r.parcelas.novas++;
      r.parcelas.valor_total += valor;
      if (pago) {
        r.parcelas.pagas++;
        r.parcelas.valor_pago += n(p.valor_recebido) || valor;
      }
    }
    // Locação sem nenhum recebimento no WSYS: gera as parcelas pelo plano dela (valor × quantidade a partir do 1º vencimento).
    for (const lista of Object.values(locsPorCliente)) {
      for (const a of lista) {
        if (a.semParcelas || a.temParcela) continue;
        if (db.prepare("SELECT COUNT(*) c FROM locacao_parcelas WHERE locacao_id=? AND origem IS NULL").get(a.id).c > 0) continue;
        const qtd = n(a.plano.parcelas_financeiro);
        const valor = n(a.plano.valor_parcela_financeiro);
        const ini = data(a.plano.data_vencimento_financeiro);
        if (!qtd || !valor || !ini) continue;
        const dias = DIAS[PERIODO[a.plano.forma_locacao]] || 7;
        for (let k = 0; k < qtd; k++) {
          const d = new Date(ini + 'T00:00:00');
          d.setDate(d.getDate() + k * dias);
          db.prepare('INSERT INTO locacao_parcelas (locacao_id, numero, valor, vencimento) VALUES (?,?,?,?)').run(a.id, k + 1, valor, d.toISOString().slice(0, 10));
          r.parcelas.geradas_pelo_plano++;
        }
        aviso(`Locação ${a.ext}: sem recebimentos no WSYS — ${qtd} parcelas geradas pelo plano.`);
      }
    }
    // valor_combinado = soma das parcelas importadas
    for (const lista of Object.values(locsPorCliente))
      for (const a of lista)
        if (!a.semParcelas)
          db.prepare('UPDATE locacoes SET valor_combinado=(SELECT COALESCE(SUM(valor),0) FROM locacao_parcelas WHERE locacao_id=?) WHERE id=? AND EXISTS (SELECT 1 FROM locacao_parcelas WHERE locacao_id=?)').run(a.id, a.id, a.id);

    // quantidade dos modelos pelas motos cadastradas
    for (const f of db.prepare('SELECT DISTINCT frota_id FROM frota_unidades').all()) {
      const q = db.prepare('SELECT COUNT(*) c, COALESCE(SUM(em_manutencao),0) m FROM frota_unidades WHERE frota_id=? AND ativo=1').get(f.frota_id);
      if (q.c > 0) db.prepare('UPDATE frota SET quantidade_total=?, em_manutencao=? WHERE id=?').run(q.c, q.m, f.frota_id);
    }

    r.parcelas.valor_total = Math.round(r.parcelas.valor_total * 100) / 100;
    r.parcelas.valor_pago = Math.round(r.parcelas.valor_pago * 100) / 100;
    db.exec(simular ? 'ROLLBACK' : 'COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return r;
}

module.exports = { importar };
