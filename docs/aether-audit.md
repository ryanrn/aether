# Aether — auditoria técnica e funcional (01/11/2026)

Escopo: leitura do código no `master` local (`c3337cc` + 4 arquivos não
rastreados), README, schema Prisma, gateway, desktop, testes. **Nenhuma
alteração de código, nenhum acesso ao banco** (o `.env` aponta para produção;
nenhum `verify-*.mjs` foi rodado por isso).

Executado nesta auditoria:

| Verificação | Resultado |
| --- | --- |
| `vitest run` (sem `DATABASE_URL`) | **77 arquivos, 858 testes, todos passando** (4,7 s) |
| `npm run typecheck` | **limpo** em shared, access, db, realtime, web. Desktop: sem typecheck (JS puro) |
| Testes E2E / verify contra serviços | **não rodados** (exigem banco/gateway; o único banco é o de produção) |

Legenda: **FUNCIONAL** = implementado ponta a ponta *e* com evidência de
validação (teste, verify-script ou confirmação registrada no README).
**PARCIAL** = existe com limitação concreta. **VISUAL** = UI sem lógica real.
**AUSENTE** = não existe. **NÃO VERIFICADA** = código existe, sem evidência de
que funciona.

> Regra aplicada: "funcional" exige evidência. Muito do que o README dá como
> pronto foi validado só por typecheck + vitest, sem teste de interface. Nesses
> casos a classificação é PARCIAL ou NÃO VERIFICADA, mesmo que o código pareça
> completo.

---

## 1. Tamanho e forma do código

| Área | Arquivos | Linhas (aprox.) |
| --- | --- | --- |
| `apps/web/src` (Next 15, React 19) | 307 | 55,8 mil |
| `apps/realtime/src` (Socket.IO + LiveKit) | 34 | 7,6 mil |
| `apps/desktop/src` (Electron 44, JS) | 10 | 3,8 mil |
| `packages/access` | 24 | 3,0 mil |
| `packages/shared` | 19 | 4,6 mil |
| Schema Prisma | 1 | 45 models/enums, 38 migrações |
| Testes unitários | 77 | 858 casos |

Arquitetura detalhada em [aether-architecture.md](aether-architecture.md).

---

## 2. Achados críticos desta auditoria (novos)

### 2.1 Duas correções da auditoria de 28/09 **não estão no `master`**

`docs/auditoria-2026-09-28.md` (não rastreado) marca os itens 2 e 3 como
`[x] corrigido no código`. No código deste checkout, **nenhum dos dois está**:

- **Pré-sequestro de conta pelo Google (item 2).**
  `apps/web/src/server/services/google-auth.ts:57-71` ainda vincula a
  identidade Google a qualquer conta com o mesmo e-mail, **mesmo que essa conta
  nunca tenha verificado o e-mail**. Também marca o e-mail como verificado
  (`emailVerificadoEm ?? new Date()`), não troca a senha e não revoga as
  sessões existentes. Cenário: o atacante cadastra o e-mail da vítima com
  senha própria → a vítima entra com Google → a conta é a do atacante, que
  mantém senha e sessão. `git log` em todas as branches não mostra commit com
  essa correção.
- **API interna autenticada pelo `AUTH_SECRET` (item 3).**
  `apps/realtime/src/internal.ts:61-73` e
  `apps/web/src/server/realtime-notify.ts:34,42,87` continuam mandando e
  comparando o `AUTH_SECRET` cru no header `x-aether-internal`.
  `apps/realtime/src/internal-auth.ts` (com `INTERNAL_API_SECRET` e transição
  sem queda) **existe mas não é importado por ninguém e não está commitado**.
  Ou seja: o trabalho foi feito em outra sessão/sandbox e só um pedaço chegou
  aqui.

**Hipótese** (não confirmada): essas correções vivem em outro ambiente
(registro em memória do projeto diz que a sandbox de outra sessão tinha FS
isolado). Antes de reimplementar, procurar esse trabalho.

### 2.2 Outros pontos da auditoria de 28/09 conferidos agora

| Item | Estado no código hoje |
| --- | --- |
| 4 `shell.openExternal` sem validar protocolo | **aberto** — `apps/desktop/src/main.js:631,638,655` |
| 7 scrypt N=16384 | **aberto** — `apps/web/src/server/auth/password.ts:18` |
| 10 Electron 44.0.0, `sandbox: false` | **aberto** — `apps/desktop/package.json`, `main.js:598` |
| Higiene: arquivo vazio `git` na raiz, `.env.local` duplicado | **aberto** |

### 2.3 Documentação desatualizada

O README tem 5.171 linhas (288 KB) e já diverge do código em pontos
verificáveis: as limitações de DM dizem "não há lista de conversas na lateral"
e "sem resposta", mas `home-nav-panel.tsx:68,156` consome `dm:list` e a
resposta foi entregue no redesign do chat (etapa 5). Um README que mente sobre
o estado é risco operacional: decisões futuras partem dele (é o que o
`CLAUDE.md` manda ler primeiro).

---

## 3. Matriz de funcionalidades

### 3.1 Conta, autenticação, sessão

| Funcionalidade | Status | Evidência |
| --- | --- | --- |
| Cadastro / login com senha | FUNCIONAL | `actions/auth.ts`, `auth/password.ts`; testes unitários; `verify-phase*` históricos |
| Sessão JWT + linha `Session` revogável | FUNCIONAL | `auth/session.ts`, `@aether/access`; testes |
| Rate limit login (IP + conta, Redis) | FUNCIONAL | README "auditoria 26/08"; testes |
| Reset de senha | FUNCIONAL | `verify-password-reset.mjs`, `actions/password-reset.ts` |
| Verificação de e-mail + Turnstile | PARCIAL | depende da flag `exige_email_verificado`; Turnstile falha aberto |
| 2FA TOTP + códigos de backup | PARCIAL | código pronto; README: "aguardando deploy"; contas só-Google não conseguem desativar (`actions/totp.ts`, auditoria item 5) |
| Login com Google (OIDC + PKCE) | PARCIAL — **com falha de segurança** | ver 2.1 |
| Login do desktop por código (`/desktop-login`) | FUNCIONAL | fluxo documentado e em produção (releases 0.1.x) |

### 3.2 Servidores e comunidades

| Funcionalidade | Status | Evidência / lacuna |
| --- | --- | --- |
| Criar / editar / sair de servidor | FUNCIONAL | `actions/servers.ts`; `verify-phase2` |
| Ícone de servidor (upload) | FUNCIONAL | `uploadServerIconAction` |
| Transferir posse / excluir servidor | FUNCIONAL | `verify-server-ownership.mjs` |
| Reordenar servidores (por pessoa) | PARCIAL | drag-and-drop; README registra 3 bugs corrigidos, sem teste de UI |
| Categorias (CRUD) | FUNCIONAL | `create/rename/deleteCategoryAction` |
| Canal de texto e voz | FUNCIONAL | `ChannelType = TEXT \| VOICE` |
| Canal de anúncios, fórum, palco, mídia | **AUSENTE** | enum só tem `TEXT`/`VOICE` |
| Canal privado / overwrites por cargo e membro | FUNCIONAL | `@aether/access/channels.ts`; testes |
| Limite de usuários em voz | FUNCIONAL | `Channel.userLimit` |
| Slowmode, NSFW, tópico do canal | slowmode/NSFW **AUSENTES**; tópico FUNCIONAL | sem coluna |
| Salas efêmeras (LFG) e "Grupos" | PARCIAL | fase 2 estágios 3–4a; 4a commitado sem migração (memória do projeto) |
| Cargos (CRUD, cor, permissões, atribuir) | FUNCIONAL | `actions/roles.ts`; `roles-escalada.test.ts` |
| Hierarquia de cargos | PARCIAL | regra de escalada testada; **reordenar cargos não encontrado** (nenhuma action altera `position`) |
| Cargo automático por jogo | PARCIAL | depende do desktop |
| Convites (link, uso máximo, expiração, revogar, deep link) | PARCIAL | web no ar; `aether://` depende de release desktop |
| Explorar comunidades / vitrine com aprovação | FUNCIONAL | migrações + painel da equipe |
| Lista de membros | PARCIAL | **carrega todos os membros de uma vez** (`services/servers.ts:277`, sem `take`) |
| Apelido por servidor | FUNCIONAL | `MANAGE_NICKNAMES` |
| Templates de servidor, eventos agendados, onboarding | AUSENTE | |

### 3.3 Moderação e administração

| Funcionalidade | Status | Evidência / lacuna |
| --- | --- | --- |
| Expulsar / banir (temporário ou permanente) / desbanir | FUNCIONAL | `actions/moderation.ts`; `Ban.expiresAt`; `verify-phase6` |
| Moderação de voz (mutar, ensurdecer, mover, desconectar) | FUNCIONAL | `handlers/voice.ts:414,525,662` |
| Log de auditoria (servidor e global) | FUNCIONAL | `AuditLog`, `audit-tab.tsx` |
| Denúncia (mensagem/usuário) + revisão da equipe | PARCIAL | `Denuncia`, `actions/denuncia.ts`; sem SLA/automação |
| Castigo (timeout) | AUSENTE | sem coluna nem permissão |
| AutoMod / filtro de palavras / anti-spam por servidor | AUSENTE | só rate limit global |
| Apagar mensagens em massa | AUSENTE | |
| Feature flags / kill switch | FUNCIONAL | `Flag`, `definir-flag.mjs` |

### 3.4 Mensagens

| Funcionalidade | Status | Evidência / lacuna |
| --- | --- | --- |
| Enviar / receber em tempo real (canal e DM) | FUNCIONAL | `handlers/messages.ts:55`; `verify-phase3`, `verify-dm` |
| Histórico paginado + recuperação após queda (`after`) | FUNCIONAL | `messages.ts:114-180`, cursor por id |
| Apagar (soft delete) | FUNCIONAL | `message:delete`, `deletedAt` |
| **Editar** | **AUSENTE** | `editedAt` existe no schema e nunca é gravado; nenhum `message:edit` |
| Responder (reply) | FUNCIONAL | `replyToId`, validação de mesma conversa |
| Reações (Unicode) | FUNCIONAL | `Reaction` com unique; `handlers/reactions.ts` |
| Emoji personalizado / stickers | AUSENTE / VISUAL | aba Sticker "em breve" (`media-picker.tsx:11`) |
| GIF (Giphy) | PARCIAL | depende de `GIPHY_API_KEY`; sem ela a aba diz "em breve" |
| Anexos (R2, limite por plano, URL assinada) | FUNCIONAL | `services/anexos.ts:144`; `verificar-anexos.mjs` |
| Embeds de link (preview) | PARCIAL | só URL de GIF de host confiável vira mídia |
| **Menções** (@usuário, @cargo, @everyone) | **AUSENTE** | bit `MENTION_EVERYONE` existe; `permissions.ts:74`: "não há parsing de @everyone em lugar nenhum" |
| Fixar mensagens | AUSENTE | |
| Tópicos (threads) | AUSENTE | |
| Busca de mensagens | AUSENTE | nenhum `contains`/full-text em `Message` |
| Indicador de digitação | AUSENTE | |
| Não lidas | PARCIAL | contador **em memória**: recarregar zera (README "Contador de não lidas") |
| Notificação de sistema / som / push | AUSENTE | nenhum `new Notification` nem service worker |
| DM 1:1 (amizade ou servidor em comum, bloqueio) | FUNCIONAL | `DmChannel`, `verify-dm.mjs` |
| DM em grupo | AUSENTE | `DmChannel` é par ordenado |
| Lista de conversas na lateral | FUNCIONAL (código) / NÃO VERIFICADA (UI) | `home-nav-panel.tsx` |
| Lista de mensagens virtualizada | AUSENTE | nenhuma lib/técnica de virtualização |

### 3.5 Voz, vídeo, tela

| Funcionalidade | Status | Evidência / lacuna |
| --- | --- | --- |
| Entrar/sair de canal de voz (LiveKit SFU, token pelo gateway) | FUNCIONAL | `handlers/voice.ts:100,158`; confirmado em produção |
| Mudo / ensurdecer | FUNCIONAL | `voice:state` |
| Seleção de entrada e saída (`setSinkId`) | FUNCIONAL | `lib/voice/devices.ts` |
| Detecção de voz (borda "falando") | FUNCIONAL | `voice:speaking` |
| **Push-to-talk** e sensibilidade manual | **VISUAL** | `voice-tab.tsx:175`: "Ainda não disponível" |
| Supressão de ruído (RNNoise em AudioWorklet) + AEC/AGC desligáveis | PARCIAL | código completo; validação só manual |
| Volume por pessoa e amplificação | FUNCIONAL | README "Volume por pessoa" |
| Câmera | PARCIAL | permissão `CAMERA`; liberação por script (`liberar-camera.mjs`) |
| Compartilhar tela (web + seletor próprio no desktop) | FUNCIONAL | `screen-share.ts`, `picker/` |
| Áudio da tela | PARCIAL | desktop via loopback (`loopback-ipc.js`); navegador depende de suporte |
| Qualidade/preset da tela, codec | FUNCIONAL | presets por plano; troca sem parar a transmissão |
| Reconexão do gateway e do SFU | PARCIAL | microfone volta; **tela e câmera não voltam sozinhas** (README, "Estabilidade da call") |
| Chamada direta (DM) com câmera/tela | PARCIAL | E2E só local; bloquear no meio não derruba o áudio (token vale 1 h) |
| Painel de conexão (ping/RTT) | FUNCIONAL | `connection-panel.tsx` |
| Canal palco / transmissão para plateia | AUSENTE | |

### 3.6 Usuários, presença, social

| Funcionalidade | Status | Evidência / lacuna |
| --- | --- | --- |
| Perfil (avatar recortável, bio, banner, moldura) | FUNCIONAL | cosméticos estágios 0–4 em produção |
| Status online / ausente / ocupado | FUNCIONAL | `presence:set`, persistido |
| Invisível | PARCIAL | vale só para a sessão (`presence.ts:310-320`, proposital) |
| **Ausente automático por inatividade** | **AUSENTE** | `IDLE` só no seletor manual (`self-user-card.tsx:43`) |
| Status personalizado (texto/emoji) | AUSENTE | |
| Amigos (pedido, aceitar, remover, add por nome exato) | FUNCIONAL | `verify-friends.mjs` |
| Bloquear | PARCIAL | fecha DM/amizade; **não esconde a pessoa em canais/membros** |
| Atividade: jogo (desktop), Spotify, capa IGDB | PARCIAL | depende do desktop/credenciais; `verify-game-activity`, `verify-igdb` |
| Configurações de privacidade | PARCIAL | só chave global de DM |

### 3.7 Interface

| Funcionalidade | Status | Evidência / lacuna |
| --- | --- | --- |
| Navegação servidor → canal, gaveta no celular | FUNCIONAL | |
| Ctrl+K (trocador rápido) | FUNCIONAL | `quick-switcher.tsx` |
| Menus de clique direito | PARCIAL | 6 componentes; não cobre mensagem por completo |
| Drag-and-drop de canais/servidores | PARCIAL | ver 3.2 |
| Aparência / acessibilidade (densidade, escala, contraste, movimento) | PARCIAL | só `localStorage`, não sincroniza |
| Tema claro/escuro | NÃO VERIFICADA | paleta v2; não confirmado se existe tema claro |
| Loja de cosméticos | PARCIAL | itens pagos mostram "em breve" (`loja-screen.tsx:542,741`) |
| Olimpo (premium) | **VISUAL** para compra | "Assinatura em breve" (`premium-showcase-screen.tsx:93,409,499`); o plano em si funciona via chaves |
| Conexões (Spotify, Steam…) | PARCIAL | provedores "previstos" listados sem implementação (`conexoes-tab.tsx:163`) |
| Estados de carregamento/erro/vazio | PARCIAL | existem em várias telas; sem padrão comum auditado |

### 3.8 Plataforma

| Funcionalidade | Status | Evidência |
| --- | --- | --- |
| Bots, tokens, instalação, webhooks, API REST, gateway de bot | FUNCIONAL | `verify-phase-bots` 41/41 (memória do projeto), `docs/developer-platform.md` |
| Slash commands / interações | AUSENTE | |
| Planos e chaves de plano | FUNCIONAL | `Subscription`, `PlanKey`; sem provedor de pagamento |
| Backup | PARCIAL | JSON sem cifra, sem rotina (auditoria item 8) |
| Desktop: auto-update, iniciar com Windows, detecção de jogo, deep link | PARCIAL | **instalador sem assinatura** (auditoria item 1) |

---

## 4. Segurança e permissões

**Bem resolvido (verificado no código):** permissão calculada em um lugar só
(`@aether/access`), com o mesmo algoritmo da referência pública do Discord
(base dos cargos → ADMINISTRATOR/dono curto-circuitam → overwrites de cargo →
overwrite de membro; `channels.ts:20-25`); `404` em vez de `403`; sem SQL cru;
0 `any`; anon revogado no Postgres; CSP com `connect-src` restrito.

**Abertos, por gravidade:**

1. Vínculo Google por e-mail não verificado (2.1) — **P0**.
2. `AUTH_SECRET` como credencial da API interna (2.1) — **P0**.
3. Instalador desktop sem assinatura + auto-update automático — P0 de
   processo (exige certificado).
4. `shell.openExternal` sem lista de protocolos; `sandbox: false`; Electron
   desatualizado — P1.
5. Bloqueio não derruba chamada já em curso (token de 1 h) — P1.
6. scrypt abaixo da recomendação OWASP; backup sem cifra; 10 tabelas sem RLS
   (defesa em profundidade) — P1/P2.
7. Gateway: container root, sem checagem de `Origin`, `/health` com contagens — P2.

**Não auditado ação por ação:** as ~150 server actions. A amostra lida segue o
padrão guard → service; uma varredura sistemática fica como tarefa do roadmap.

---

## 5. Desempenho e escala (riscos observados)

| Risco | Onde | Efeito |
| --- | --- | --- |
| Membros sem paginação | `services/servers.ts:277` | servidor com milhares de membros carrega tudo em cada abertura |
| Lista de mensagens sem virtualização | `components/chat/message-list.tsx` | DOM cresce sem limite numa sessão longa |
| Não lidas só em memória | `realtime-store.ts:240` | inconsistência entre aparelhos; recarregar zera |
| `loadDmList` faz N consultas | `@aether/access` (README DM) | ok em dezenas, ruim em milhares |
| Socket entra em todas as salas de servidor na conexão | `joinAllServerRooms` | custo cresce com nº de servidores × eventos |
| Gateway roda via `tsx` em produção | Dockerfile do realtime | boot mais lento, mais memória |

---

## 6. O que não foi verificado

- Nenhum teste contra serviços rodando (banco de produção; ver memória
  `.env aponta para produção`).
- Interface não foi aberta no navegador nesta auditoria.
- Configuração real de Vercel/Fly/LiveKit Cloud.
- Consumo de CPU/RAM/GPU do desktop e da web.
