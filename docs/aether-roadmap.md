# Roadmap do Aether (01/11/2026)

Derivado de [aether-audit.md](aether-audit.md) e
[feature-gap-analysis.md](feature-gap-analysis.md). Cada tarefa segue o
processo do `CLAUDE.md`: explicar antes, uma fase por vez, regressão com os
`verify-*.mjs` e limitações no README.

Complexidade: **P** (≤1 dia) · **M** (2–4 dias) · **G** (1–2 semanas).

Pré-requisito transversal: **ambiente de teste com banco próprio.** Hoje o
`.env` aponta para produção, o que impede rodar os `verify-*.mjs` com
segurança e força validação "só typecheck". Sem isso nenhuma tarefa abaixo
pode ser marcada FUNCIONAL. (Supabase branch ou Postgres local + LiveKit
`--dev` ≥ 1.10 + Redis local.)

---

## P0 — Crítico

### P0-1 Vínculo Google seguro
- **Problema:** `services/google-auth.ts:57-71` vincula a conta pelo e-mail
  mesmo sem e-mail verificado; o dono anterior da senha mantém acesso.
- **Resultado:** só vincula automaticamente se `emailVerificadoEm` não for
  nulo. Caso contrário, ou exige login com a senha para vincular, ou assume a
  conta do jeito seguro: invalida `passwordHash`, revoga todas as `Session` e
  registra no `AuditLog`.
- **Arquivos:** `services/google-auth.ts`, `actions/auth.ts`, `auth/session.ts`.
- **Dependências:** nenhuma. Primeiro procurar a correção feita em outra sessão.
- **Complexidade:** P.
- **Aceite:** conta não verificada + Google com o mesmo e-mail → nenhuma
  sessão antiga sobrevive; a senha antiga não loga.
- **Testes:** unitário do resolvedor (3 ramos); `verify-seguranca.mjs` ganha
  o cenário.

### P0-2 Segredo próprio da API interna
- **Problema:** `x-aether-internal` carrega o `AUTH_SECRET`
  (`realtime/src/internal.ts`, `web/src/server/realtime-notify.ts`);
  `internal-auth.ts` está solto e não commitado.
- **Resultado:** gateway usa `internal-auth.ts` (aceita os dois durante a
  transição); web envia `INTERNAL_API_SECRET`; depois
  `INTERNAL_API_ACEITA_LEGADO=nao`.
- **Arquivos:** `realtime/src/internal.ts`, `internal-auth.ts`, `env.ts`,
  `web/src/server/realtime-notify.ts`, `.env.example`, `scripts/fly-secrets.mjs`.
- **Dependências:** deploy coordenado Fly → Vercel → fechar o legado.
- **Complexidade:** P.
- **Aceite:** com o legado fechado, uma chamada com `AUTH_SECRET` recebe 401.
- **Testes:** unitário de `internal-auth` (já desenhado para isso); `verify-gateway-redis`.

### P0-3 Reconciliar documentação de auditoria com o código
- **Problema:** documento diz `[x]` onde o código não mudou.
- **Resultado:** `auditoria-2026-09-28.md` commitado com status real; README
  enxugado (o estado vive num índice curto; histórico por fase em `docs/`).
- **Complexidade:** P. **Aceite:** cada `[x]` aponta para um commit.

### P0-4 Assinatura do instalador desktop
- **Problema:** auto-update baixa e instala binário sem assinatura de um repo público.
- **Resultado:** certificado (OV/EV ou Azure Trusted Signing), `publisherName`
  no `electron-builder.yml`, 2FA na conta de release.
- **Dependências:** compra/aprovação do certificado (fora do código).
- **Complexidade:** M. **Aceite:** SmartScreen mostra o publicador; o updater
  recusa binário com outra assinatura.

---

## P1 — Essencial

### P1-1 Editar mensagem
- **Resultado:** autor edita; `editedAt`; evento `message:update` para a sala;
  "(editada)" na UI; mesmas regras em canal e DM.
- **Arquivos:** `realtime/src/handlers/messages.ts`, `enviar-mensagem.ts`
  (reuso da validação), `packages/shared/src/events.ts`, `message-item.tsx`,
  `message-composer.tsx`, `realtime-store.ts`.
- **Complexidade:** M. **Aceite:** outra aba vê a edição em < 1 s; não-autor
  recebe erro "não encontrada".
- **Testes:** unitário de autorização; caso novo em `verify-phase3`.

### P1-2 Menções
- **Resultado:** `@usuario`, `@cargo`, `@everyone/@here` parseados no
  gateway; tabela `MessageMention`; `@everyone` só com `MENTION_EVERYONE`;
  destaque da mensagem para quem foi mencionado; autocomplete no composer.
- **Dependências:** P1-3 (o contador de menção mora no estado de leitura).
- **Complexidade:** G. **Testes:** parser unitário (bordas: e-mail, código
  inline, menção a quem não vê o canal não notifica).

### P1-3 Estado de leitura persistido
- **Resultado:** `ReadState(userId, conversaId, ultimaLidaEm, mencoes)`;
  gravação com debounce; carregado na conexão; sincroniza entre abas e
  aparelhos via sala pessoal.
- **Arquivos:** schema + migração, `realtime/src/handlers/messages.ts`,
  `realtime-store.ts`, `server-rail.tsx`, `channel-sidebar.tsx`, `home-nav-panel.tsx`.
- **Complexidade:** G. **Aceite:** recarregar mantém os números; ler no
  celular apaga no desktop.

### P1-4 Notificações nativas
- **Resultado:** notificação do SO para DM e menção quando a janela não está
  em foco (Electron `Notification`; web Notification API com pedido de
  permissão explícito); preferência por servidor: todas / menções / nada.
- **Dependências:** P1-2, P1-3. **Complexidade:** M.

### P1-5 Push-to-talk e sensibilidade
- **Resultado:** atalho global no desktop (`globalShortcut`), atalho com foco
  na web; `track.mute()/unmute()`; atraso de soltura; limiar de VAD manual.
  Opcional: bit `USE_VAD` para canal exigir PTT.
- **Arquivos:** `apps/desktop/src/main.js`, `preload.js`, `lib/voice/room.ts`,
  `settings/voice-tab.tsx`.
- **Complexidade:** M. **Aceite:** remover o bloco "Ainda não disponível".

### P1-6 Retomar tela e câmera após queda
- **Resultado:** após `Reconnected`/`room.connect` de reparo, republicar o
  que estava publicado (intenção guardada com o `voiceIntent`); aviso visível
  se falhar.
- **Complexidade:** M. **Testes:** E2E Playwright existente com queda de rede
  simulada (`context.setOffline`).

### P1-7 Moderação essencial
- Timeout (`MODERATE_MEMBERS`, `ServerMember.castigoAte`, guard em toda
  escrita e em `voice:join`), slowmode (`Channel.slowmodeSeg`, rate limit no
  gateway, bypass por permissão), reordenar cargos (respeitando hierarquia).
- **Complexidade:** G (três peças independentes, entregar em estágios).

### P1-8 Busca de mensagens
- Postgres full-text (`tsvector` gerado + GIN, `portuguese`), filtro por
  canal/autor/data, resultados filtrados pela mesma permissão de leitura.
- **Complexidade:** M. **Aceite:** busca não retorna mensagem de canal
  privado invisível (teste explícito).

### P1-9 Fixar mensagens, indicador de digitação, DM em grupo
- Fixar: P. Digitação (evento efêmero, sem banco, throttle 3 s, expira 8 s): P.
- DM em grupo: G — exige mudar o modelo de `DmChannel` (par → conjunto de
  participantes). Desenhar antes; não quebrar o par ordenado.

### P1-10 Escala dos dados de servidor
- Membros paginados/lazy (ordem: online por cargo, depois offline);
  `loadDmList` em lote; ausente automático por inatividade.
- **Complexidade:** M.

### P1-11 Bloqueio completo e hardening do desktop
- Bloqueio derruba a chamada (`removeParticipant` no SFU) e esconde mensagens
  em canal; `openExternal` só `http/https/mailto`; atualizar Electron; avaliar
  `sandbox: true` com preload empacotado.

---

## P2 — Experiência

- Lista de mensagens virtualizada (manter âncora no rolar para cima).
- Preferências sincronizadas no servidor (aparência, voz, notificação).
- Embeds de link com fetch no servidor (anti-SSRF: bloquear IP privado,
  limite de tamanho e tempo).
- Emoji personalizado por servidor (R2 + `MANAGE_GUILD_EXPRESSIONS`).
- Threads e, depois, fórum e anúncios.
- Status personalizado; bitrate/qualidade por canal; áudio de tela na web.
- AutoMod básico (lista de palavras, links, spam por repetição).
- Estados de vazio/erro padronizados; varredura de acessibilidade.
- Gateway sem `tsx` em produção, container sem root, checagem de `Origin`.

## P3 — Diferenciação

Ideias que aproveitam o que o Aether já tem e o Discord não prioriza:

- **Canais persistentes estilo TeamSpeak de verdade:** canais de voz com
  sub-canais, "sala de espera" com moderador puxando para o canal, prioridade
  de fala. O README define o produto assim, e é onde o Discord é fraco.
- **Grupos por jogo (LFG) como núcleo:** detecção de jogo + salas efêmeras +
  cargo por jogo já existem; fechar o ciclo com convite automático para a
  sala quando o amigo abre o mesmo jogo.
- **Qualidade de chamada transparente:** o painel de conexão já mede RTT;
  expor diagnóstico acionável ("seu Wi-Fi perde 4% de pacotes") e rota IPv4
  preferida (o caso do ping de 117 ms já documentado).
- **Plataforma de bots aberta e simples:** já está completa; comandos e
  interações tornam isso vantagem real.
- **Privacidade por padrão:** invisível real, jogo oculto, controle de quem
  vê atividade por servidor.

## Sequência recomendada

1. Ambiente de teste isolado (pré-requisito).
2. P0-1, P0-2, P0-3 (uma semana curta, todas pequenas).
3. P0-4 em paralelo (depende de compra).
4. P1-1 editar → P1-3 estado de leitura → P1-2 menções → P1-4 notificações
   (cada uma destrava a seguinte).
5. P1-5 PTT e P1-6 retomada (voz é o núcleo do produto).
6. P1-7 moderação, P1-8 busca, P1-9, P1-10, P1-11.
7. P2 conforme uso real; P3 como aposta de produto.
