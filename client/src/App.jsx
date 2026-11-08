import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import Login from './pages/Login';
import Compradores from './pages/Compradores';
import Preparacao from './pages/Preparacao';
import Conversa from './pages/Conversa';
import Conversas from './pages/Conversas';
import ConversaDetalhe from './pages/ConversaDetalhe';
import AdminContas from './pages/AdminContas';
import AdminPrompts from './pages/AdminPrompts';
import ThemeToggle from './components/ThemeToggle';
import { api, getToken, getSavedUser, clearAuth, onSessionExpired } from './api';
import { ICONS } from './icons';

// Shell do all_OS reduzido ao treino de vendas: o login cai direto na escolha do
// comprador. Sem trilha, modos, perfil ou qualquer coisa da clínica.
export default function App() {
  const [user, setUser] = useState(() => (getToken() ? getSavedUser() : null));
  const [checking, setChecking] = useState(!!getToken());
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Confirma o token no servidor (conta excluída ou senha trocada derruba a sessão).
  useEffect(() => {
    if (!getToken()) return;
    let vivo = true;
    api.me()
      .then((u) => { if (vivo) setUser(u); })
      .catch(() => { if (vivo) { clearAuth(); setUser(null); } })
      .finally(() => { if (vivo) setChecking(false); });
    return () => { vivo = false; };
  }, []);

  useEffect(() => onSessionExpired(() => setUser(null)), []);
  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);

  function sair() {
    clearAuth();
    setUser(null);
    navigate('/login');
  }

  if (checking) {
    return <div style={{ padding: 40, textAlign: 'center' }}><span className="spinner" /></div>;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLogin={(u) => { setUser(u); navigate('/'); }} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const isAdmin = user.role === 'admin';
  const isActive = (p) => location.pathname === p || location.pathname.startsWith(p + '/');

  return (
    <div className="app-layout">
      <header className="app-topbar">
        <button
          className="hamburger-btn"
          onClick={() => setMobileNavOpen((v) => !v)}
          aria-label="Abrir menu"
          aria-expanded={mobileNavOpen}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="mobile-topbar-logo">all<span className="accent">_OS</span></div>
        <div className="topbar-actions">
          <ThemeToggle />
        </div>
      </header>

      <div
        className={`mobile-nav-backdrop ${mobileNavOpen ? 'open' : ''}`}
        onClick={() => setMobileNavOpen(false)}
        aria-hidden="true"
      />

      <aside className={`sidebar ${mobileNavOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <h1>all<span className="accent">_OS</span></h1>
          <p>Treino de Vendas</p>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section">Treino</div>
          <Link to="/compradores" className={isActive('/compradores') || isActive('/conversa') ? 'active' : ''} title="Compradores">
            {ICONS.characters}<span>Compradores</span>
          </Link>
          <Link to="/conversas" className={isActive('/conversas') ? 'active' : ''} title={isAdmin ? 'Conversas da equipe' : 'Minhas conversas'}>
            {ICONS.log}<span>{isAdmin ? 'Conversas da equipe' : 'Minhas conversas'}</span>
          </Link>
          {isAdmin && (
            <>
              <div className="nav-section">Gestão</div>
              <Link to="/admin/prompts" className={isActive('/admin/prompts') ? 'active' : ''} title="Prompts">
                {ICONS.evaluate}<span>Prompts</span>
              </Link>
              <Link to="/admin/contas" className={isActive('/admin/contas') ? 'active' : ''} title="Contas">
                {ICONS.admin}<span>Contas</span>
              </Link>
            </>
          )}
        </nav>

        <div className="sidebar-user">
          <div className="profile-mini">
            <div className="profile-mini-info">
              <div className="profile-mini-name">{user.name}</div>
              <div className="profile-mini-role">{isAdmin ? 'Gestor' : 'Vendedor'}</div>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={sair} title="Sair">
            {ICONS.exit}
          </button>
        </div>
      </aside>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<Navigate to="/compradores" replace />} />
          <Route path="/login" element={<Navigate to="/compradores" replace />} />
          <Route path="/compradores" element={<Compradores />} />
          <Route path="/compradores/:id" element={<Preparacao />} />
          <Route path="/conversa/:id" element={<Conversa user={user} />} />
          <Route path="/conversas" element={<Conversas user={user} />} />
          <Route path="/conversas/:id" element={<ConversaDetalhe user={user} />} />
          {isAdmin && <Route path="/admin/contas" element={<AdminContas user={user} />} />}
          {isAdmin && <Route path="/admin/prompts" element={<AdminPrompts />} />}
          <Route path="*" element={<Navigate to="/compradores" replace />} />
        </Routes>
      </main>
    </div>
  );
}
