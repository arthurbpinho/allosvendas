import RichText from './RichText';

// Markdown de BLOCO, só o que os materiais do pacote usam: títulos (#, ##, ###),
// listas com "-" (um nível de recuo) e parágrafos. O inline (negrito, itálico)
// fica com o RichText. Tudo vira elemento React, nunca HTML injetado.
export default function Markdown({ text, semTituloPrincipal = false }) {
  const blocos = [];
  let lista = null;
  let paragrafo = [];

  const fecharParagrafo = () => {
    if (paragrafo.length) blocos.push({ tipo: 'p', texto: paragrafo.join(' ') });
    paragrafo = [];
  };
  const fecharLista = () => {
    if (lista) blocos.push(lista);
    lista = null;
  };

  for (const linha of String(text || '').split('\n')) {
    const h = linha.match(/^(#{1,3})\s+(.*)$/);
    const li = linha.match(/^(\s*)[-*]\s+(.*)$/);
    if (h) {
      fecharParagrafo(); fecharLista();
      blocos.push({ tipo: `h${h[1].length}`, texto: h[2] });
    } else if (li) {
      fecharParagrafo();
      if (!lista) lista = { tipo: 'ul', itens: [] };
      lista.itens.push({ texto: li[2], recuo: li[1].length > 0 });
    } else if (!linha.trim()) {
      fecharParagrafo(); fecharLista();
    } else {
      fecharLista();
      paragrafo.push(linha.trim());
    }
  }
  fecharParagrafo(); fecharLista();

  return (
    <div className="md">
      {blocos.map((b, i) => {
        if (b.tipo === 'h1') return semTituloPrincipal ? null : <h3 key={i}><RichText text={b.texto} /></h3>;
        if (b.tipo === 'h2') return <h4 key={i}><RichText text={b.texto} /></h4>;
        if (b.tipo === 'h3') return <h5 key={i}><RichText text={b.texto} /></h5>;
        if (b.tipo === 'ul') {
          return (
            <ul key={i}>
              {b.itens.map((it, j) => (
                <li key={j} className={it.recuo ? 'md-recuo' : ''}><RichText text={it.texto} /></li>
              ))}
            </ul>
          );
        }
        return <p key={i}><RichText text={b.texto} /></p>;
      })}
    </div>
  );
}
