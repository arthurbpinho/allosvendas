import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../api';
import Markdown from '../components/Markdown';
import { iniciais, duracaoPrevista } from './Compradores';

export default function Preparacao() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [comprador, setComprador] = useState(null);
  const [prep, setPrep] = useState(null);
  const [aba, setAba] = useState('ficha');
  const [error, setError] = useState('');
  const [iniciando, setIniciando] = useState(false);

  useEffect(() => {
    Promise.all([api.comprador(id), api.preparacao()])
      .then(([c, p]) => { setComprador(c); setPrep(p); })
      .catch((e) => setError(e.message));
  }, [id]);

  async function iniciar() {
    setIniciando(true);
    setError('');
    try {
      const s = await api.iniciarSessao(id);
      navigate(`/conversa/${s.id}`);
    } catch (e) {
      setError(e.message);
      setIniciando(false);
    }
  }

  if (error && !comprador) return <div className="alert error">{error}</div>;
  if (!comprador || !prep) {
    return <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}><span className="spinner" /></div>;
  }

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow"><Link to="/compradores">Compradores</Link> · Preparação</div>
        <div className="prep-titulo">
          <span className="comprador-avatar grande" aria-hidden="true">{iniciais(comprador.nome)}</span>
          <div>
            <h2>{comprador.nome}</h2>
            <p style={{ margin: 0 }}>{comprador.papel} · {comprador.organizacao}</p>
            <div className="comprador-tags">
              <span className="tag-pill">{comprador.segmento}</span>
              <span className="tag-pill">{comprador.canalCurto}</span>
              <span className="tag-pill">{duracaoPrevista(comprador)}</span>
            </div>
          </div>
        </div>
        <div className="ornament" />
      </div>

      <div className="prep-abas" role="tablist">
        {[
          ['ficha', 'Ficha do comprador'],
          ['portfolio', 'Portfólio da Allos'],
          ['criterios', 'Critérios da avaliação'],
        ].map(([k, rotulo]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={aba === k}
            className={`prep-aba ${aba === k ? 'ativa' : ''}`}
            onClick={() => setAba(k)}
          >
            {rotulo}
          </button>
        ))}
      </div>

      <div className="card prep-conteudo">
        {aba === 'ficha' && <Markdown text={comprador.ficha} />}
        {aba === 'portfolio' && <Markdown text={prep.portfolio} />}
        {aba === 'criterios' && (
          <div className="md">
            <p>A conversa é avaliada em oito critérios, cada um de forma independente.</p>
            <ol className="criterios-lista">
              {prep.criterios.map((c) => (
                <li key={c.nome}>
                  <strong className="criterio-nome">{c.nome}.</strong> {c.definicao}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="prep-acoes">
        <p>Quem começa é você. A conversa termina quando o comprador encerra ou quando você clica em encerrar.</p>
        <button className="btn btn-primary btn-lg" onClick={iniciar} disabled={iniciando}>
          {iniciando ? 'Abrindo…' : 'Iniciar conversa'}
        </button>
      </div>
    </div>
  );
}
