# all_OS · Treino de Vendas Allos

Ambiente de demonstração que mostra a plataforma de ensino do all_OS aplicada a vendas.
O vendedor da Allos conversa com compradores simulados por IA e recebe um
relatório de desempenho. Projeto independente do all_OS clínico: usa a mesma base visual e
o mesmo jeito de guardar dados (arquivos JSON), sem nada de clínica, trilha ou gamificação.

## Prompts

Nenhum prompt está neste repositório. Eles são enviados pelo gestor em
**Administração → Prompts** e ficam só no volume do servidor.

## Rodar localmente

```bash
cp .env.example .env   # preencha JWT_SECRET, ADMIN_INITIAL_PASSWORD e OPENAI_API_KEY
npm install
npm run dev            # API na 3001 + Vite na 5173
npm test
```

Entre com `admin` e a senha de `ADMIN_INITIAL_PASSWORD`. Sem `OPENAI_API_KEY`, o app roda
em **modo demonstração**, com respostas fixas, para navegar sem custo.

## Deploy no Railway (instância própria)

1. Crie um projeto novo no Railway a partir deste repositório. O `railway.json` já define
   o build (`npm install && npm run build`) e o start (`npm start`).
2. Em *Settings → Volumes*, monte um volume em `/data`. Sem ele, contas e conversas somem a
   cada deploy.
3. Em *Variables*:

   | Variável | Valor |
   |---|---|
   | `DATA_DIR` | `/data` |
   | `NODE_ENV` | `production` |
   | `JWT_SECRET` | 48 bytes aleatórios em hex (mínimo 32 caracteres) |
   | `ADMIN_INITIAL_PASSWORD` | senha do gestor (mínimo 12 caracteres; vale só no primeiro boot) |
   | `OPENAI_API_KEY` | chave da OpenAI |
   | `OPENAI_MODEL` | `gpt-6-luna` |
   | `SIMULADOR_EFFORT` / `AVALIADOR_EFFORT` / `SINTETIZADOR_EFFORT` | `high` / `high` / `medium` |

4. Domínio: aponte `preview.exyo.com.br` para o serviço em *Settings → Networking*.
5. Entre como `admin` e suba os prompts e os compradores em *Administração → Prompts*.

**Uma instância só.** O controle de concorrência dos arquivos JSON é em memória, como no
all_OS. Não aumente as réplicas.

## Estrutura

```
server/index.js        rotas, auth, chamadas à IA, I/O dos JSON
server/vendas.js       regras do treino (funções puras)
client/src/pages/      Login, Compradores, Preparacao, Conversa, Conversas, ConversaDetalhe, AdminPrompts, AdminContas
tests/                 vitest
```

Dados em `DATA_DIR` (volume persistente).
