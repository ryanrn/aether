# Fluxer como referência de arquitetura (02/11/2026)

## Regras desta investigação

- **Fonte:** `github.com/fluxerapp/fluxer`, commit `63155bc1` (02/11/2026),
  clonado **fora** do Aether em `C:\Users\Ryu\Desktop\referencias\fluxer`. Nada
  do clone foi copiado para o repositório do Aether.
- **Licença confirmada no clone:**
  - código: **AGPL-3.0-or-later** (`LICENSE` na raiz, `fluxer_desktop/LICENSE`,
    `license = "AGPL-3.0-or-later"` nos `Cargo.toml`, `SPDX-License-Identifier`
    nos fontes);
  - arte (logo, ícones, avatares padrão): **CC BY-SA 4.0**
    (`fluxer_static/LICENSE`);
  - nome e marca: política própria (`.github/GOVERNANCE.md`).
- **Consequência para o Aether:** daqui saem **ideias de desenho e números de
  referência**, descritos com palavras nossas. Nenhum trecho de código, arte,
  nome ou texto do Fluxer entra no Aether. Este documento cita caminhos e
  identificadores para rastrear a evidência, não reproduz código.
- **Método:** leitura direta do código-fonte. O REA (instalado e funcionando)
  foi aberto, mas a skill dele indica explicitamente não usá-lo para repositório
  com fonte completa; ele fica para artefatos distribuídos (instaladores,
  bundles), como no `docs/rea-bundle-audit.md` do próprio Aether.

Legenda: **[F]** fato lido no código, com arquivo · **[I]** inferência ·
**[A]** o que isso significa para o Aether.

---

## 1. Arquitetura

| Parte | Tecnologia [F] | No Aether hoje |
| --- | --- | --- |
| API | TypeScript + Hono (`fluxer_api`, ~1,9 mil arquivos) | Next 15 server actions |
| Gateway de tempo real | **Erlang/OTP** (`fluxer_gateway`, ~400 arquivos) | Node + Socket.IO |
| Mensagens | **Cassandra** (`cassandra-driver`) | Postgres |
| Dados relacionais | Postgres (`pg`) | Postgres (Supabase) |
| Busca | **Elasticsearch** (`@elastic/elasticsearch`) | não existe |
| Barramento entre serviços | **NATS JetStream** | `POST /internal/*` HTTP |
| Cache e presença | Redis (`ioredis`) | Redis (Upstash) |
| Voz e vídeo | **LiveKit** (`livekit-server-sdk`, `livekit-client`) | LiveKit |
| Pagamentos | Stripe | não existe |
| Serviços auxiliares em Rust | proxy de mídia, *unfurl* de link, push, gerador de ids, admin | não existem |
| Cliente | React + **MobX**, editor **Lexical**, **lista virtualizada** (`@tanstack/react-virtual`) | React + Zustand, `<textarea>`, sem virtualização |
| Desktop | **Electron 44.10** + módulos nativos em Rust por plataforma | Electron 44.0, JS puro |

[A] As duas escolhas que mais separam os projetos são o **gateway em Erlang**
(feito para manter milhões de sessões vivas e retomáveis) e a **fila de
tarefas** (NATS), que tira trabalho pesado da requisição. O Aether não precisa
de nenhuma das duas na escala atual; precisa das **ideias** que elas permitem,
adaptadas ao Socket.IO e ao Postgres (seções 2 e 3).

## 2. Gateway: retomada de sessão

[F] `fluxer_gateway/src/session/session_monitor.erl`,
`session/session_dispatch.erl`, `gateway/gateway_handler_resume.erl`,
`utils/constants.erl`:

- Quando o socket cai, a **sessão continua viva por 60 s**
  (`resume_timeout() -> 60000`) esperando o cliente voltar.
- A presença só vira offline depois de **5 s** sem socket
  (`RESUME_OFFLINE_GRACE_MS`). Uma oscilação curta de rede não aparece para
  ninguém.
- Os eventos ficam num buffer limitado: **4096 eventos ou 16 MB**, no máximo 2 MB
  por evento (`MAX_EVENT_BUFFER_SIZE`, `MAX_TOTAL_BUFFER_BYTES`). O mais antigo
  sai quando enche.
- Na volta, o cliente manda o id da sessão e o último número de sequência; o
  servidor reenvia o que faltou (até 256 de uma vez,
  `MAX_INLINE_RESUME_REPLAY`) ou fecha com `invalid_seq` para o cliente começar
  do zero.

[A] **Comparação com o Aether** (`apps/realtime/src/handlers/presence.ts`,
`apps/realtime/src/index.ts`):

- O Aether anuncia `OFFLINE` **no mesmo instante** em que o socket cai, tira o
  cargo por jogo e para o Spotify. Uma queda de 2 s faz a pessoa sair e voltar
  para todos.
- Não há `connectionStateRecovery` no Socket.IO. Eventos durante a queda que não
  sejam mensagem (reação, apagar, editar, presença) se perdem, e o cliente só
  recupera mensagens pelo `message:history` com `after`.

**Desenho original proposto** (P1 novo, "G-1" no roadmap):

1. **Carência de presença:** ao perder o último socket, agendar o `OFFLINE` para
   daqui a alguns segundos e cancelar se um socket da mesma pessoa voltar antes.
   Com várias instâncias de gateway, a decisão precisa morar no Redis, junto com
   o resto do estado de presença (`state-redis.ts`).
2. **Recuperação de estado do Socket.IO:** ligar o `connectionStateRecovery` com
   uma janela curta (por exemplo 60 s). Ele reenvia ao cliente os pacotes
   perdidos e devolve as salas. Funciona com o adapter de Redis que o Aether já
   tem como opção; com o adapter em memória, vale só para a mesma instância.

## 3. Não lidas e menções

[F] `fluxer_api/src/api/database/types/ChannelTypes.ts` (`ReadStateRow`),
`api/read_state/ReadStateRepository.ts`, `api/worker/tasks/HandleMentions.ts` e
`HandleMentionChunk.ts`:

- Uma linha por pessoa e canal com o **cursor** (id da última mensagem lida, um
  Snowflake ordenável no tempo) e um **contador de menções** salvo.
- O contador é **incrementado na gravação**. Menção a muita gente (`@everyone`,
  cargo) vira uma tarefa num **worker**, que divide os membros em lotes, lê a
  preferência de notificação de cada um e faz os incrementos em massa.
- [I] "Não lida" é comparar o id da última mensagem do canal com o cursor, e não
  contar mensagens.

[A] **Comparação com o Aether (PRs #13 e #15):** o Aether guarda uma **data** no
lugar do cursor (os ids `cuid` não ordenam no tempo) e **calcula** as duas
contagens na conexão. É a escolha certa sem fila de tarefas. O caminho de
escala, quando a contagem pesar, é o do Fluxer: contador salvo, com o
`@everyone` distribuído num worker. Isso exige uma fila (BullMQ sobre o Redis
existente, ou o próprio Postgres), e fica registrado como P2.

## 4. Preferências de notificação

[F] `fluxer_api/src/api/database/types/UserTypes.ts` (`UserGuildSettingsRow`,
`ChannelOverride`, `MuteConfig`), `packages/constants/src/NotificationConstants.ts`:

- **Por pessoa e servidor:** nível (todas as mensagens / só menções / nada /
  herdar), silenciado com data de fim, ignorar `@everyone`, ignorar cargos,
  esconder canais silenciados, push no celular.
- **Por canal:** o mesmo, sobrepondo o do servidor.
- **No servidor:** um nível padrão (todas ou só menções).

[A] É o mesmo conceito descrito na documentação pública do Discord
(`default_message_notifications`, *mute*), então serve de referência sem
risco de cópia. O P1-4 do Aether (notificações) precisa desse modelo; hoje o
Aether não tem preferência de notificação nenhuma.

## 5. Indicador de digitação

[F] `fluxer_app/src/features/typing/rolling/TypingSendThrottle.ts`,
`RollingTypingStore.ts`: o aviso de "digitando" **expira em 10 s** e o cliente
reenvia no máximo a cada **1,5 s** enquanto a pessoa digita.

[A] Números de referência para o P1-9 do Aether, que é só evento efêmero, sem
banco.

## 6. Busca

[F] `fluxer_api/src/api/search/` (`ISearchProvider.ts`,
`BuildMessageSearchFilters.ts`), `api/guild/services/GuildSearchService.ts`
(linhas 124 e 387), `api/search/tests/MessageSearchPermissions.test.ts`:

- O provedor de busca fica atrás de uma interface, com o Elasticsearch por
  baixo.
- Antes de buscar, calcula os canais em que a pessoa tem **`VIEW_CHANNEL` e
  `READ_MESSAGE_HISTORY`**, e busca só neles.
- Tem testes dedicados para a permissão: sem histórico, o canal não entra; com
  `VIEW_CHANNEL` negado por *overwrite*, também não.

[A] Confirma o desenho do P1-8 do Aether (Postgres full-text, filtrado pela mesma
permissão). Vale copiar a **ideia** da interface de provedor, para trocar o
Postgres por um motor dedicado sem reescrever a regra de permissão, e a dos
testes de permissão como critério de aceitação.

## 7. Voz

[F] `fluxer_app/src/features/voice/engine/VoiceRoomEventBinder.ts`
(linhas 296–318, 369–390, 552–566), `VoiceE2EEKeyProvider.ts`:

- Na reconexão do LiveKit (`RoomEvent.Reconnecting`), se a transmissão de tela
  local cai, o cliente **guarda** essa publicação. Em `Reconnected`, se ela não
  voltou sozinha, o cliente **encerra a transmissão de forma consistente**:
  atualiza o estado local e a interface, em vez de fingir que continua.
- Depois de reconectar, reaplica preferências de áudio (mudo, surdo) e
  reconcilia as inscrições de mídia.
- A voz pode usar a **criptografia de ponta a ponta do LiveKit**
  (`ExternalE2EEKeyProvider`).
- O motor de voz é uma coleção de **máquinas de estado** pequenas (conexão,
  mídia, participante, permissão), em vez de um arquivo grande.

[A] Para o P1-6 do Aether (tela e câmera depois da queda): o primeiro passo não
é religar a tela sozinho, e sim **nunca deixar o estado mentir**. Quem
transmite precisa ver que a transmissão acabou, e quem assiste não pode ficar
olhando uma tela congelada. Religar automaticamente vem depois, com a intenção
guardada. A criptografia de ponta a ponta é um diferencial possível (P3).

## 8. Desktop

[F] `fluxer_desktop/src/main/` e `fluxer_desktop/native/`:

| Ponto | Fluxer | Aether (`docs/rea-bundle-audit.md`) |
| --- | --- | --- |
| Remetente do IPC | `requirePrivilegedRendererDocumentSender` (`PrivilegedRendererDocuments.ts`): exige a janela do próprio app **e** página de origem confiável | nenhum handler confere (P1-B) |
| `shell.openExternal` | lista de protocolos permitidos: `https:` e `mailto:` (`OpenExternal.ts`) | aceita qualquer esquema (P1-A) |
| `sandbox` da janela principal | `false` (`Window.ts:678`); janelas auxiliares com `true` | `false` |
| Atalho global e push-to-talk | gancho de teclado **nativo** por plataforma (`native/windows-input-hook` etc.) com `keydown` **e** `keyup`; solta tudo ao suspender ou bloquear a tela (`GlobalShortcutsIpc.ts:157-167`) | não existe |
| Áudio do sistema | captura por **processo** no Windows (`native/win-process-loopback`) | loopback do sistema inteiro |
| Outros nativos | captura de jogo, codificador por hardware, notificações do Linux | — |

[A] Três conclusões para o Aether:

1. **O `sandbox: false` da janela principal não é anomalia.** O Fluxer faz o
   mesmo. O que protege é o resto: checar o remetente do IPC e filtrar o
   `openExternal`. Isso rebaixa o P1-C da auditoria do Aether e mantém o P1-A e
   o P1-B como prioridade.
2. **O push-to-talk segurando a tecla não sai do `globalShortcut` do Electron**,
   que só avisa quando a tecla é apertada. É preciso um gancho de teclado nativo
   (módulo novo, decisão de dependência que precisa de aprovação) ou aceitar,
   na primeira versão, PTT só com a janela em foco.
3. **Soltar a tecla ao suspender ou bloquear** é obrigatório em qualquer versão:
   sem isso o microfone fica aberto.

## 9. O que não foi investigado

- `fluxer_messages`, `fluxer_push`, `fluxer_unfurl` e `fluxer_media_proxy` foram
  vistos só pela linguagem e pelo nome.
- Moderação, auditoria, convites e cargos do Fluxer não foram lidos: o Aether já
  tem esses fluxos funcionando (`docs/aether-audit.md`).
- Nenhum artefato do Fluxer foi baixado nem executado.
