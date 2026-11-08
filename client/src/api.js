// Cliente HTTP do app. Mesmo esquema do all_OS: token JWT no localStorage,
// 401 derruba a sessão e devolve ao login.
const BASE = '/api';
const TOKEN_KEY = 'allos_vendas_token';
const USER_KEY = 'allos_vendas_user';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function getSavedUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
}
function saveAuth(token, user) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {}
}
export function clearAuth() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {}
}

const sessionListeners = new Set();
export function onSessionExpired(fn) {
  sessionListeners.add(fn);
  return () => sessionListeners.delete(fn);
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(BASE + path, { ...options, headers });
  } catch {
    throw new Error('Sem conexão com o servidor. Verifique a internet e tente de novo.');
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && path !== '/login') {
    clearAuth();
    for (const fn of sessionListeners) { try { fn(); } catch {} }
  }
  if (!res.ok) throw new Error((data && data.error) || `Erro ${res.status}`);
  return data;
}

const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body || {}) });

export const api = {
  async login(username, password) {
    const r = await post('/login', { username, password });
    saveAuth(r.token, r.user);
    return r.user;
  },
  me: () => request('/me'),

  compradores: () => request('/compradores'),
  comprador: (id) => request(`/compradores/${encodeURIComponent(id)}`),
  preparacao: () => request('/preparacao'),

  iniciarSessao: (compradorId) => post('/sessoes', { compradorId }),
  sessoes: () => request('/sessoes'),
  sessao: (id) => request(`/sessoes/${encodeURIComponent(id)}`),
  enviar: (id, texto) => post(`/sessoes/${encodeURIComponent(id)}/mensagens`, { texto }),
  encerrar: (id) => post(`/sessoes/${encodeURIComponent(id)}/encerrar`),
  avaliar: (id) => post(`/sessoes/${encodeURIComponent(id)}/avaliar`),

  usuarios: () => request('/admin/usuarios'),
  criarUsuario: (dados) => post('/admin/usuarios', dados),
  trocarSenha: (id, password) => request(`/admin/usuarios/${encodeURIComponent(id)}/senha`, { method: 'PUT', body: JSON.stringify({ password }) }),
  excluirUsuario: (id) => request(`/admin/usuarios/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  promptsStatus: () => request('/admin/prompts'),
  subirPrompt: (slot, conteudo, nomeArquivo) => request(`/admin/prompts/${encodeURIComponent(slot)}`, { method: 'PUT', body: JSON.stringify({ conteudo, nomeArquivo }) }),
  subirComprador: (conteudo, nomeArquivo) => post('/admin/compradores', { conteudo, nomeArquivo }),
  excluirComprador: (id) => request(`/admin/compradores/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
