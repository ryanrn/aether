# AETHER Developer Platform

Como um programa de terceiro (um "bot") fala com o AETHER: cria uma
identidade, recebe eventos e publica mensagens.

> **v1 — fundação.** Bots mexem oficialmente só com **texto**: leem e enviam
> mensagem, recebem aviso de mensagem nova. Não têm slash commands. Existe uma
> extensão 🧪 **experimental** para entrar em canal de voz (LiveKit) — ver
> `POST /channels/:channelId/voice` — construída para um protótipo de Music
> Bot, ainda sem tocar áudio de verdade. Ver [Limitações](#limitações-conhecidas).

---

## Os dois caminhos

| | Precisa de um programa rodando? | Para quê |
|---|---|---|
| **Bot** | sim (fica ligado, escuta e responde) | bot de comandos, moderação, jogos |
| **Webhook de entrada** | não (um `POST` avulso) | avisos de um serviço externo num canal |

---

## 1. Criar o bot

1. Abra **`/app/developers`** no AETHER → **Criar aplicativo**.
2. Na aba **Bot**, clique em **Habilitar bot** (escolhe o nome de usuário dele).
3. **Gerar token.** Ele aparece **uma única vez** — copie e guarde. Perdeu?
   Gera de novo (o antigo para de valer na hora).

O token começa com `aeb_`. Trate como senha: nunca no front-end, nunca no git.

## 2. Instalar num servidor

1. Aba **Instalação** → copie o **Link de instalação**.
2. Quem **administra o servidor** (permissão `MANAGE_SERVER`) abre o link,
   escolhe o servidor e confirma.
3. O bot entra como **membro comum** (cargo padrão). Restrinja depois pelos
   cargos e permissões de canal, como faria com qualquer membro — um canal que
   o cargo do bot não alcança fica invisível para ele também na API.

---

## REST API

Base: **`https://aether-mocha-phi.vercel.app/api/v1`**

Autenticação em todas as rotas de bot:

```
Authorization: Bearer aeb_seu_token
```

### Formato de erro

Todo erro sai assim, com um `code` estável (case por ele, não pelo texto):

```json
{ "error": { "code": "not_found", "message": "Recurso não encontrado." } }
```

| `code` | HTTP | Quando |
|---|---|---|
| `unauthorized` | 401 | token ausente, inválido, revogado, ou aplicação bloqueada |
| `not_found` | 404 | recurso não existe **ou** o bot não tem acesso (não revelamos qual) |
| `bad_request` | 400 | corpo ou parâmetro inválido |
| `rate_limited` | 429 | passou do limite — ver header `Retry-After` (segundos) |
| `gateway_unavailable` | 503 | o serviço de mensagens não respondeu; tente de novo |

> **Nunca 403.** Bot não instalado, canal privado que o cargo não alcança,
> servidor de outro — tudo responde **404**.

### Endpoints

#### `GET /users/me`

A identidade do próprio bot.

```json
{
  "id": "u_...",
  "username": "musica",
  "displayName": "AETHER Music",
  "avatarUrl": null,
  "kind": "BOT",
  "applicationId": "app_..."
}
```

#### `GET /servers/:serverId`

Dados do servidor. Exige o bot **instalado** nele.

```json
{ "id": "s_...", "name": "Meu Servidor", "iconUrl": null }
```

#### `GET /servers/:serverId/channels`

Os canais que **o bot enxerga** (mesma regra da árvore de canais humana).

```json
[
  { "id": "c_...", "name": "geral", "type": "TEXT", "topic": null, "position": 0, "categoryId": null }
]
```

`type` é `"TEXT"` ou `"VOICE"`.

#### `GET /channels/:channelId/messages`

Histórico recente do canal.

```json
{ "messages": [ /* ... */ ], "hasMore": true }
```

#### `POST /channels/:channelId/messages`

Publica uma mensagem no lugar do bot. **201** com a mensagem criada.

```json
// corpo
{ "content": "olá!", "replyToId": "m_..." }
```

- `content`: 1 a 4000 caracteres.
- `replyToId`: opcional, id da mensagem respondida.
- O destino é o `:channelId` da URL. Mandar `serverId`/`authorId`/`channelId`
  no corpo **não muda nada** — são ignorados.
- Canal de voz, canal invisível para o bot, ou sem permissão de enviar → 404.

#### `POST /channels/:channelId/voice` — 🧪 EXPERIMENTAL

> Entra num canal de **voz** e devolve credenciais do LiveKit. Existe para o
> protótipo de Music Bot — ainda não é parte estável do contrato v1, pode
> mudar sem aviso de compatibilidade. A autorização é a **mesma** que o
> cliente humano usa (`VIEW_CHANNEL` + `CONNECT` do próprio bot no canal).

**201** com:

```json
{
  "url": "wss://seu-sfu.livekit.cloud",
  "token": "eyJhbGciOi...",
  "roomName": "channel:c_...",
  "canPublish": true,
  "canShareScreen": false,
  "canUseCamera": false,
  "expiresAt": 1735689600000
}
```

- `token` vale **1 hora**; peça de novo antes de vencer (não há renovação
  automática pro bot, diferente do cliente humano).
- `canPublish` reflete se o bot tem `SPEAK` no canal — sem ela, o LiveKit
  recusa a publicação de áudio mesmo que o bot tente.
- Canal de texto, canal invisível, ou app sem `CONNECT` → 404/400 (nunca 403).
- Voz desligada no servidor (kill switch) ou LiveKit não configurado no
  ambiente → 503.
- O bot aparece na lista de participantes de voz como qualquer membro — quem
  está na call vê o bot entrar de verdade.

`DELETE /channels/:channelId/voice` — sai do canal de voz que o bot ocupa
agora (`channelId` na URL é ignorado; sai de onde estiver). Idempotente:
chamar sem estar em voz não é erro.

> **Limitação conhecida:** se o processo do bot morrer sem chamar o `DELETE`
> (crash, sem `SIGTERM` tratado), ele fica marcado como "no canal" até
> reconectar com o mesmo `botUserId` (que substitui a ocupação) ou até alguém
> derrubar manualmente. Não há watchdog/TTL na v0 — ver
> [Riscos](#limitações-conhecidas).

### Limites (janela deslizante)

| Escopo | Limite |
|---|---|
| global por bot | 30 requisições / 10 s |
| por servidor | 15 requisições / 10 s |
| envio de mensagem, por canal | 5 mensagens / 5 s |

Estourou → `429` com `Retry-After`. Respeite o header.

---

## Gateway de eventos

Para **receber** eventos (ex.: "chegou mensagem"), o bot abre um WebSocket.

- Endereço: **`wss://aether-gateway-earnest-dew-229.fly.dev/gateway`**
- `path`: **`/ws`**
- Biblioteca: [`socket.io-client`](https://www.npmjs.com/package/socket.io-client) v4

```js
import { io } from "socket.io-client";

const socket = io("wss://aether-gateway-earnest-dew-229.fly.dev/gateway", {
  path: "/ws",
  transports: ["websocket"],
  auth: {
    token: "aeb_seu_token",
    intents: ["messages"], // opcional; default ["messages"]. [] = só o `ready`.
  },
});
```

Regras:

- **Máx. 2 conexões** simultâneas por aplicação (folga para uma reconexão). A 3ª
  derruba a mais antiga.
- **Sem RESUME.** Reconectar refaz o handshake e o join. O que aconteceu
  enquanto o bot esteve offline, reconcilie pela REST.
- Token inválido/revogado → o handshake é recusado (`connect_error`).

### Evento `ready`

Primeiro evento após conectar. Confirma quem é o bot e onde está.

```json
{
  "application": { "id": "app_...", "name": "AETHER Music" },
  "bot": { "id": "u_...", "username": "musica", "displayName": "AETHER Music" },
  "servers": [ { "id": "s_...", "name": "Meu Servidor" } ],
  "heartbeatMs": 20000
}
```

`servers` são os servidores onde o bot está instalado **e ainda é membro**.
`heartbeatMs` é informativo — o `socket.io-client` já faz o ping/pong sozinho.

### Evento `dispatch`

Um fato do AETHER. `t` é o nome, `d` o conteúdo.

```json
{ "t": "MESSAGE_CREATE", "d": { /* ver abaixo */ } }
```

#### `MESSAGE_CREATE`

Mensagem nova num **canal de servidor** que o bot enxerga. DM nunca entra.

```json
{
  "id": "m_...",
  "channelId": "c_...",
  "serverId": "s_...",
  "content": "!ping",
  "author": {
    "id": "u_...",
    "username": "joao",
    "displayName": "João",
    "avatarUrl": null,
    "bot": false
  },
  "createdAt": "2026-09-10T18:00:00.000Z",
  "replyToId": null
}
```

> ⚠️ **O bot recebe as próprias mensagens de volta.** Não há filtro automático —
> sempre confira `d.author.id` contra o id do próprio bot (o `ready` te dá),
> senão um bot que responde a mensagens entra em loop com ele mesmo.

---

## Webhook de entrada

Um cano de mão única: um `POST` publica uma mensagem num canal fixo. Não precisa
de bot nem de programa rodando.

1. **Configurações do servidor → aba Webhooks → Criar** (exige `MANAGE_SERVER`).
   Escolhe o canal de texto.
2. A URL aparece **uma vez**. Formato:
   `https://aether-mocha-phi.vercel.app/api/v1/webhooks/<id>/<token>`

```bash
curl -X POST "https://aether-mocha-phi.vercel.app/api/v1/webhooks/<id>/<token>" \
  -H "content-type: application/json" \
  -d '{ "content": "deploy publicado ✅" }'
```

- Sem header de autenticação — o token está na URL.
- Resposta: **201** `{ "id": "m_..." }`.
- Token errado ou webhook revogado → **404**.
- Limite: **5 mensagens / 10 s** por webhook.
- **Regenerar** troca o token (o antigo morre). **Revogar** desliga o cano; a
  identidade e as mensagens já enviadas ficam.

---

## Exemplos completos

- [`examples/bot-exemplo.mjs`](../examples/bot-exemplo.mjs) — o menor bot
  possível: responde `!ping` com `pong`. Serve pra entender o fluxo inteiro
  (conectar, `ready`, `MESSAGE_CREATE`, responder pela REST) em ~90 linhas.
- [`examples/bot-utilidades.mjs`](../examples/bot-utilidades.mjs) — um bot
  de verdade, com vários comandos (`!ajuda`, `!dado`, `!moeda`, `!bola8`, `!oi`),
  cooldown por canal (pra não estourar o rate limit) e tratamento de erro
  pensado pra ficar rodando por horas, não só demonstrar.

```bash
npm install socket.io-client
AETHER_BOT_TOKEN=aeb_seu_token node examples/bot-utilidades.mjs
```

Pra deixar rodando 24h: qualquer coisa que mantenha um processo Node vivo
serve — [`pm2`](https://pm2.keymetrics.io/), um serviço do Windows, uma VPS
pequena. O script não muda, só onde ele roda.

---

## Limitações conhecidas

- **Voz é experimental (🧪).** `POST /channels/:channelId/voice` deixa o bot
  entrar e aparecer como participante — mas ele ainda não tem como PUBLICAR
  áudio sem escrever a parte de participante WebRTC em Node
  (`livekit-client` é só de navegador; um bot precisa do SDK Node do LiveKit,
  `@livekit/rtc-node`, que este projeto nunca usou). Bot de música/podcast de
  verdade ainda não existe — a fundação pra construir um, sim.
- **Ocupação de voz do bot não expira sozinha.** Se o processo do bot cair sem
  chamar `DELETE /channels/:channelId/voice`, ele fica "na call" pro resto do
  AETHER até reconectar (mesmo `botUserId` substitui a ocupação) ou alguém
  remover manualmente. Sem watchdog/TTL na v0 — aceitável para o protótipo,
  não para produção.
- **Sem slash commands.** Comandos são texto que o bot interpreta (`!ping`).
- **Só `MESSAGE_CREATE`.** Sem `MESSAGE_UPDATE` / `MESSAGE_DELETE`, sem eventos
  de canal, membro ou reação.
- **Sem webhook de saída.** O AETHER não faz `POST` para fora quando algo
  acontece — o bot descobre pelo Gateway.
- **Nome/avatar por mensagem** não é customizável: a mensagem sai com o nome e o
  avatar do próprio bot.
- **Instalação ao vivo:** um bot já conectado que é instalado num servidor novo
  só passa a receber eventos de lá depois de reconectar.
- **Sem RESUME** no Gateway: toda reconexão recomeça do zero.
- **Avatar da aplicação/bot:** sem upload ainda (só as iniciais).
