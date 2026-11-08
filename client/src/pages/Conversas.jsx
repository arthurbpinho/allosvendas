import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import ScoreBadge from '../components/ScoreBadge';

export const STATUS_ROTULO = {
  em_andamento: 'Em andamento',
  encerrada: 'Aguardando avaliação',
  avaliando: 'Avaliando…',
  avaliada: 'Avaliada',
  erro_avaliacao: 'Falha na avaliação',
};

export function dataHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Histórico. O vendedor vê as próprias conversas; o gestor, as de toda a equipe.
export default function Conversas({ user }) {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const isAdmin = user.role === 'admin';

  useEffect(() => {
    api.sessoes().then(setLista).catch((e) => setError(e.message));
  }, []);

  function abrir(s) {
    navigate(s.status === 'em_andamento' || s.status === 'encerrada' ? `/conversa/${s.id}` : `/conversas/${s.id}`);
  }

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">Histórico</div>
        <h2>{isAdmin ? <>Conversas da <span className="accent">equipe</span></> : <>Minhas <span className="accent">conversas</span></>}</h2>
        <p>Cada conversa guarda a transcrição e o relatório de desempenho gerado depois do treino.</p>
        <div className="ornament" />
      </div>

      {error && <div className="alert error">{error}</div>}

      {!lista && !error && <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}><span className="spinner" /></div>}

      {lista && lista.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--ink-soft)' }}>
          Nenhuma conversa ainda. Escolha um comprador para começar.
        </div>
      )}

      {lista && lista.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Data</th>
                {isAdmin && <th>Vendedor</th>}
                <th>Comprador</th>
                <th>Trocas</th>
                <th>Situação</th>
                <th>Nota</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((s) => (
                <tr key={s.id} onClick={() => abrir(s)} style={{ cursor: 'pointer' }}>
                  <td>{dataHora(s.iniciadaEm)}</td>
                  {isAdmin && <td>{s.vendedor}</td>}
                  <td>{s.compradorNome}</td>
                  <td>{s.trocas}</td>
                  <td>{STATUS_ROTULO[s.status] || s.status}</td>
                  <td>{s.nota !== null ? <ScoreBadge score={s.nota} /> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
