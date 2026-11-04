# Investigação do Discord como referência de produto (01/11/2026)

## 1. REA — estado e decisão

**Instalado?** Não. Nada de `rea` no PATH, nada em `npm -g`, nenhum MCP
`rea` registrado no Claude Code.

**O que é** (README oficial, `github.com/morluto/rea`): servidor MCP + CLI
(`rea-agents` no npm, licença MIT) para agentes fazerem engenharia reversa de
binários nativos, apps JS/Electron, APKs, sites, capturas HAR/pcap. Requer
Node 22.23.4+/24.22.1+/26.12.1+. Captura em tempo de execução "roda ou
interage com o alvo usando as permissões do usuário" e chama ferramentas
externas (Ghidra, Hopper, IDA, JADX, tshark, mitmdump). O próprio projeto
restringe o uso a software "que você possui ou está autorizado a examinar".

**Por que não foi usado contra o Discord.** Os Termos de Serviço do Discord
(seção *Software in Discord's services*) dizem: "You also may not reverse
engineer or decompile our software or services", salvo consentimento por
escrito ou permissão legal. A seção de restrições também proíbe scraping
automatizado e software que modifique o serviço. Apontar o REA para o cliente
desktop, para o tráfego do gateway ou para a web app do Discord seria
exatamente isso, e o pedido exige métodos "compatíveis com as permissões
aplicáveis". Além do risco jurídico, a conta usada pode ser banida.

**Plano de instalação (para aprovação; não executado):**

1. Confirmar Node: o repo usa 20.11+; o REA exige 22.23.4+. Instalar Node 22
   LTS via `nvm-windows` *sem* trocar a versão padrão do projeto.
2. `npx rea-agents setup` (registra o MCP no Claude Code; faz backup da
   config e mostra a mudança antes de aplicar). Recusar a instalação do
   Hopper/IDA; não precisamos de desassemblador.
3. Uso legítimo e útil para o Aether: **apontar o REA para o próprio
   Aether** — o bundle do `apps/desktop` (instalador 0.1.30) e o build de
   produção da web — para auditar o que de fato é distribuído (segredos no
   bundle, IPCs expostos, CSP efetiva, tamanho de chunks). Isso é software
   seu e preenche lacunas que a leitura de código não cobre.

## 2. Método usado no lugar do REA

Fontes públicas e oficiais, lidas nesta data:

- Documentação de desenvolvedor (`docs.discord.com/developers`): recursos
  *Channel*, *Message*, tópico *Permissions*, eventos *Gateway*.
- Blog de engenharia: "How Discord Stores Trillions of Messages".
- Comportamento de produto amplamente documentado nas próprias páginas de
  ajuda (citado como **hipótese** quando não foi lido nesta sessão).

Legenda das afirmações: **[F]** fato lido em fonte oficial nesta sessão ·
**[H]** hipótese ou conhecimento geral de produto, não verificado aqui ·
**[R]** recomendação para o Aether.

---

## 3. Por área

### 3.1 Servidores, canais, permissões

**Discord.**
- [F] 13 tipos de canal: texto, DM, voz, DM em grupo, categoria (até 50
  canais), anúncios (seguível, crosspost), threads de anúncio/públicas/
  privadas, palco (até 10 000 ouvintes), diretório, fórum (só posts), mídia.
- [F] Slowmode `rate_limit_per_user` de 0 a 21 600 s, ignorado por quem tem
  `BYPASS_SLOWMODE`; aplica-se também a criar thread. `nsfw` por canal.
  `user_limit` até 99 em voz. `bitrate` por canal com teto por nível de boost.
- [F] Cálculo de permissão: dono = tudo; base = `@everyone` OR cargos;
  `ADMINISTRATOR` pula overwrites; depois overwrite de `@everyone`, overwrites
  de cargo combinados, overwrite de membro.
- [F] Permissões implícitas: sem `VIEW_CHANNEL` nada mais importa; sem
  `SEND_MESSAGES`, menção a todos, anexo e embed ficam irrelevantes.
- [F] Hierarquia: só se gerencia/expulsa/bane quem tem cargo mais alto abaixo
  do seu; só se concede permissão que você tem.
- [F] Timeout (`MODERATE_MEMBERS`): perde tudo menos ver e ler histórico.
- [F] 52 flags de permissão, incluindo `PIN_MESSAGES`, `MANAGE_THREADS`,
  `CREATE_PUBLIC_THREADS`, `MODERATE_MEMBERS`, `USE_VAD`, `PRIORITY_SPEAKER`,
  `MANAGE_GUILD_EXPRESSIONS`, `SEND_POLLS`, `BYPASS_SLOWMODE`.

**Aether hoje.** 22 bits (`packages/shared/src/permissions.ts`), mesmo
algoritmo (`packages/access/src/channels.ts:20-25`). Diferença de modelo: em
vez de overwrite de `@everyone`, há a flag `Channel.isPrivate`. Sem timeout,
slowmode, NSFW, anúncio, fórum, palco, threads. Não encontrei ação que
reordene cargos.

**[R]** O algoritmo já está certo; o que falta é *vocabulário*. Adicionar bits
novos é barato (bitfield `BigInt`, migração não precisa mexer em linhas
existentes). Prioridade: `MODERATE_MEMBERS` + `Member.timeoutAte`,
`PIN_MESSAGES`, `ATTACH_FILES`/`EMBED_LINKS`/`ADD_REACTIONS` (hoje embutidos
em `SEND_MESSAGES`), `BYPASS_SLOWMODE`, `USE_VAD` (para obrigar PTT).

### 3.2 Mensagens

**Discord.**
- [F] Conteúdo até 2 000 caracteres; requisição até 25 MiB incluindo
  arquivos.
- [F] Só o autor edita conteúdo; terceiros só mexem em flags com
  `MANAGE_MESSAGES`. Editar reconstrói `mentions`, `mention_roles`,
  `mention_everyone`. `edited_timestamp` nulo se nunca editada.
- [F] Apagar a própria não exige permissão; a de outro exige
  `MANAGE_MESSAGES`. Apagar em massa: 2–100 ids, nenhuma com mais de 14 dias.
- [F] Menções parseadas por padrão em mensagem comum; `allowed_mentions`
  restringe. Webhooks e interações só parseiam `users`.
- [F] Reply (`message_reference` DEFAULT) e encaminhamento (FORWARD, com
  snapshot imutável, um nível).
- [F] Fixadas: `GET /channels/{id}/messages/pins`, paginado (até 50),
  exige `PIN_MESSAGES` para fixar.
- [F] Histórico: `around`/`before`/`after` mutuamente exclusivos, limite
  1–100.
- [F] Busca por servidor indexada de forma assíncrona: responde 202 com
  `retry_after` se o índice ainda não existe; offset máximo 9 975.
- [F] Armazenamento: partição por `(channel_id, bucket de tempo)`, ids
  Snowflake ordenáveis; camada de dados em Rust com *request coalescing* e
  roteamento por hash consistente no `channel_id`. p99 de leitura ~15 ms no
  ScyllaDB.
- [H] Indicador de digitação é evento efêmero de ~10 s, não persistido.
- [H] Estado de leitura ("read state") por canal é persistido no servidor e
  sincronizado entre aparelhos; menções geram contador separado do de não
  lidas.

**Aether hoje.** Enviar/apagar/responder/reagir/anexar funcionam; histórico
paginado por cursor com `after` para recuperar queda (equivale ao `after` do
Discord). Faltam editar, menções, fixar, threads, busca, digitação,
estado de leitura persistido, encaminhar.

**[R]**
- *Editar:* `message:edit` no gateway, reusa `autorizarConversa` e o mesmo
  limitador de `message:send`; grava `editedAt`; evento `message:update`.
- *Menções:* parsear no servidor (nunca confiar no cliente) em `enviar-mensagem.ts`,
  gravar `MessageMention(messageId, userId|roleId|everyone)` para o contador
  de menções; `@everyone` só com `MENTION_EVERYONE`.
- *Estado de leitura:* tabela `ReadState(userId, conversaId, ultimaLidaId,
  mencoes)`; gravar com *debounce* (não a cada mensagem). Os ids `cuid` não
  são ordenáveis no tempo como Snowflake — comparar por `createdAt` da última
  lida, ou migrar ids novos de mensagem para um formato ordenável (ver
  arquitetura).
- *Busca:* Postgres full-text (`tsvector` + índice GIN, config `portuguese`)
  resolve a escala atual; só pensar em motor externo quando houver volume.

### 3.3 Voz, vídeo, transmissão

**Discord.**
- [F] `bitrate` configurável por canal; `video_quality_mode` AUTO ou FULL
  (720p) por canal.
- [F] Permissões separadas para falar, transmitir (`STREAM`), usar detecção
  de voz (`USE_VAD`; sem ela, só PTT) e `PRIORITY_SPEAKER`.
- [H] PTT com atalho global no desktop; atraso de soltura configurável.
- [H] Supressão de ruído por modelo proprietário; cancelamento de eco e AGC
  desligáveis.
- [H] Transmissão de tela com áudio do aplicativo; qualidade e fps
  limitados por plano.
- [H] Reconexão de voz transparente, mantendo a transmissão.

**Aether hoje.** LiveKit SFU, token emitido pelo gateway; mudo/surdo,
dispositivos, VAD, RNNoise, AEC/AGC desligáveis, volume por pessoa,
moderação de voz, tela com seletor próprio e áudio via loopback no desktop,
presets por plano. Falta PTT (UI diz "ainda não disponível"), bitrate por
canal, palco, retomada automática de tela/câmera após queda.

**[R]** PTT no desktop via `globalShortcut` do Electron → IPC →
`track.mute()/unmute()` (nunca `unpublish`, para não renegociar). Na web,
PTT só com a aba focada — documentar. Republicar tela/câmera após
`RoomEvent.Reconnected` guardando a intenção de transmitir junto do
`voiceIntent`.

### 3.4 Usuários e presença

**Discord.**
- [F] Presença é intent privilegiada para bots (`GUILD_PRESENCES`) — sinal de
  que presença é o evento mais caro do sistema.
- [H] Status: online, ausente (automático após inatividade), não perturbe,
  invisível; status personalizado com emoji e expiração.
- [H] Bloqueio esconde mensagens do bloqueado atrás de "mensagem bloqueada".

**Aether hoje.** Os quatro status existem; invisível vale por sessão; não há
ausente automático nem status personalizado; bloqueio não esconde mensagens
em canal.

**[R]** Ausente automático no cliente (sem input por N minutos +
`powerMonitor.getSystemIdleTime` no desktop) emitindo `presence:set IDLE`
marcado como automático, para não sobrescrever a preferência salva. Status
personalizado como coluna `statusTexto` + `statusExpiraEm` no `User`, entregue
pelo mesmo evento de presença.

### 3.5 Interface

[H] Navegação em três colunas, Ctrl+K, atalhos documentados, menus de
contexto em tudo, notificações nativas com regra por servidor/canal
(todas / só menções / nada), indicador de menção separado do de não lidas.

**Aether:** três colunas, Ctrl+K, cliques direitos parciais, contador de não
lidas só em memória, sem notificação nativa, sem regra por servidor.

### 3.6 Arquitetura e tempo real

**Discord.**
- [F] Gateway com heartbeat (intervalo do `Hello`, primeiro com *jitter*),
  ACK obrigatório; sem ACK, fechar e **resumir**.
- [F] Resume: guarda `session_id`, `resume_gateway_url` e o último número
  de sequência; o servidor **reenvia os eventos perdidos** e termina com
  `Resumed`. Invalid Session com `d:false` obriga identificar de novo.
- [F] Intents: o cliente declara que eventos quer; presença, membros e
  conteúdo são privilegiados.
- [F] Limite de envio: 120 eventos por conexão a cada 60 s; estourar
  desconecta.
- [F] Compressão de transporte `zlib-stream` ou `zstd-stream`.
- [F] Sharding de bots por `(guild_id >> 22) % num_shards`, até 2 500 guildas
  por shard.

**Aether hoje.** Socket.IO (heartbeat e reconexão próprios da lib), Redis
adapter para várias instâncias, rate limit por evento, ticket de conexão,
revalidação de sessão. **Não há resume com replay**: após queda o cliente
re-busca histórico com `after` por conversa aberta e refaz `voice:sync`;
eventos de outras conversas (reação, apagar, presença) perdidos na janela
não são reenviados.

**[R]** Não copiar o protocolo do Discord; o Aether já tem Socket.IO e Redis.
Socket.IO 4.6+ tem *connection state recovery* (sessão + offset, com
adapter compatível) — avaliar antes de construir um replay próprio. Alternativa
simples: número de versão por servidor (`serverSeq`) e `sync` incremental ao
reconectar.

---

## 4. Limites desta investigação

- Nenhum detalhe interno do cliente do Discord foi observado, por decisão
  explícita (ToS). Tudo que é [H] precisa de checagem antes de virar requisito.
- A documentação pública descreve a API de bots, não o cliente. O
  comportamento do cliente é inferido a partir dela e das páginas de ajuda.
