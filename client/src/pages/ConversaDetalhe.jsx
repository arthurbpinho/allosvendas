import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../api';
import RichText from '../components/RichText';
import ScoreBadge from '../components/ScoreBadge';
import { STATUS_ROTULO, dataHora } from './Conversas';

const QUALIDADES = [
  ['integridade', 'Integridade'],
  ['autoria', 'Autoria'],
  ['potencia', 'Potência'],
  ['calibracao', 'Calibração'],
  ['excepcionalidade', 'Excepcionalidade'],
];

export default function ConversaDetalhe({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  const [verEstado, setVerEstado] = useState(false);
  const isAdmin = user.role === 'admin';

  const carregar = useCallback(() => api.sessao(id).then(setS).catch((e) => setError(e.message)), [id]);

  useEffect(() => { carregar(); }, [carregar]);

  // A avaliação roda em segundo plano no servidor: consulta até terminar.
  useEffect(() => {
    if (!s || s.status !== 'avaliando') return undefined;
    const t = setInterval(carregar, 4000);
    return () => clearInterval(t);
  }, [s, carregar]);

  async function avaliarDeNovo() {
    setError('');
    try {
      setS(await api.avaliar(id));
    } catch (e) {
      setError(e.message);
    }
  }

  if (!s) {
    return error
      ? <div className="alert error">{error}</div>
      : <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}><span className="spinner" /></div>;
  }

  const c = s.comprador;
  const souDono = s.userId === user.id;

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow"><Link to="/conversas">Histórico</Link> · {STATUS_ROTULO[s.status] || s.status}</div>
        <h2>{c.nome}</h2>
        <p style={{ margin: 0 }}>
          {isAdmin && <>{s.vendedor} · </>}{c.canalCurto} · {s.trocas} trocas · {dataHora(s.iniciadaEm)}
        </p>
        <div className="ornament" />
      </div>

      {error && <div className="alert error">{error}</div>}

      {(s.status === 'em_andamento' || s.status === 'encerrada') && souDono && (
        <div className="card">
          <p style={{ marginTop: 0 }}>{s.status === 'em_andamento' ? 'Esta conversa ainda está aberta.' : 'Esta conversa terminou e ainda não foi avaliada.'}</p>
          <button className="btn btn-primary" onClick={() => navigate(`/conversa/${s.id}`)}>
            {s.status === 'em_andamento' ? 'Continuar conversa' : 'Ir para a avaliação'}
          </button>
        </div>
      )}

      {s.status === 'avaliando' && (
        <div className="card evaluating-card">
          <div className="evaluating-orb">
            <span className="orb-pulse" /><span className="orb-pulse delay-1" /><span className="orb-pulse delay-2" />
            <span className="orb-core" />
          </div>
          <div className="evaluating-status">
            <h4>Avaliando a conversa</h4>
            <p style={{ color: 'var(--ink-soft)' }}>
              O relatório de desempenho está sendo gerado. Leva alguns minutos; pode sair desta
              tela e voltar depois.
            </p>
          </div>
        </div>
      )}

      {s.status === 'erro_avaliacao' && (
        <div className="card">
          <div className="alert error" style={{ marginTop: 0 }}>
            A avaliação não terminou{isAdmin && s.gestor?.erroAvaliacao ? ` (código ${s.gestor.erroAvaliacao})` : ''}. Tente de novo.
          </div>
          {(souDono || isAdmin) && <button className="btn btn-primary" onClick={avaliarDeNovo}>Avaliar de novo</button>}
        </div>
      )}

      {s.avaliacao && (
        <div className="card relatorio">
          <div className="relatorio-nota">
            <span className="post-stat-label">Nota final</span>
            <ScoreBadge score={s.avaliacao.nota} size="xl" />
          </div>
          <p className="relatorio-saudacao">{s.avaliacao.saudacao}</p>
          <div className="post-evaluation-body relatorio-texto">
            <RichText text={s.avaliacao.texto} />
          </div>
        </div>
      )}

      {isAdmin && s.gestor?.criterios && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Análises por critério <span className="so-gestor">visão do gestor</span></h3>
          <div className="criterios-gestor">
            {s.gestor.criterios.map((cr) => (
              <div key={cr.nome} className="criterio-gestor">
                <div className="criterio-gestor-topo">
                  <strong>{cr.numero} · {cr.nome}</strong>
                  <span className="criterio-gestor-nota">{cr.nota}/10</span>
                </div>
                <div className="qualidades">
                  {QUALIDADES.map(([k, rotulo]) => (
                    <span key={k} className={`qualidade q-${cr.qualidades[k]}`} title={`${rotulo}: ${cr.qualidades[k]}`}>
                      {rotulo}: {cr.qualidades[k]}
                    </span>
                  ))}
                </div>
                <p className="criterio-gestor-analise"><RichText text={cr.analise} /></p>
              </div>
            ))}
          </div>
          {s.gestor.modelo && <p style={{ color: 'var(--ink-soft)', fontSize: 13, marginBottom: 0 }}>Modelo: {s.gestor.modelo}</p>}
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Transcrição</h3>
          {isAdmin && (
            <label className="toggle-estado">
              <input type="checkbox" checked={verEstado} onChange={(e) => setVerEstado(e.target.checked)} />
              Mostrar linhas de estado
            </label>
          )}
        </div>
        <div className="log-detail">
          {(isAdmin && verEstado ? s.gestor.turnosBrutos : s.mensagens).map((m, i) => (
            <div key={i} className={`msg ${m.autor === 'vendedor' ? 'user' : 'assistant'}`}>
              <strong>{m.autor === 'vendedor' ? `Vendedor${isAdmin ? ` · ${s.vendedor}` : ''}` : c.nome}</strong>
              {isAdmin && verEstado && m.avisoEstado && <div className="aviso-estado">[aviso de estado enviado ao simulador]</div>}
              {isAdmin && verEstado && m.autor === 'comprador' && !m.estadoValido && <div className="aviso-estado">sem linha de estado válida</div>}
              <div className={isAdmin && verEstado ? 'msg-bruta' : ''} style={{ whiteSpace: 'pre-wrap' }}>
                <RichText text={m.texto} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
