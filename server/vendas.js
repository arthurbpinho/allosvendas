// Regras do treino de vendas, em funções puras (sem I/O, sem rede).

const SLOTS = [
  {
    id: 'metacomando',
    nome: 'Metacomando do simulador',
    descricao: 'Prompt base do simulador.',
    exige: ['[ESTADO'],
  },
  {
    id: 'no',
    nome: 'Nó do avaliador',
    descricao: 'Prompt do avaliador.',
    exige: ['{{BLOCO_1}}', '{{FICHA}}', '{{PORTFÓLIO}}', '{{LOG}}', '{{CRITÉRIO}}'],
  },
  {
    id: 'criterios',
    nome: 'Critérios',
    descricao: 'Critérios da avaliação.',
    exige: [],
  },
  {
    id: 'sintetizador',
    nome: 'Sintetizador',
    descricao: 'Prompt do retorno ao vendedor.',
    exige: ['{{LOG}}', '{{ANALISES}}'],
  },
  {
    id: 'aviso',
    nome: 'Aviso de estado',
    descricao: 'Instrução de correção do simulador (opcional).',
    exige: [],
    opcional: true,
  },
  {
    id: 'portfolio',
    nome: 'Portfólio da Allos',
    descricao: 'Material de referência da oferta.',
    exige: [],
  },
];
const SLOT_IDS = SLOTS.map((s) => s.id);

function validarSlot(slotId, conteudo) {
  const slot = SLOTS.find((s) => s.id === slotId);
  if (!slot) return 'Prompt desconhecido.';
  const texto = String(conteudo || '');
  if (texto.trim().length < (slot.opcional ? 10 : 50)) return 'O arquivo está vazio ou curto demais.';
  const faltando = slot.exige.filter((m) => !texto.includes(m));
  if (faltando.length) return `Este arquivo não parece ser o ${slot.nome.toLowerCase()}: falta ${faltando.join(', ')}.`;
  if (slotId === 'criterios') {
    const cs = parseCriterios(texto);
    if (cs.length !== TOTAL_CRITERIOS) return `O arquivo de critérios precisa ter ${TOTAL_CRITERIOS} critérios (encontrei ${cs.length}).`;
    const incompleto = cs.find((c) => !c.nome || !c.definicao || !c.linhaCurta || !c.bloco);
    if (incompleto) return `O critério "${incompleto.nome || '?'}" está sem definição, linha curta ou bloco.`;
  }
  return null;
}

const CAMPOS_CARD = ['id', 'ordem', 'nome', 'papel', 'organizacao', 'segmento', 'canal', 'canalCurto', 'trocas', 'minutos', 'resumo'];

function parseArquivoComprador(md) {
  const texto = String(md || '').replace(/\r\n/g, '\n');
  const fm = texto.match(/^\s*---\n([\s\S]*?)\n---\s*\n/);
  if (!fm) return { erro: 'Formato de arquivo de comprador inválido (cabeçalho).' };
  const dados = {};
  for (const linha of fm[1].split('\n')) {
    const i = linha.indexOf(':');
    if (i === -1) continue;
    const k = linha.slice(0, i).trim();
    if (CAMPOS_CARD.includes(k)) dados[k] = linha.slice(i + 1).trim();
  }
  const corpo = texto.slice(fm[0].length);
  const iFicha = corpo.search(/^=== FICHA ===\s*$/m);
  const iBloco = corpo.search(/^=== BLOCO 1 ===\s*$/m);
  if (iFicha === -1 || iBloco === -1 || iBloco < iFicha) {
    return { erro: 'Formato de arquivo de comprador inválido (seções).' };
  }
  const ficha = corpo.slice(iFicha, iBloco).replace(/^=== FICHA ===\s*\n/, '').trim();
  const bloco1 = `${corpo.slice(iBloco).replace(/^=== BLOCO 1 ===\s*\n/, '').trim()}\n`;

  if (!/^[a-z0-9-]{2,40}$/.test(dados.id || '')) return { erro: 'id: use de 2 a 40 letras minúsculas, números ou hífen.' };
  for (const k of ['nome', 'canal', 'canalCurto']) {
    if (!dados[k]) return { erro: `Falta o campo "${k}" no cabeçalho.` };
  }
  const trocas = Number.parseInt(dados.trocas, 10);
  if (!Number.isFinite(trocas) || trocas < 1 || trocas > 100) return { erro: 'trocas: informe um número entre 1 e 100.' };
  const minutos = dados.minutos ? Number.parseInt(dados.minutos, 10) : null;
  if (!ficha) return { erro: 'A ficha está vazia.' };
  if (bloco1.trim().length < 200) return { erro: 'Formato de arquivo de comprador inválido (caso vazio).' };

  return {
    comprador: {
      id: dados.id,
      ordem: Number.parseInt(dados.ordem, 10) || 99,
      nome: dados.nome,
      papel: dados.papel || '',
      organizacao: dados.organizacao || '',
      segmento: dados.segmento || '',
      canal: dados.canal,
      canalCurto: dados.canalCurto,
      trocas,
      minutos: Number.isFinite(minutos) && minutos > 0 ? minutos : null,
      resumo: dados.resumo || '',
      ficha,
      bloco1,
    },
  };
}

const FOLGA_TROCAS = 4;
function tetoDeTrocas(comprador) {
  return comprador.trocas + FOLGA_TROCAS;
}

function montarPromptSimulador(metacomando, bloco1) {
  return `${String(metacomando).replace(/\s+$/, '')}\n\n---\n\n${bloco1}`;
}

function limparPontas(linha) {
  return String(linha).trim().replace(/^`+|`+$/g, '').trim();
}
function ehLinhaDeEstado(linha) {
  return limparPontas(linha).startsWith('[ESTADO');
}

function separarEstado(texto) {
  const linhas = String(texto || '').split('\n');
  let estado = null;
  const resto = [];
  for (const l of linhas) {
    if (ehLinhaDeEstado(l)) {
      if (estado === null) estado = limparPontas(l);
      continue;
    }
    resto.push(l);
  }
  return { estado, visivel: resto.join('\n').trim() };
}

function parseEstado(linha) {
  if (!linha) return null;
  const s = limparPontas(linha);
  const m = s.match(/^\[ESTADO\s*\|([\s\S]*)\]$/);
  if (!m) return null;
  const campos = {};
  for (const parte of m[1].split('|')) {
    const p = parte.trim();
    if (!p) continue;
    const i = p.indexOf(':');
    if (i === -1) {
      const [k, ...v] = p.split(/\s+/);
      campos[normalizarChave(k)] = v.join(' ').trim();
    } else {
      campos[normalizarChave(p.slice(0, i))] = p.slice(i + 1).trim();
    }
  }
  const troca = Number.parseInt(campos.troca, 10);
  if (!Number.isFinite(troca) || !('fim' in campos)) return null;
  return {
    troca,
    camada: Number.parseInt(campos.camada, 10) || null,
    confianca: campos.confianca || null,
    passo: campos.passo || null,
    desvio: /^sim/i.test(campos.desvio || ''),
    fim: /^sim/i.test(campos.fim || ''),
    campos,
  };
}

function normalizarChave(k) {
  return String(k)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/\s+/g, '_');
}


function mensagensDoSimulador(turnos, aviso) {
  return (turnos || []).map((t) => {
    if (t.autor === 'vendedor') {
      const content = t.avisoEstado && aviso ? `${String(aviso).trim()}\n\n${t.texto}` : t.texto;
      return { role: 'user', content };
    }
    return { role: 'assistant', content: t.bruto };
  });
}

function precisaAvisoDeEstado(turnos) {
  const ultimo = [...(turnos || [])].reverse().find((t) => t.autor === 'comprador');
  if (!ultimo) return false;
  return !parseEstado(separarEstado(ultimo.bruto).estado);
}

function montarLog(comprador, turnos, { comEstado }) {
  const linhas = [`Canal: ${comprador.canal}`, ''];
  for (const t of turnos || []) {
    if (t.autor === 'vendedor') {
      linhas.push(`VENDEDOR: ${t.texto}`);
    } else {
      const texto = comEstado ? String(t.bruto || '').trim() : separarEstado(t.bruto).visivel;
      linhas.push(`COMPRADOR: ${texto}`);
    }
  }
  return linhas.join('\n');
}

function parseCriterios(md) {
  const secoes = String(md).split(/^## /m).slice(1);
  return secoes.map((sec) => {
    const titulo = sec.split('\n')[0].trim();
    const tm = titulo.match(/^(\d+)\s*·\s*(.+)$/);
    const numero = tm ? Number(tm[1]) : null;
    const nome = (tm ? tm[2] : titulo).trim();
    const corpo = sec.split(/^---\s*$/m)[0];
    const definicao = extrairCampo(corpo, 'Definição em uma frase.');
    const linhaCurta = extrairCampo(corpo, 'Linha curta.');
    const iBloco = corpo.indexOf('**Bloco.**');
    const bloco = iBloco === -1 ? '' : corpo.slice(iBloco + '**Bloco.**'.length).trim();
    return { numero, nome, definicao, linhaCurta, bloco };
  });
}

function extrairCampo(corpo, rotulo) {
  const i = corpo.indexOf(`**${rotulo}**`);
  if (i === -1) return '';
  const resto = corpo.slice(i + rotulo.length + 4);
  return resto.split(/\n\s*\n/)[0].trim();
}

function semBreakpoints(texto) {
  return String(texto).replace(/^=== CACHE BREAKPOINT[^\n]*===\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

function preencher(template, slots) {
  let out = String(template);
  for (const [k, v] of Object.entries(slots)) {
    out = out.split(`{{${k}}}`).join(String(v));
  }
  return out;
}

function textoDoCriterio(criterio) {
  return `## ${criterio.nome}\n\n${criterio.bloco}`;
}

function montarPromptNo(template, { bloco1, ficha, portfolio, log, criterio }) {
  return semBreakpoints(preencher(template, {
    BLOCO_1: bloco1,
    FICHA: ficha,
    'PORTFÓLIO': portfolio,
    LOG: log,
    'CRITÉRIO': textoDoCriterio(criterio),
  }));
}

const QUALIDADES = [
  { chave: 'integridade', rotulo: 'INTEGRIDADE' },
  { chave: 'autoria', rotulo: 'AUTORIA' },
  { chave: 'potencia', rotulo: 'POTÊNCIA' },
  { chave: 'calibracao', rotulo: 'CALIBRAÇÃO' },
  { chave: 'excepcionalidade', rotulo: 'EXCEPCIONALIDADE' },
];

const RE_QUALIDADE = /^\s*\**\s*(INTEGRIDADE|AUTORIA|POT[ÊE]NCIA|CALIBRA[ÇC][ÃA]O|EXCEPCIONALIDADE)\s*\**\s*:\s*\**\s*(plena|parcial|ausente)/i;
const RE_ANALISE = /^\s*\**\s*AN[ÁA]LISE\s*\**\s*:\s*\**\s*/i;

function parseSaidaNo(texto) {
  const linhas = String(texto || '').split('\n');
  const qualidades = {};
  const analise = [];
  let lendoAnalise = false;
  for (const l of linhas) {
    const q = l.match(RE_QUALIDADE);
    if (q) {
      lendoAnalise = false;
      const chave = normalizarChave(q[1]);
      if (!(chave in qualidades)) qualidades[chave] = q[2].toLowerCase();
      continue;
    }
    if (RE_ANALISE.test(l)) {
      lendoAnalise = true;
      analise.push(l.replace(RE_ANALISE, ''));
      continue;
    }
    if (lendoAnalise) analise.push(l);
  }
  const completo = QUALIDADES.every((q) => qualidades[q.chave]);
  return {
    analise: analise.join('\n').replace(/\*+\s*$/, '').trim(),
    qualidades,
    completo,
  };
}

const PONTOS = { plena: 2, parcial: 1, ausente: 0 };

function notaDoCriterio(qualidades) {
  return QUALIDADES.reduce((s, q) => s + (PONTOS[qualidades[q.chave]] ?? 0), 0);
}

const TOTAL_CRITERIOS = 8;
function notaFinal(notasDosCriterios) {
  const soma = notasDosCriterios.reduce((s, n) => s + n, 0);
  return Math.round((soma * 10) / TOTAL_CRITERIOS);
}

const SAUDACAO = 'Este retorno é pré-correção: o começo da conversa com seu gestor e seus colegas, não um veredito.';

function montarAnalises(criterios, resultados) {
  return criterios.map((c, i) => {
    const r = resultados[i];
    const linhasQ = QUALIDADES.map((q) => `${q.rotulo}: ${r.qualidades[q.chave]}`).join('\n');
    return `## ${c.nome}\n${c.linhaCurta}\n\nANÁLISE: ${r.analise}\n${linhasQ}`;
  }).join('\n\n');
}

function montarPromptSintetizador(template, { log, analises }) {
  return semBreakpoints(preencher(template, { LOG: log, ANALISES: analises }));
}

module.exports = {
  SLOTS,
  SLOT_IDS,
  validarSlot,
  parseArquivoComprador,
  tetoDeTrocas,
  montarPromptSimulador,
  ehLinhaDeEstado,
  separarEstado,
  parseEstado,
  mensagensDoSimulador,
  precisaAvisoDeEstado,
  montarLog,
  parseCriterios,
  montarPromptNo,
  QUALIDADES,
  parseSaidaNo,
  PONTOS,
  notaDoCriterio,
  notaFinal,
  TOTAL_CRITERIOS,
  SAUDACAO,
  montarAnalises,
  montarPromptSintetizador,
};
