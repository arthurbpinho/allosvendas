import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import RichText from '../components/RichText';
import Markdown from '../components/Markdown';
import { iniciais } from './Compradores';

export default function Conversa({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [sessao, setSessao] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [input, setInput] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [terminou, setTerminou] = useState(false);
  const [trocas, setTrocas] = useState(0);
  const [error, setError] = useState('');
  const [confirmarEncerrar, setConfirmarEncerrar] = useState(false);
  const [avaliando, setAvaliando] = useState(false);
  const [materiais, setMateriais] = useState(null); // { ficha, portfolio, criterios } quando aberto
  const [abaMaterial, setAbaMaterial] = useState('ficha');
  const fimRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    api.sessao(id)
      .then((s) => {
        // Conversa que não está mais em andamento abre na tela do resultado.
        if (s.status !== 'em_andamento' && s.status !== 'encerrada') {
          navigate(`/conversas/${s.id}`, { replace: true });
          return;
        }
        setSessao(s);
        setMensagens(s.mensagens);
        setTrocas(s.trocas);
        setTerminou(s.status === 'encerrada');
      })
      .catch((e) => setError(e.message));
  }, [id, navigate]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensagens, enviando]);

  // Textarea cresce com o texto, até um teto.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  async function enviar() {
    const texto = input.trim();
    if (!texto || enviando || terminou) return;
    setError('');
    setInput('');
    setMensagens((m) => [...m, { autor: 'vendedor', texto }]);
    setEnviando(true);
    try {
      const r = await api.enviar(id, texto);
      setMensagens((m) => [...m, { autor: 'comprador', texto: r.resposta }]);
      setTrocas(r.trocas);
      if (r.fim) setTerminou(true);
    } catch (e) {
      // A mensagem não foi registrada: volta para o campo, para reenviar.
      setMensagens((m) => m.slice(0, -1));
      setInput(texto);
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviar();
    }
  }

  async function encerrar() {
    setConfirmarEncerrar(false);
    try {
      await api.encerrar(id);
      setTerminou(true);
    } catch (e) {
      setError(e.message);
    }
  }

  async function avaliar() {
    setAvaliando(true);
    setError('');
    try {
      await api.avaliar(id);
      navigate(`/conversas/${id}`);
    } catch (e) {
      setError(e.message);
      setAvaliando(false);
    }
  }

  async function abrirMateriais() {
    try {
      const [c, p] = await Promise.all([api.comprador(sessao.comprador.id), api.preparacao()]);
      setMateriais({ ficha: c.ficha, portfolio: p.portfolio, criterios: p.criterios });
    } catch (e) {
      setError(e.message);
    }
  }

  if (!sessao) {
    return error
      ? <div className="alert error">{error}</div>
      : <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}><span className="spinner" /></div>;
  }

  const c = sessao.comprador;
  const relogio = c.minutos ? `~${Math.round((trocas * c.minutos) / c.trocas)} de ${c.minutos} min` : null;

  return (
    <div className="chat-container">
      <div className="chat-header">
        <button onClick={() => navigate('/compradores')} className="btn btn-outline btn-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          Sair
        </button>
        <span className="comprador-avatar chat-header-avatar" aria-hidden="true">{iniciais(c.nome)}</span>
        <div className="chat-title">
          <h3>{c.nome}</h3>
          <div className="chat-status">{c.canalCurto} · {c.papel}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="timer-chip" title="Trocas: mensagens suas já respondidas">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            <span>troca {trocas}/{c.trocas}{relogio ? ` · ${relogio}` : ''}</span>
          </div>
          <button onClick={abrirMateriais} className="btn btn-outline btn-sm" title="Ficha, portfólio e critérios">
            Materiais
          </button>
          {!terminou && (
            <button
              onClick={() => setConfirmarEncerrar(true)}
              disabled={enviando}
              className="btn btn-secondary btn-sm"
            >
              Encerrar conversa
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="alert error">
          {error}
          <button onClick={() => setError('')} className="close">×</button>
        </div>
      )}

      <div className="chat-messages">
        {mensagens.length === 0 && (
          <div className="empty-chat" style={{ marginTop: 80 }}>
            Você abre a conversa. {c.canalCurto === 'WhatsApp'
              ? 'Sua primeira mensagem sai hoje às 10h.'
              : 'Escreva como você começaria.'}
          </div>
        )}

        {mensagens.map((m, i) => {
          const role = m.autor === 'vendedor' ? 'user' : 'assistant';
          return (
            <div key={i} className={`chat-message-row ${role}`}>
              <div className="chat-message-author">{m.autor === 'vendedor' ? user.name : c.nome}</div>
              <div className={`chat-message ${role}`}><RichText text={m.texto} /></div>
            </div>
          );
        })}

        {enviando && (
          <div className="chat-message-row assistant">
            <div className="chat-message-author">{c.nome}</div>
            <div className="chat-message assistant" style={{ fontStyle: 'italic', opacity: 0.7 }}>
              <span className="loading-dots">Respondendo</span>
            </div>
          </div>
        )}

        <div ref={fimRef} />
      </div>

      {terminou ? (
        <div className="chat-input-area session-limit-bar conversa-fim">
          <span>A conversa terminou. Gere o relatório de desempenho.</span>
          <button className="btn btn-primary" onClick={avaliar} disabled={avaliando}>
            {avaliando ? 'Enviando…' : 'Avaliar conversa'}
          </button>
        </div>
      ) : (
        <div className="chat-input-area">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Sua mensagem…  ·  Enter envia · Shift+Enter quebra linha"
            rows={1}
            disabled={enviando}
          />
          <button
            type="button"
            className="icon-btn primary"
            onClick={enviar}
            disabled={!input.trim() || enviando}
            title="Enviar"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      )}

      {confirmarEncerrar && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setConfirmarEncerrar(false); }}>
          <div className="modal" style={{ maxWidth: 460 }}>
            <h3>Encerrar a conversa</h3>
            <p style={{ color: 'var(--ink-soft)', fontSize: 14, marginTop: -4, marginBottom: 18, lineHeight: 1.55 }}>
              Depois de encerrar você não manda mais mensagens. A avaliação lê a conversa como ela está.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setConfirmarEncerrar(false)}>Continuar conversando</button>
              <button type="button" className="btn btn-primary" onClick={encerrar}>Encerrar</button>
            </div>
          </div>
        </div>
      )}

      {materiais && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setMateriais(null); }}>
          <div className="modal materiais-modal">
            <div className="prep-abas" role="tablist">
              {[['ficha', 'Ficha'], ['portfolio', 'Portfólio'], ['criterios', 'Critérios']].map(([k, rotulo]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={abaMaterial === k}
                  className={`prep-aba ${abaMaterial === k ? 'ativa' : ''}`}
                  onClick={() => setAbaMaterial(k)}
                >
                  {rotulo}
                </button>
              ))}
            </div>
            <div className="materiais-corpo">
              {abaMaterial === 'ficha' && <Markdown text={materiais.ficha} />}
              {abaMaterial === 'portfolio' && <Markdown text={materiais.portfolio} />}
              {abaMaterial === 'criterios' && (
                <ol className="criterios-lista md">
                  {materiais.criterios.map((cr) => (
                    <li key={cr.nome}><strong className="criterio-nome">{cr.nome}.</strong> {cr.definicao}</li>
                  ))}
                </ol>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setMateriais(null)}>Voltar à conversa</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
