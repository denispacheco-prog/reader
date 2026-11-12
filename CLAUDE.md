# Reader

Leitor de RSS pessoal em colunas, no estilo TweetDeck, publicado no GitHub Pages
(https://denispacheco-prog.github.io/reader/). Sem framework nem etapa de build no
front-end.

- `feeds.opml` — lista de feeds; cada pasta do OPML vira uma coluna.
- `scripts/build.js` — busca os feeds, normaliza e gera `reader.json` e
  `first-seen.json`. Os dois são saída de build: estão no `.gitignore` e nunca
  devem ser commitados.
- `app.js`, `style.css`, `index.html` — o site.
- `.github/workflows/build-deploy.yml` — build e publicação a cada ~10 min
  (cron-job.org dispara `workflow_dispatch`; o `schedule` do GitHub é só reserva).

## Regras

- **Publicação só com ações oficiais.** A etapa de deploy tem permissão para
  publicar o site: use apenas `actions/*` do GitHub, nada de ações de terceiros
  nem invólucros de "retry". Em 12/11/2026 um invólucro de terceiros
  (`Wandalen/wretry.action@v3`) congelou o site por 6 horas enquanto os builds
  apareciam como concluídos. Veja o comentário no workflow.
- **O projeto é editado em duas máquinas.** Rode `git pull` antes de mexer.
- **Pergunte antes de commitar ou dar push.** O dono confirma cada um.
- **Feed novo:** teste com `npm run build` e depois confira o site publicado.
  Alguns sites (Cloudflare, Sucuri) só bloqueiam o build do GitHub; nesses
  casos, use uma busca do Google Notícias `site:` como feed.
- **Rodízio do Início:** a volta da ordem dos blocos (`HOME_ORDER_CYCLE_MS`)
  não pode ter a mesma duração do ciclo de posts de cada bloco
  (`HOME_ROTATION_SIZE` × `HOME_ROTATION_MS`), nem ser múltiplo dele; senão
  parte dos posts nunca aparece na tela.
- **Se o site parar de atualizar:** compare o `generatedAt` do `reader.json`
  publicado com o horário do último build bem-sucedido antes de supor que o
  problema está nos feeds.
