# Arquitetura do Aether — estado atual e recomendações (01/11/2026)

## 1. Visão geral

```
 Navegador / Electron (apps/desktop, Electron 44, JS)
        │  HTTPS (server actions, rotas /api)        │  WebSocket (Socket.IO)      │ WebRTC
        ▼                                            ▼                             ▼
 apps/web — Next 15 / React 19 (Vercel)      apps/realtime — gateway (Fly)   LiveKit Cloud (SFU)
   components → actions → guards → services     handlers/* → @aether/access     token emitido
        │                     │                         │        │              pelo gateway
        │      POST /internal/* (x-aether-internal)  ───┘        │
        ▼                                                        ▼
 @aether/access  (sessão, permissão efetiva, DM, plano) ◄── usado pelos dois
 @aether/shared  (tipos, bitfield, Zod, eventos, planos)
 @aether/db      (Prisma 6) ─────────► PostgreSQL (Supabase, RLS + anon revogado)
                                       Redis (rate limit, presença, voz, adapter Socket.IO)
                                       R2 (anexos, avatares) · Giphy · IGDB · Spotify
```

## 2. Decisões que estão certas e devem ser preservadas

1. **Autorização em um pacote só** (`@aether/access`), consumido por web e
   gateway. É a decisão mais valiosa do projeto. O algoritmo de permissão
   bate com o da referência pública.
2. **Invariantes no banco**, não em código: unique de reação, par ordenado de
   DM, CHECK de "mensagem pertence a canal OU DM". Isso evita corridas que o
   código perderia.
3. **Uma tabela `Message`** para canal e DM — editar/menções/busca entram uma
   vez só.
4. **Estado de presença e voz atrás de uma interface** (`state-store.ts`) com
   backends memória e Redis.
5. **Gateway emite token de mídia**, depois de checar permissão; o SFU não
   decide nada.
6. **404 em vez de 403**, rate limit por evento, sessão revogável.

## 3. Riscos arquiteturais para crescer

| # | Risco | Por quê | Recomendação |
| --- | --- | --- | --- |
| A1 | **Sem ambiente de teste** | `.env` = produção; validação vira só typecheck | Supabase branch ou Postgres local + LiveKit ≥ 1.10 + Redis; CI já sobe parte disso |
| A2 | **Sem resume com replay no gateway** | queda perde eventos que não são mensagem | avaliar *connection state recovery* do Socket.IO com o adapter Redis; senão `serverSeq` + sync incremental |
| A3 | **Ids `cuid` não ordenáveis no tempo** | estado de leitura, paginação e "depois de X" dependem de `createdAt` + id | manter cursor composto `(createdAt, id)`; para ids novos considerar formato ordenável (UUIDv7) sem migrar os antigos |
| A4 | **Payload de servidor carrega tudo** | membros sem `take`; árvore completa no layout | carregamento por demanda: membros paginados, presença só de quem está visível |
| A5 | **Todas as salas na conexão** | `joinAllServerRooms` → cada evento de cada servidor chega a todos os sockets | só enviar "resumo de não lidas" para servidores fechados (um evento por servidor, agregado) |
| A6 | **Estado do cliente concentrado** | `realtime-store.ts` > 1 000 linhas | dividir por domínio (mensagens, presença, voz, DM) mantendo uma store |
| A7 | **Desktop em JS sem tipos** | IPC sem validar remetente, sem typecheck | `// @ts-check` + JSDoc é o passo barato; TS depois |
| A8 | **Segredo com quatro papéis** | `AUTH_SECRET` assina sessão, ticket, cifra TOTP/OAuth, autentica API interna | HKDF por finalidade + versão de chave |
| A9 | **Documentação monolítica** | README de 288 KB, já divergente do código | README curto de estado + `docs/<feature>.md` |
| A10 | **Postgres como único armazenamento de mensagens** | ok hoje; a referência migrou para partição por (canal, janela de tempo) em banco colunar quando a escala exigiu | não migrar agora; garantir índice `(channelId, createdAt)` (já existe) e medir p99 antes de qualquer mudança |

## 4. Fluxos principais (como são hoje)

**Enviar mensagem:** composer → `socket.emit("message:send")` →
`enviar-mensagem.ts` (rate limit, `autorizarConversa`, validação Zod, reply da
mesma conversa) → `prisma.message.create` → `message:new` para a sala do
canal/DM (com `serverId` para contadores).

**Entrar em voz:** `voice:join` → `entrar-em-voz.ts` (permissão `CONNECT`,
`userLimit`, plano) → estado de voz no store (Redis) → token LiveKit com
permissões de publicação → `voice:sync` para a sala do servidor.

**Ação administrativa (web):** componente → server action → guard (`requireMember`
+ permissão via `@aether/access`) → service → Prisma → `AuditLog` →
`POST /internal/*` no gateway para propagar em tempo real.

## 5. Onde cada recomendação do roadmap encaixa

- Editar, menções, digitação, fixar: `handlers/messages.ts` + `enviar-mensagem.ts`
  (gateway), evento em `packages/shared/src/events.ts`, render em `components/chat`.
- Estado de leitura: tabela nova em `@aether/db`, leitura no `attachSocket`,
  escrita debounced no gateway.
- Timeout/slowmode: regra em `@aether/access` (nunca em `apps/*`), aplicada
  pelo gateway e pelas actions.
- PTT: `apps/desktop` (atalho global) → IPC → `lib/voice/room.ts`.
