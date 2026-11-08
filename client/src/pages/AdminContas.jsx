import { useEffect, useState } from 'react';
import { api } from '../api';
import { dataHora } from './Conversas';

// Contas da demonstração. Sem cadastro público: o gestor cria cada acesso.
export default function AdminContas({ user }) {
  const [lista, setLista] = useState([]);
  const [form, setForm] = useState({ name: '', username: '', password: '', role: 'vendedor' });
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = () => api.usuarios().then(setLista).catch((e) => setError(e.message));
  useEffect(() => { carregar(); }, []);

  async function criar(e) {
    e.preventDefault();
    setError(''); setAviso('');
    setSalvando(true);
    try {
      const u = await api.criarUsuario(form);
      setAviso(`Conta "${u.username}" criada.`);
      setForm({ name: '', username: '', password: '', role: 'vendedor' });
      carregar();
    } catch (err) {
      setError(err.message);
    } finally {
      setSalvando(false);
    }
  }

  async function trocarSenha(u) {
    const nova = window.prompt(`Nova senha para ${u.username} (mínimo 8 caracteres):`);
    if (!nova) return;
    setError(''); setAviso('');
    try {
      await api.trocarSenha(u.id, nova);
      setAviso(`Senha de "${u.username}" trocada.`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function excluir(u) {
    if (!window.confirm(`Excluir a conta "${u.username}"? As conversas dela ficam no histórico.`)) return;
    setError(''); setAviso('');
    try {
      await api.excluirUsuario(u.id);
      carregar();
    } catch (err) {
      setError(err.message);
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">Gestão</div>
        <h2><span className="accent">Contas</span></h2>
        <p>Crie os acessos de quem vai treinar. O vendedor entra direto na escolha do comprador.</p>
        <div className="ornament" />
      </div>

      {error && <div className="alert error">{error}</div>}
      {aviso && <div className="alert">{aviso}</div>}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Nova conta</h3>
        <form className="admin-form" onSubmit={criar}>
          <div className="form-group">
            <label htmlFor="nome">Nome</label>
            <input id="nome" value={form.name} onChange={set('name')} required />
          </div>
          <div className="form-group">
            <label htmlFor="usuario">Usuário</label>
            <input id="usuario" value={form.username} onChange={set('username')} autoCapitalize="none" required />
          </div>
          <div className="form-group">
            <label htmlFor="senha">Senha</label>
            <input id="senha" type="text" value={form.password} onChange={set('password')} minLength={8} required />
          </div>
          <div className="form-group">
            <label htmlFor="papel">Papel</label>
            <select id="papel" value={form.role} onChange={set('role')}>
              <option value="vendedor">Vendedor</option>
              <option value="admin">Gestor</option>
            </select>
          </div>
          <div>
            <button className="btn btn-primary" type="submit" disabled={salvando}>{salvando ? 'Criando…' : 'Criar conta'}</button>
          </div>
        </form>
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="admin-table">
          <thead>
            <tr><th>Nome</th><th>Usuário</th><th>Papel</th><th>Criada em</th><th /></tr>
          </thead>
          <tbody>
            {lista.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.username}</td>
                <td>{u.role === 'admin' ? 'Gestor' : 'Vendedor'}</td>
                <td>{dataHora(u.criadoEm)}</td>
                <td className="actions">
                  <button className="btn btn-outline btn-sm" onClick={() => trocarSenha(u)}>Trocar senha</button>
                  {u.id !== user.id && (
                    <button className="btn btn-outline btn-sm" onClick={() => excluir(u)}>Excluir</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
