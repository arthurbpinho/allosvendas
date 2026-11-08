import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export function iniciais(nome) {
  return String(nome || '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

export function duracaoPrevista(c) {
  return c.minutos ? `~${c.minutos} min · até ${c.trocas} trocas` : `ao longo do dia · até ${c.trocas} trocas`;
}

export default function Compradores() {
  const [compradores, setCompradores] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.compradores().then(setCompradores).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">Treino de vendas · Allos</div>
        <h2>Escolha o <span className="accent">comprador</span></h2>
        <p>
          Você atua como vendedor da Allos. Cada comprador chega por um caminho diferente e pede
          uma coisa de entrada, mas raramente é só isso. Antes da conversa você vê a ficha dele,
          o portfólio e os critérios da avaliação. Você sempre envia a primeira mensagem.
        </p>
        <div className="ornament" />
      </div>

      {error && <div className="alert error">{error}</div>}

      {!compradores && !error ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
          <span className="spinner" />
        </div>
      ) : compradores && compradores.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--ink-soft)' }}>
          Nenhum comprador cadastrado ainda. O gestor sobe os compradores em Administração → Prompts.
        </div>
      ) : (
        <div className="card-grid">
          {(compradores || []).map((c) => (
            <div key={c.id} className="character-card" onClick={() => navigate(`/compradores/${c.id}`)}>
              <div className="character-card-top">
                <span className="comprador-avatar" aria-hidden="true">{iniciais(c.nome)}</span>
                <div className="character-card-meta">
                  <div className="character-card-header">
                    <h3>{c.nome}</h3>
                  </div>
                  <div className="age">{c.papel}</div>
                  <div className="age">{c.organizacao}</div>
                </div>
              </div>
              <div className="comprador-tags">
                <span className="tag-pill">{c.segmento}</span>
                <span className="tag-pill">{c.canalCurto}</span>
              </div>
              <p>{c.resumo}</p>
              <div className="comprador-duracao">{duracaoPrevista(c)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
