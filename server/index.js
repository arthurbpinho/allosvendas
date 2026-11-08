require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { DATA_DIR } = require('./paths');
const errorLog = require('./error-log');
const vendas = require('./vendas');

const app = express();
app.set('trust proxy', 1);

// --- Segurança básica (mesma política do all_OS, sem o Turnstile) ---
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      'default-src': ["'self'"],
      'base-uri': ["'self'"],
      'object-src': ["'none'"],
      'frame-ancestors': ["'none'"],
      'form-action': ["'self'"],
      'script-src': ["'self'"],
      'script-src-attr': ["'none'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
      'img-src': ["'self'", 'data:', 'blob:'],
      'connect-src': ["'self'"],
      'worker-src': ["'self'"],
      'manifest-src': ["'self'"],
      'upgrade-insecure-requests': [],
    },
  },
  crossOriginEmbedderPolicy: false,
  xFrameOptions: { action: 'deny' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: false },
}));
if (process.env.NODE_ENV !== 'production') {
  app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
}
app.use(express.json({ limit: '200kb' }));

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET ausente ou curto demais (mínimo 32 chars).');
  console.error('         Gere com: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  process.exit(1);
}
const TOKEN_TTL = '7d';
const BCRYPT_ROUNDS = 10;

function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  const raw = (typeof cf === 'string' && cf.trim()) ? cf.trim() : (req.ip || '');
  if (raw.startsWith('::ffff:') && raw.includes('.')) return raw.slice(7);
  return raw;
}

const SKIP_RATE_LIMIT = process.env.NODE_ENV === 'test';
const noop = (req, res, next) => next();
const loginLimiter = SKIP_RATE_LIMIT ? noop : rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req) || 'desconhecido',
  skipSuccessfulRequests: true,
  message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});
// Cada mensagem custa uma chamada de IA: teto por usuário contra clique em rajada.
const iaLimiter = SKIP_RATE_LIMIT ? noop : rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? `u:${req.user.id}` : clientIp(req) || 'desconhecido'),
  message: { error: 'Muitas mensagens em pouco tempo. Espere um instante.' },
});

// --- Arquivos JSON no DATA_DIR (o mesmo esquema do all_OS) ---
fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(file, fallback = []) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

// Escrita atômica: .tmp + rename. Um processo que cai no meio nunca deixa JSON pela metade.
function writeJSON(file, data) {
  const dest = path.join(DATA_DIR, file);
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, dest);
}

// Fila de promessas por arquivo: serializa "lê → altera → grava" dentro do
// processo. Por isso o serviço roda numa instância só. Chamadas de IA ficam FORA
// do lock; o lock cobre só o trecho curto de regravar.
const fileLocks = new Map();
async function withFileLock(file, fn) {
  const prev = fileLocks.get(file) || Promise.resolve();
  let release;
  const next = new Promise((r) => (release = r));
  fileLocks.set(file, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (fileLocks.get(file) === next) fileLocks.delete(file);
  }
}

function registrarErro(req, err, where, { status = 500, extra = null } = {}) {
  let entry;
  try {
    entry = errorLog.buildErrorEntry({ err, req, where, status, extra, ip: clientIp(req || { headers: {} }) });
    writeJSON(errorLog.ERROR_LOG_FILE, errorLog.appendError(readJSON(errorLog.ERROR_LOG_FILE), entry));
  } catch (e) {
    console.error('[error-log] não consegui registrar o erro:', e && e.message);
    if (!entry) return errorLog.newErrorId();
  }
  console.error(`[${entry.where}] ${entry.id}:`, (err && err.message) || err);
  return entry.id;
}
// Mensagem genérica + código. Nunca devolve err.message ao usuário.
function falhou(req, err, where, { status = 500, message, extra } = {}) {
  return errorLog.userFacingError(registrarErro(req, err, where, { status, extra }), message);
}

const USERS = 'users.json';
const COUNTERS = 'counters.json';
const SESSOES = 'sessoes.json';

const ROLES = ['admin', 'vendedor'];

// IDs nunca reaproveitados (lição do all_OS: reusar id vazava histórico da conta
// excluída para a nova). O próximo id mora em counters.json.
function proximoIdDeConta(users) {
  const c = readJSON(COUNTERS, {});
  const maior = users.reduce((m, u) => Math.max(m, Number(u.id) || 0), 0);
  const id = Math.max(Number(c.nextUserId) || 1, maior + 1);
  writeJSON(COUNTERS, { ...c, nextUserId: id + 1 });
  return String(id);
}

function seedAdmin() {
  if (fs.existsSync(path.join(DATA_DIR, USERS))) return;
  const senha = process.env.ADMIN_INITIAL_PASSWORD;
  if (!senha || senha.length < 12) {
    console.error('[FATAL] ADMIN_INITIAL_PASSWORD ausente ou curta demais (mínimo 12 chars).');
    process.exit(1);
  }
  const admin = {
    id: '1', username: 'admin', usernameLower: 'admin', name: 'Gestor Allos', role: 'admin',
    passwordHash: bcrypt.hashSync(senha, BCRYPT_ROUNDS), tokenVersion: 0, criadoEm: new Date().toISOString(),
  };
  writeJSON(USERS, [admin]);
  writeJSON(COUNTERS, { nextUserId: 2 });
  console.log('[auth] users.json criado. Login: admin / <ADMIN_INITIAL_PASSWORD>');
}
seedAdmin();

function publicUser(u) {
  return { id: u.id, username: u.username, name: u.name, role: u.role };
}

function signToken(u) {
  return jwt.sign({ id: u.id, role: u.role, tv: u.tokenVersion || 0 }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sessão expirada. Entre de novo.' });
  try {
    const p = jwt.verify(token, JWT_SECRET);
    const u = readJSON(USERS).find((x) => x.id === p.id);
    if (!u || (u.tokenVersion || 0) !== p.tv) return res.status(401).json({ error: 'Sessão expirada. Entre de novo.' });
    req.user = u;
    next();
  } catch {
    return res.status(401).json({ error: 'Sessão expirada. Entre de novo.' });
  }
}
function soAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito ao gestor.' });
  next();
}

app.post('/api/login', loginLimiter, async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const u = readJSON(USERS).find((x) => x.usernameLower === username);
  // Compara mesmo sem usuário, para o tempo de resposta não revelar quem existe.
  const ok = await bcrypt.compare(password, u ? u.passwordHash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
  if (!u || !ok) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  res.json({ token: signToken(u), user: publicUser(u) });
});

app.get('/api/me', auth, (req, res) => res.json(publicUser(req.user)));

// --- Administração de contas (gestor) ---
app.get('/api/admin/usuarios', auth, soAdmin, (req, res) => {
  res.json(readJSON(USERS).map((u) => ({ ...publicUser(u), criadoEm: u.criadoEm })));
});

app.post('/api/admin/usuarios', auth, soAdmin, async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const name = String(req.body?.name || '').trim().slice(0, 80);
  const password = String(req.body?.password || '');
  const role = ROLES.includes(req.body?.role) ? req.body.role : 'vendedor';
  if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username)) {
    return res.status(400).json({ error: 'Usuário: 3 a 30 caracteres (letras, números, ponto, hífen ou sublinhado).' });
  }
  if (!name) return res.status(400).json({ error: 'Informe o nome.' });
  if (password.length < 8) return res.status(400).json({ error: 'A senha precisa de pelo menos 8 caracteres.' });
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    const novo = await withFileLock(USERS, () => {
      const users = readJSON(USERS);
      if (users.some((u) => u.usernameLower === username.toLowerCase())) return null;
      const u = {
        id: proximoIdDeConta(users), username, usernameLower: username.toLowerCase(), name, role,
        passwordHash, tokenVersion: 0, criadoEm: new Date().toISOString(),
      };
      users.push(u);
      writeJSON(USERS, users);
      return u;
    });
    if (!novo) return res.status(409).json({ error: 'Já existe uma conta com esse usuário.' });
    res.status(201).json(publicUser(novo));
  } catch (err) {
    res.status(500).json(falhou(req, err, 'admin/criar-conta'));
  }
});

app.put('/api/admin/usuarios/:id/senha', auth, soAdmin, async (req, res) => {
  const password = String(req.body?.password || '');
  if (password.length < 8) return res.status(400).json({ error: 'A senha precisa de pelo menos 8 caracteres.' });
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const ok = await withFileLock(USERS, () => {
    const users = readJSON(USERS);
    const u = users.find((x) => x.id === req.params.id);
    if (!u) return false;
    u.passwordHash = passwordHash;
    u.tokenVersion = (u.tokenVersion || 0) + 1; // derruba as sessões abertas dessa conta
    writeJSON(USERS, users);
    return true;
  });
  if (!ok) return res.status(404).json({ error: 'Conta não encontrada.' });
  res.json({ ok: true });
});

app.delete('/api/admin/usuarios/:id', auth, soAdmin, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Você não pode excluir a própria conta.' });
  const ok = await withFileLock(USERS, () => {
    const users = readJSON(USERS);
    const resto = users.filter((u) => u.id !== req.params.id);
    if (resto.length === users.length) return false;
    writeJSON(USERS, resto);
    return true;
  });
  if (!ok) return res.status(404).json({ error: 'Conta não encontrada.' });
  res.json({ ok: true });
});

const PROMPTS_DIR = path.join(DATA_DIR, 'prompts');
const COMPRADORES_DIR = path.join(PROMPTS_DIR, 'compradores');
const BACKUP_DIR = path.join(PROMPTS_DIR, 'backup');
const PROMPTS_META = 'prompts-meta.json';
fs.mkdirSync(COMPRADORES_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

(function semearPromptsLocais() {
  const origem = path.join(__dirname, '..', '.prompts');
  if (process.env.NODE_ENV === 'test' || !fs.existsSync(origem)) return;
  const copiar = (de, para) => {
    if (fs.existsSync(para)) return;
    fs.copyFileSync(de, para);
    console.log(`[prompts] semeado de .prompts/: ${path.relative(PROMPTS_DIR, para)}`);
  };
  for (const f of fs.readdirSync(origem)) {
    const slot = vendas.SLOT_IDS.find((id) => f.startsWith(`${id}-`) || f === `${id}.md`);
    if (slot && f.endsWith('.md')) copiar(path.join(origem, f), path.join(PROMPTS_DIR, `${slot}.md`));
  }
  const origemC = path.join(origem, 'compradores');
  if (fs.existsSync(origemC)) {
    for (const f of fs.readdirSync(origemC).filter((x) => x.endsWith('.md'))) {
      const { comprador } = vendas.parseArquivoComprador(fs.readFileSync(path.join(origemC, f), 'utf-8'));
      if (comprador) copiar(path.join(origemC, f), path.join(COMPRADORES_DIR, `${comprador.id}.md`));
    }
  }
})();

function lerPrompt(slot) {
  const p = path.join(PROMPTS_DIR, `${slot}.md`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
}

function lerCriterios() {
  const md = lerPrompt('criterios');
  return md ? vendas.parseCriterios(md) : null;
}

function listarCompradores() {
  return fs.readdirSync(COMPRADORES_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => vendas.parseArquivoComprador(fs.readFileSync(path.join(COMPRADORES_DIR, f), 'utf-8')).comprador)
    .filter(Boolean)
    .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
}

function compradorPorId(id) {
  if (!/^[a-z0-9-]{2,40}$/.test(String(id || ''))) return null;
  const p = path.join(COMPRADORES_DIR, `${id}.md`);
  if (!fs.existsSync(p)) return null;
  return vendas.parseArquivoComprador(fs.readFileSync(p, 'utf-8')).comprador || null;
}

// Grava o arquivo novo guardando o anterior em backup/.
function gravarPromptComBackup(destino, conteudo, rotuloBackup) {
  if (fs.existsSync(destino)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(destino, path.join(BACKUP_DIR, `${rotuloBackup}-${ts}.md`));
  }
  const tmp = `${destino}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, conteudo);
  fs.renameSync(tmp, destino);
}

function promptsFaltando(etapa) {
  const precisa = etapa === 'conversa' ? ['metacomando'] : ['no', 'criterios', 'sintetizador', 'portfolio'];
  return precisa.filter((s) => !lerPrompt(s));
}

function cardDoComprador(c) {
  const { id, nome, papel, organizacao, segmento, canalCurto, trocas, minutos, resumo } = c;
  return { id, nome, papel, organizacao, segmento, canalCurto, trocas, minutos, resumo };
}

app.get('/api/compradores', auth, (req, res) => {
  res.json(listarCompradores().map(cardDoComprador));
});

app.get('/api/compradores/:id', auth, (req, res) => {
  const c = compradorPorId(req.params.id);
  if (!c) return res.status(404).json({ error: 'Comprador não encontrado.' });
  res.json({ ...cardDoComprador(c), ficha: c.ficha });
});

app.get('/api/preparacao', auth, (req, res) => {
  const criterios = lerCriterios() || [];
  res.json({
    portfolio: lerPrompt('portfolio') || '',
    criterios: criterios.map((c) => ({ numero: c.numero, nome: c.nome, definicao: c.definicao })),
  });
});

// --- Administração dos prompts (gestor) ---
function metaPrompts() { return readJSON(PROMPTS_META, {}); }
async function registrarMeta(chave, info) {
  await withFileLock(PROMPTS_META, () => {
    const m = metaPrompts();
    if (info) m[chave] = info; else delete m[chave];
    writeJSON(PROMPTS_META, m);
  });
}
function infoDoUpload(req) {
  const nomeArquivo = String(req.body?.nomeArquivo || '').slice(0, 120) || null;
  return { nomeArquivo, enviadoEm: new Date().toISOString(), por: req.user.username };
}

// Situação de tudo: o que está carregado e o que falta. Não devolve o conteúdo.
app.get('/api/admin/prompts', auth, soAdmin, (req, res) => {
  const meta = metaPrompts();
  res.json({
    slots: vendas.SLOTS.map((s) => {
      const conteudo = lerPrompt(s.id);
      return {
        id: s.id, nome: s.nome, descricao: s.descricao, opcional: !!s.opcional,
        carregado: !!conteudo,
        tamanho: conteudo ? conteudo.length : 0,
        problema: conteudo ? vendas.validarSlot(s.id, conteudo) : null,
        ...(meta[s.id] || {}),
      };
    }),
    compradores: listarCompradores().map((c) => ({
      ...cardDoComprador(c), canal: c.canal, ...(meta[`comprador:${c.id}`] || {}),
    })),
  });
});

// Upload: o navegador lê o .md e manda o texto. Valida antes de gravar.
app.put('/api/admin/prompts/:slot', auth, soAdmin, async (req, res) => {
  const slot = req.params.slot;
  if (!vendas.SLOT_IDS.includes(slot)) return res.status(404).json({ error: 'Prompt desconhecido.' });
  const conteudo = String(req.body?.conteudo || '').replace(/\r\n/g, '\n');
  const problema = vendas.validarSlot(slot, conteudo);
  if (problema) return res.status(400).json({ error: problema });
  try {
    gravarPromptComBackup(path.join(PROMPTS_DIR, `${slot}.md`), conteudo, slot);
    await registrarMeta(slot, infoDoUpload(req));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json(falhou(req, err, 'admin/prompt-upload'));
  }
});

// Comprador novo ou substituído (o id do cabeçalho decide qual).
app.post('/api/admin/compradores', auth, soAdmin, async (req, res) => {
  const conteudo = String(req.body?.conteudo || '').replace(/\r\n/g, '\n');
  const { comprador, erro } = vendas.parseArquivoComprador(conteudo);
  if (erro) return res.status(400).json({ error: erro });
  try {
    const destino = path.join(COMPRADORES_DIR, `${comprador.id}.md`);
    const substituiu = fs.existsSync(destino);
    gravarPromptComBackup(destino, conteudo, `comprador-${comprador.id}`);
    await registrarMeta(`comprador:${comprador.id}`, infoDoUpload(req));
    res.status(substituiu ? 200 : 201).json({ ok: true, id: comprador.id, nome: comprador.nome, substituiu });
  } catch (err) {
    res.status(500).json(falhou(req, err, 'admin/comprador-upload'));
  }
});

app.delete('/api/admin/compradores/:id', auth, soAdmin, async (req, res) => {
  const c = compradorPorId(req.params.id);
  if (!c) return res.status(404).json({ error: 'Comprador não encontrado.' });
  const destino = path.join(COMPRADORES_DIR, `${c.id}.md`);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  fs.renameSync(destino, path.join(BACKUP_DIR, `comprador-${c.id}-excluido-${ts}.md`));
  await registrarMeta(`comprador:${c.id}`, null);
  res.json({ ok: true });
});

const IA_MODEL = process.env.OPENAI_MODEL || 'gpt-6-luna';
function effortDe(env, padrao) {
  return process.env[env] === undefined ? padrao : process.env[env];
}
const EFFORT = {
  simulador: effortDe('SIMULADOR_EFFORT', 'high'),
  no: effortDe('AVALIADOR_EFFORT', 'high'),
  sintetizador: effortDe('SINTETIZADOR_EFFORT', 'medium'),
};
// max_completion_tokens cobre raciocínio + fala. Folga larga: se faltar, o
// modelo gasta tudo pensando e devolve texto vazio. Só se paga o que é gerado.
const MAX_TOKENS = { simulador: 6000, no: 8000, sintetizador: 12000 };

let openaiClient = null;
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openaiClient) {
    const OpenAI = require('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 180000, maxRetries: 2 });
  }
  return openaiClient;
}
const MODO_DEMONSTRACAO = !process.env.OPENAI_API_KEY;
if (MODO_DEMONSTRACAO) console.warn('[ia] OPENAI_API_KEY ausente: rodando em MODO DEMONSTRAÇÃO (respostas fixas).');
else console.log(`[ia] modelo ${IA_MODEL} · effort simulador=${EFFORT.simulador || '-'} nó=${EFFORT.no || '-'} sintetizador=${EFFORT.sintetizador || '-'}`);

async function chamarOpenAI({ etapa, system, messages }) {
  const openai = getOpenAI();
  const body = {
    model: IA_MODEL,
    max_completion_tokens: MAX_TOKENS[etapa],
    messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
  };
  if (EFFORT[etapa]) body.reasoning_effort = EFFORT[etapa];
  const resp = await openai.chat.completions.create(body);
  const u = resp.usage || {};
  console.log(`[ia:${etapa}] in=${u.prompt_tokens || 0} cached=${u.prompt_tokens_details?.cached_tokens || 0} out=${u.completion_tokens || 0}`);
  return resp.choices?.[0]?.message?.content || '';
}

function demoIA({ etapa, messages, contexto }) {
  if (etapa === 'simulador') {
    const troca = messages.filter((m) => m.role === 'user').length;
    const fim = troca >= (contexto?.trocas || 3) ? 'sim' : 'não';
    return `[ESTADO | troca ${troca} | fim: ${fim}]\n(modo demonstração) Resposta simulada à mensagem ${troca}.`;
  }
  if (etapa === 'no') {
    return 'ANÁLISE: (modo demonstração) Análise simulada deste critério.\nINTEGRIDADE: plena\nAUTORIA: parcial\nPOTÊNCIA: parcial\nCALIBRAÇÃO: plena\nEXCEPCIONALIDADE: ausente';
  }
  return '(modo demonstração) Retorno simulado.';
}

// Ponto único de chamada. Os testes trocam a implementação por _setIA.
let chamarIA = (args) => (MODO_DEMONSTRACAO ? Promise.resolve(demoIA(args)) : chamarOpenAI(args));

function lerSessoes() { return readJSON(SESSOES); }

async function alterarSessao(id, fn) {
  return withFileLock(SESSOES, () => {
    const lista = lerSessoes();
    const s = lista.find((x) => x.id === id);
    if (!s) return null;
    const r = fn(s);
    writeJSON(SESSOES, lista);
    return r === undefined ? s : r;
  });
}

function podeVer(user, s) {
  return user.role === 'admin' || s.userId === user.id;
}

function nomeDoUsuario(id) {
  const u = readJSON(USERS).find((x) => x.id === id);
  return u ? u.name : 'Conta excluída';
}

function trocasDe(s) {
  return s.turnos.filter((t) => t.autor === 'vendedor').length;
}

function visaoDaSessao(s, user) {
  const c = s.caso;
  const base = {
    id: s.id,
    userId: s.userId,
    vendedor: nomeDoUsuario(s.userId),
    comprador: cardDoComprador(c),
    status: s.status,
    fim: !!s.fim,
    trocas: trocasDe(s),
    tetoTrocas: vendas.tetoDeTrocas(c),
    iniciadaEm: s.iniciadaEm,
    encerradaEm: s.encerradaEm || null,
    mensagens: s.turnos.map((t) => (t.autor === 'vendedor'
      ? { autor: 'vendedor', texto: t.texto, em: t.em }
      : { autor: 'comprador', texto: vendas.separarEstado(t.bruto).visivel, em: t.em })),
    avaliacao: null,
  };
  if (s.avaliacao) {
    base.avaliacao = {
      nota: s.avaliacao.nota,
      saudacao: vendas.SAUDACAO,
      texto: s.avaliacao.texto,
      avaliadaEm: s.avaliacao.avaliadaEm,
    };
  }
  if (user.role === 'admin') {
    base.gestor = {
      turnosBrutos: s.turnos.map((t) => (t.autor === 'vendedor'
        ? { autor: 'vendedor', texto: t.texto, avisoEstado: !!t.avisoEstado }
        : { autor: 'comprador', texto: t.bruto, estadoValido: !!vendas.parseEstado(vendas.separarEstado(t.bruto).estado) })),
      criterios: s.avaliacao ? s.avaliacao.criterios : null,
      modelo: s.avaliacao ? s.avaliacao.modelo : null,
      erroAvaliacao: s.erroAvaliacao || null,
    };
  }
  return base;
}

function resumoDaSessao(s) {
  return {
    id: s.id,
    userId: s.userId,
    vendedor: nomeDoUsuario(s.userId),
    compradorId: s.compradorId,
    compradorNome: s.caso.nome,
    status: s.status,
    trocas: trocasDe(s),
    nota: s.avaliacao ? s.avaliacao.nota : null,
    iniciadaEm: s.iniciadaEm,
  };
}

const MSG_SEM_PROMPTS = 'O treino ainda não está configurado: o gestor precisa subir os prompts em Administração → Prompts.';

app.post('/api/sessoes', auth, async (req, res) => {
  const c = compradorPorId(req.body?.compradorId);
  if (!c) return res.status(400).json({ error: 'Comprador não encontrado.' });
  if (promptsFaltando('conversa').length) return res.status(503).json({ error: MSG_SEM_PROMPTS });
  const s = {
    id: `venda-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    userId: req.user.id,
    compradorId: c.id,
    caso: c,
    status: 'em_andamento',
    fim: false,
    turnos: [],
    iniciadaEm: new Date().toISOString(),
  };
  await withFileLock(SESSOES, () => {
    const lista = lerSessoes();
    lista.push(s);
    writeJSON(SESSOES, lista);
  });
  res.status(201).json(visaoDaSessao(s, req.user));
});

app.get('/api/sessoes', auth, (req, res) => {
  const lista = lerSessoes()
    .filter((s) => podeVer(req.user, s))
    .sort((a, b) => String(b.iniciadaEm).localeCompare(String(a.iniciadaEm)))
    .map(resumoDaSessao);
  res.json(lista);
});

app.get('/api/sessoes/:id', auth, (req, res) => {
  const s = lerSessoes().find((x) => x.id === req.params.id);
  if (!s || !podeVer(req.user, s)) return res.status(404).json({ error: 'Conversa não encontrada.' });
  res.json(visaoDaSessao(s, req.user));
});

// Conversas com uma resposta do comprador em andamento: evita dois envios
// simultâneos na mesma conversa (duplo clique, duas abas).
const respondendo = new Set();

app.post('/api/sessoes/:id/mensagens', auth, iaLimiter, async (req, res) => {
  const texto = String(req.body?.texto || '').trim();
  if (!texto) return res.status(400).json({ error: 'Escreva a mensagem.' });
  if (texto.length > 6000) return res.status(400).json({ error: 'Mensagem longa demais.' });

  const atual = lerSessoes().find((x) => x.id === req.params.id);
  if (!atual || atual.userId !== req.user.id) return res.status(404).json({ error: 'Conversa não encontrada.' });
  if (atual.status !== 'em_andamento' || atual.fim) {
    return res.status(409).json({ error: 'Esta conversa já terminou.' });
  }
  const c = atual.caso;
  if (trocasDe(atual) >= vendas.tetoDeTrocas(c)) {
    return res.status(409).json({ error: 'A conversa chegou ao limite de trocas. Encerre e avalie.' });
  }
  const metacomando = lerPrompt('metacomando');
  if (!metacomando) return res.status(503).json({ error: MSG_SEM_PROMPTS });
  if (respondendo.has(atual.id)) return res.status(409).json({ error: 'Aguarde a resposta do comprador.' });
  respondendo.add(atual.id);

  try {
    const turnoVendedor = {
      autor: 'vendedor',
      texto,
      em: new Date().toISOString(),
      ...(vendas.precisaAvisoDeEstado(atual.turnos) ? { avisoEstado: true } : {}),
    };
    const turnos = [...atual.turnos, turnoVendedor];
    const bruto = await chamarIA({
      etapa: 'simulador',
      system: vendas.montarPromptSimulador(metacomando, c.bloco1),
      messages: vendas.mensagensDoSimulador(turnos, lerPrompt('aviso')),
      contexto: { trocas: c.trocas },
    });
    if (!String(bruto || '').trim()) throw new Error('resposta vazia do simulador');

    const { estado, visivel } = vendas.separarEstado(bruto);
    const e = vendas.parseEstado(estado);
    const turnoComprador = { autor: 'comprador', bruto, em: new Date().toISOString() };

    const s = await alterarSessao(atual.id, (sess) => {
      sess.turnos.push(turnoVendedor, turnoComprador);
      if (e && e.fim) {
        sess.fim = true;
        sess.status = 'encerrada';
        sess.encerradaEm = new Date().toISOString();
      }
    });
    res.json({
      resposta: visivel,
      fim: !!s.fim,
      trocas: trocasDe(s),
    });
  } catch (err) {
    res.status(502).json(falhou(req, err, 'vendas/simulador', {
      message: '😵‍💫 O comprador não conseguiu responder agora. Envie a mensagem de novo.',
    }));
  } finally {
    respondendo.delete(atual.id);
  }
});

app.post('/api/sessoes/:id/encerrar', auth, async (req, res) => {
  const s = await alterarSessao(req.params.id, (sess) => {
    if (sess.userId !== req.user.id) return 'negado';
    if (sess.status === 'em_andamento') {
      sess.status = 'encerrada';
      sess.encerradaEm = new Date().toISOString();
    }
  });
  if (!s || s === 'negado') return res.status(404).json({ error: 'Conversa não encontrada.' });
  res.json(visaoDaSessao(s, req.user));
});

const TENTATIVAS_POR_NO = 3;

async function rodarNo(m, caso, criterio, logComEstado) {
  const prompt = vendas.montarPromptNo(m.no, {
    bloco1: caso.bloco1, ficha: caso.ficha, portfolio: m.portfolio, log: logComEstado, criterio,
  });
  let ultimo = '';
  for (let i = 0; i < TENTATIVAS_POR_NO; i++) {
    ultimo = await chamarIA({ etapa: 'no', messages: [{ role: 'user', content: prompt }] });
    const r = vendas.parseSaidaNo(ultimo);
    if (r.completo) return { ...r, bruto: ultimo, tentativas: i + 1 };
  }
  const e = new Error(`nó "${criterio.nome}" sem as cinco qualidades após ${TENTATIVAS_POR_NO} tentativas`);
  e.saida = String(ultimo).slice(0, 1500);
  throw e;
}

async function avaliarSessao(id) {
  const s = lerSessoes().find((x) => x.id === id);
  const c = s.caso;
  try {
    // Prompts lidos uma vez por avaliação: um upload no meio não mistura versões.
    const m = {
      no: lerPrompt('no'), portfolio: lerPrompt('portfolio'),
      sintetizador: lerPrompt('sintetizador'), criterios: lerCriterios(),
    };
    if (!m.no || !m.portfolio || !m.sintetizador || !m.criterios) throw new Error('prompts da avaliação ausentes no volume');
    const logComEstado = vendas.montarLog(c, s.turnos, { comEstado: true });
    const logSemEstado = vendas.montarLog(c, s.turnos, { comEstado: false });

    const resultados = await Promise.all(m.criterios.map((cr) => rodarNo(m, c, cr, logComEstado)));
    const notas = resultados.map((r) => vendas.notaDoCriterio(r.qualidades));
    const nota = vendas.notaFinal(notas);

    const texto = await chamarIA({
      etapa: 'sintetizador',
      messages: [{
        role: 'user',
        content: vendas.montarPromptSintetizador(m.sintetizador, {
          log: logSemEstado,
          analises: vendas.montarAnalises(m.criterios, resultados),
        }),
      }],
    });
    if (!String(texto || '').trim()) throw new Error('resposta vazia do sintetizador');

    await alterarSessao(id, (sess) => {
      sess.status = 'avaliada';
      sess.erroAvaliacao = null;
      sess.avaliacao = {
        nota,
        texto: texto.trim(),
        modelo: MODO_DEMONSTRACAO ? 'demonstração' : IA_MODEL,
        avaliadaEm: new Date().toISOString(),
        criterios: m.criterios.map((cr, i) => ({
          numero: cr.numero,
          nome: cr.nome,
          nota: notas[i],
          analise: resultados[i].analise,
          qualidades: resultados[i].qualidades,
          tentativas: resultados[i].tentativas,
        })),
      };
    });
  } catch (err) {
    const codigo = registrarErro(null, err, 'vendas/avaliacao', { extra: { sessaoId: id, saida: err.saida || null } });
    await alterarSessao(id, (sess) => {
      sess.status = 'erro_avaliacao';
      sess.erroAvaliacao = codigo;
    });
  }
}

app.post('/api/sessoes/:id/avaliar', auth, async (req, res) => {
  if (promptsFaltando('avaliacao').length) return res.status(503).json({ error: MSG_SEM_PROMPTS });
  let motivo = null;
  const s = await alterarSessao(req.params.id, (sess) => {
    if (sess.userId !== req.user.id && req.user.role !== 'admin') { motivo = 'negado'; return; }
    if (sess.turnos.length === 0) { motivo = 'vazia'; return; }
    if (sess.status === 'avaliando' || sess.status === 'avaliada') { motivo = 'ja'; return; }
    sess.status = 'avaliando';
    if (!sess.encerradaEm) sess.encerradaEm = new Date().toISOString();
  });
  if (!s || motivo === 'negado') return res.status(404).json({ error: 'Conversa não encontrada.' });
  if (motivo === 'vazia') return res.status(400).json({ error: 'A conversa não tem mensagens para avaliar.' });
  if (motivo !== 'ja') avaliarSessao(s.id); // segundo plano, de propósito sem await
  res.status(202).json(visaoDaSessao(lerSessoes().find((x) => x.id === s.id), req.user));
});

// Uma avaliação em curso morre com o processo (deploy, restart). No boot, quem
// ficou "avaliando" vira erro, e a tela oferece avaliar de novo.
(function recuperarAvaliacoesInterrompidas() {
  const lista = lerSessoes();
  let mudou = false;
  for (const s of lista) {
    if (s.status === 'avaliando') { s.status = 'erro_avaliacao'; s.erroAvaliacao = 'interrompida'; mudou = true; }
  }
  if (mudou) writeJSON(SESSOES, lista);
})();

// --- Front-end (build do Vite) ---
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false }));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

const PORT = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Treino de Vendas Allos rodando na porta ${PORT}`));
}

module.exports = {
  app,
  // Só para os testes: troca a IA por uma implementação controlada.
  _setIA(fn) { chamarIA = fn; },
};
