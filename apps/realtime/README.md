# @aether/realtime — gateway WebSocket (FASE 3)

Servico Node separado do Next.js. Roda em `http://localhost:4000`, caminho de
socket `/ws`, com `GET /health` para monitoramento (devolve tambem contagem de
sockets, usuarios e pessoas em voz).

```bash
npm run dev:realtime      # tsx watch, le o .env da raiz
```

## Ja funciona

- **Handshake autenticado.** O gateway nao tem login proprio: le o mesmo cookie
  httpOnly `aether_session` que o app web grava e valida com a mesma funcao
  (`@aether/access`) — assinatura do JWT, linha `Session` no banco, revogacao e
  expiracao. Recusa acontece no middleware, antes de qualquer handler.
- **Presenca por servidor**, com contagem por socket: tres abas abertas e
  fechar uma nao deixa a pessoa offline para os outros.
- **Salas por permissao.** Ao entrar no servidor o socket entra tambem nas
  salas dos canais com `VIEW_CHANNEL`, calculadas por `@aether/access`.
- **Chat de texto.** `message:send` grava no Postgres e so entao faz broadcast;
  `message:history` pagina para tras (rolar) e para frente (recuperar o
  intervalo perdido numa queda). Cada mensagem revalida `SEND_MESSAGES` no
  banco — permissao em cache seria o mecanismo pelo qual alguem segue postando
  num canal do qual ja perdeu acesso.
- **Rate limit** token bucket por socket (rajada de 8, reposicao de 2/s).
- **Ocupacao de canal de voz.** `voice:join` / `voice:leave` / `voice:state`,
  respeitando `CONNECT` e o limite de usuarios do canal. Uma pessoa ocupa no
  maximo um canal por vez.
- **Indicador de fala.** `voice:speaking` carrega um booleano calculado no
  navegador a partir do proprio microfone. O gateway impoe que quem esta
  mutado nunca apareca falando, republica so na transicao e tem limitador
  proprio — cliente e coisa que se pode reescrever.
- **Heartbeat explicito** (`pingInterval` 10s, `pingTimeout` 8s) e
  **encerramento limpo** em SIGINT/SIGTERM, com trava de reentrada — sem ela o
  `tsx watch` deixava o processo velho segurando a porta.

## Nao faz (de proposito)

- **Nenhuma midia.** Nenhum byte de audio ou video passa por este servico.
  `voice:*` e sinalizacao: quem esta onde, mutado ou nao, falando ou nao. O
  microfone e aberto no NAVEGADOR apenas para medir volume localmente; o
  WebRTC entra na fase 4 e a tela na fase 5.
- Editar e excluir mensagem — o modelo suporta, os eventos ainda nao existem.
- Remover canal temporario ao esvaziar — o gateway sabe quando esvaziou, falta
  o evento que atualiza a arvore no cliente.
- Moderacao (mutar terceiros, mover entre canais) — fase 6.

## Decisoes

**Por que fora do Next:** o servidor do Next e serverless-friendly e reinicia a
cada build; um gateway WebSocket precisa de processo longo, memoria de estado e
escala horizontal propria.

**Por que cookie e nao token no `auth` do Socket.IO:** o cookie e httpOnly, ou
seja, o JavaScript da pagina nao consegue le-lo para mandar no payload do
handshake. Isso mantem o token fora do alcance de XSS. O preco e precisar de
`cors: { credentials: true }` e origem explicita.

**Por que gravar antes de emitir:** se o broadcast viesse primeiro e a escrita
falhasse, todo mundo teria visto uma mensagem que some no proximo reload. O
custo sao alguns milissegundos; o beneficio e historico e tela nunca
discordarem.

**Por que filtrar por sala e nao por evento:** a decisao de quem pode ver
acontece uma vez, quando o socket entra. Assim nao existe caminho em que um
`emit` "esquece" de checar permissao — a lista de quem esta na sala ja e a
resposta.

**Estado em memoria:** por enquanto uma instancia so. Escalar horizontalmente
vai exigir o adapter de Redis do Socket.IO — mesma conversa do rate limit em
memoria da fase 1.

Os contratos de evento vivem em `packages/shared/src/events.ts`, para que o app
web e o gateway nao possam divergir sem quebrar a compilacao.
