import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { dataHora } from './Conversas';

function lerArquivo(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
    r.readAsText(file, 'utf-8');
  });
}

function Enviado({ info }) {
  if (!info.enviadoEm) return null;
  return (
    <div className="prompt-enviado">
      {info.nomeArquivo ? <>{info.nomeArquivo} · </> : null}enviado em {dataHora(info.enviadoEm)}{info.por ? ` por ${info.por}` : ''}
    </div>
  );
}

export default function AdminPrompts() {
  const [st, setSt] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(null); // id do slot ou 'comprador'
  const slotInput = useRef(null);
  const slotAlvo = useRef(null);
  const compradorInput = useRef(null);

  const carregar = () => api.promptsStatus().then(setSt).catch((e) => setError(e.message));
  useEffect(() => { carregar(); }, []);
  // Os avisos ficam no topo: leva a tela até eles, que o botão pode estar lá embaixo.
  useEffect(() => {
    if (error || aviso) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [error, aviso]);

  function escolherSlot(slot) {
    slotAlvo.current = slot;
    slotInput.current.value = '';
    slotInput.current.click();
  }

  async function onArquivoSlot(e) {
    const file = e.target.files?.[0];
    const slot = slotAlvo.current;
    if (!file || !slot) return;
    setError(''); setAviso('');
    setEnviando(slot.id);
    try {
      await api.subirPrompt(slot.id, await lerArquivo(file), file.name);
      setAviso(`${slot.nome}: "${file.name}" enviado.`);
      carregar();
    } catch (err) {
      setError(`${slot.nome}: ${err.message}`);
    } finally {
      setEnviando(null);
    }
  }

  async function onArquivosComprador(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setError(''); setAviso('');
    setEnviando('comprador');
    const ok = [];
    const falhas = [];
    // Um por vez, para cada arquivo ter a sua resposta (e o seu erro).
    for (const file of files) {
      try {
        const r = await api.subirComprador(await lerArquivo(file), file.name);
        ok.push(`${r.nome}${r.substituiu ? ' (substituído)' : ''}`);
      } catch (err) {
        falhas.push(`${file.name}: ${err.message}`);
      }
    }
    if (ok.length) setAviso(`Comprador${ok.length > 1 ? 'es' : ''} enviado${ok.length > 1 ? 's' : ''}: ${ok.join(', ')}.`);
    if (falhas.length) setError(falhas.join(' · '));
    compradorInput.current.value = '';
    setEnviando(null);
    carregar();
  }

  async function excluir(c) {
    if (!window.confirm(`Tirar "${c.nome}" da lista de compradores? As conversas já feitas com ele continuam no histórico.`)) return;
    setError(''); setAviso('');
    try {
      await api.excluirComprador(c.id);
      carregar();
    } catch (err) {
      setError(err.message);
    }
  }

  const faltando = st ? st.slots.filter((s) => (!s.carregado && !s.opcional) || s.problema) : [];

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">Gestão</div>
        <h2><span className="accent">Prompts</span></h2>
        <p>
          Os prompts do treino ficam só no servidor. Cada envio é validado, vale na hora, e a
          versão anterior fica guardada como backup.
        </p>
        <div className="ornament" />
      </div>

      {error && <div className="alert error">{error}</div>}
      {aviso && <div className="alert">{aviso}</div>}

      {!st ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}><span className="spinner" /></div>
      ) : (
        <>
          {(faltando.length > 0 || st.compradores.length === 0) && (
            <div className="alert error">
              O treino ainda não está completo.
              {faltando.length > 0 && <> Falta: {faltando.map((s) => s.nome).join(', ')}.</>}
              {st.compradores.length === 0 && <> Nenhum comprador cadastrado.</>}
            </div>
          )}

          <div className="card">
            <div className="prompts-topo">
              <div>
                <h3 style={{ margin: 0 }}>Compradores</h3>
                <p className="prompts-ajuda">
                  Um arquivo .md por comprador. Enviar de novo um comprador que já existe substitui
                  o anterior. Dá para escolher vários arquivos de uma vez.
                </p>
              </div>
              <button className="btn btn-primary" onClick={() => compradorInput.current.click()} disabled={enviando === 'comprador'}>
                {enviando === 'comprador' ? 'Enviando…' : 'Subir comprador (.md)'}
              </button>
            </div>
            {st.compradores.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table className="admin-table">
                  <thead>
                    <tr><th>Comprador</th><th>Canal</th><th>Trocas</th><th>Arquivo</th><th /></tr>
                  </thead>
                  <tbody>
                    {st.compradores.map((c) => (
                      <tr key={c.id}>
                        <td><strong>{c.nome}</strong><div className="prompt-enviado">{c.papel}{c.organizacao ? ` · ${c.organizacao}` : ''}</div></td>
                        <td>{c.canal}</td>
                        <td>{c.trocas}</td>
                        <td><Enviado info={c} /></td>
                        <td className="actions">
                          <button className="btn btn-outline btn-sm" onClick={() => excluir(c)}>Excluir</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Prompts do treino</h3>
            <div className="prompts-slots">
              {st.slots.map((s) => (
                <div key={s.id} className="prompt-slot">
                  <div className="prompt-slot-info">
                    <div className="prompt-slot-nome">
                      {s.nome}
                      <span className={`prompt-status ${s.carregado && !s.problema ? 'ok' : s.opcional && !s.carregado ? 'opcional' : 'falta'}`}>
                        {!s.carregado ? (s.opcional ? 'opcional' : 'faltando') : s.problema ? 'com problema' : 'carregado'}
                      </span>
                    </div>
                    <div className="prompts-ajuda">{s.descricao}</div>
                    {s.problema && <div className="prompt-problema">{s.problema}</div>}
                    <Enviado info={s} />
                  </div>
                  <button className="btn btn-outline btn-sm" onClick={() => escolherSlot(s)} disabled={enviando === s.id}>
                    {enviando === s.id ? 'Enviando…' : s.carregado ? 'Substituir' : 'Subir .md'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <input ref={slotInput} type="file" accept=".md,text/markdown,text/plain" onChange={onArquivoSlot} style={{ display: 'none' }} />
      <input ref={compradorInput} type="file" accept=".md,text/markdown,text/plain" multiple onChange={onArquivosComprador} style={{ display: 'none' }} />
    </div>
  );
}
