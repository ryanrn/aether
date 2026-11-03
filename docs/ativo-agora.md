# Tela Amigos — presença social, voz dos amigos e convites para jogos

Análise feita em 02/11/2026 sobre `master` 0211974 (desktop v0.1.31). Branch de
trabalho: `feat/ativo-agora`.

## 1. O que JÁ existe (reaproveitar, não recriar)

| Recurso | Onde | Estado |
|---|---|---|
| Status Online / Ausente / Não perturbe / Invisível / Offline | `handlers/presence.ts` (`presence:set`), `isUserStatus` | Pronto. Invisível = `OFFLINE` com socket vivo; esconde jogo e música. |
| Presença para amigos sem revelar servidor | `friend:presence` + `friend:sync` pela sala pessoal | Pronto. Decisão de privacidade: amigo vê a pessoa, não onde ela está. |
| Jogo em execução (desktop) | `apps/desktop/src/game-detect.js` → `presence:game`, capa IGDB (`enriquecer`) | Pronto (v0.1.31). |
| Música (Spotify) | `spotify/poller.ts` → `listening` | Pronto. |
| Multi-sessão / multi-dispositivo | `attachSocket`/`detachSocket`; offline só quando cai o último socket | Pronto. |
| Reconexão e reconciliação | `friend:sync` a cada conexão; `rejoinVoice` | Pronto. |
| Estado de voz (quem está em qual canal, tela, câmera, desde quando) | `state-*.ts` (`voiceOfServer`, `voiceLocation`), Redis ou memória | Pronto, mas só chega a quem abre AQUELE servidor (`voice:sync`). |
| Entrar em canal com checagem de permissão e lotação | `entrar-em-voz.ts` (`VIEW_CHANNEL`, `CONNECT`, `userLimit`) + `useEntrarNaVoz` | Pronto. Reaproveitado como está. |
| Painel "Ativo agora" | `components/friends/activity-panel.tsx` | Pronto para jogo e música; não mostra voz nem ações. |
| Rate limit por usuário | `rate-limit.ts` | Pronto. |

## 2. O que falta

1. **Voz dos amigos fora do servidor aberto.** Hoje a tela Amigos não sabe que
   um amigo está em call. É o item prioritário.
2. **Ações na tela Amigos:** entrar no canal, ir para o servidor, ver membros.
3. **Menu contextual** (botão direito) nas linhas de amigo.
4. **Convites para jogos** ("pedir para entrar" / "convidar para jogar") com
   pedido, aceite, recusa, cancelamento e expiração.
5. **Adaptadores por jogo** declarando o que cada um realmente suporta.

## 3. Integrações com jogos — o que existe de OFICIAL

Pesquisado em 02/11/2026.

- **VALORANT (Riot):** a API oficial (`developer.riotgames.com`) exige chave de
  produção aprovada e Riot Sign On, e cobre conta e partidas. **Não há API
  oficial de party, lobby ou entrada.** O que ferramentas da comunidade usam é
  a API local do cliente da Riot, não documentada e sem autorização — fora do
  escopo pelas regras deste projeto. → **Fluxo assistido** (o anfitrião passa o
  Riot ID ou o código da party ao aceitar).
- **Fortnite (Epic):** parties e presença do Epic Online Services são usadas
  pelo PRÓPRIO jogo; não há API para terceiros entrarem numa party do
  Fortnite. → **Fluxo assistido** (nome Epic).
- **Counter-Strike 2 (Valve):** é o único com caminho oficial plausível: conta
  Steam vinculada por OpenID + Steam Web API (`GetPlayerSummaries`, que pode
  trazer o lobby/servidor quando o perfil é público) + URL `steam://` do
  próprio cliente Steam. **Não verificado ainda**; exige vincular conta Steam
  (não existe hoje) e chave da Web API. Fica para uma etapa própria, com
  verificação antes.
- **VANT:** jogo próprio; pode implementar o adaptador nativo depois, falando
  direto com o gateway.

Fontes: [Riot — VALORANT docs](https://developer.riotgames.com/docs/valorant),
[Riot — Developer API Policy](https://support-developer.riotgames.com/hc/en-us/articles/22698769097107),
[Riot — apps de terceiros](https://support.riotgames.com/en-us/valorant/account/third-party-applications),
[Steam — GetPlayerSummaries](https://wiki.teamfortress.com/wiki/WebAPI/GetPlayerSummaries),
[EOS parties (Redpoint)](https://docs.redpoint.games/docs/ossv1/parties/inviting).

**Consequência:** nenhum jogo terá botão de "entrar automático" agora. Detectar
o jogo NÃO dá acesso ao lobby. O botão "Pedir para entrar" é do Aether: avisa
o amigo, e no aceite ele mostra como entrar (Riot ID, código, nome Epic).

## 4. Etapas, por dependência

Cada etapa é revisável e testável sozinha. Nenhum commit/deploy automático.

1. **[FEITO]** **Voz dos amigos** — gateway calcula, POR QUEM VÊ, se o canal pode ser
   mostrado (membro + `VIEW_CHANNEL`; invisível e DM nunca). Evento novo
   `friend:voice` + pedido de foto `friend:voice-sync`. Painel "Ativo agora"
   mostra canal, servidor, participantes (+N), tempo e tela; botões
   **Entrar no canal** (usa o `voice:join` existente — permissão e lotação
   continuam no backend) e **Ir para o servidor**; popover de membros.
2. **[FEITO]** **Menu contextual dos amigos** — botão direito/"⋯": mensagem, perfil,
   e, conforme o contexto, entrar no canal / ir para o servidor / ver membros
   / ver atividade. Ações indisponíveis não aparecem.
3. **[FEITO]** **Convites para jogos (núcleo)** — `game-invite:*` no gateway: id único,
   expiração (5 min), limite por pessoa e por par, só entre amigos, estado
   efêmero (memória/Redis, sem migração). Notificação em tempo real,
   aceitar/recusar/cancelar, estados de erro/expiração.
4. **[FEITO]** **Adaptadores e fluxo assistido** — `GameInviteProvider` por jogo com
   `capacidades` declaradas (todas "assistido" hoje); campo opcional que o
   anfitrião preenche ao aceitar (Riot ID, código da party).
5. **(Opcional, com verificação antes)** CS2 via Steam oficial.

## 5. Decisões da etapa 1

- **Autorização por quem vê, no gateway.** A sala pessoal (`room.user`) já é o
  canal de amigos; o que muda é que cada amigo recebe uma visão calculada para
  ele. Usa `loadMemberAccess` + `getChannelPermissions` do `@aether/access`
  (regra num lugar só).
- **Um gatilho central, com debounce por servidor (400 ms).** Os cinco pontos
  que emitem `voice:update` chamam `marcarVozAlterada(serverId, userIds)`. O
  trabalho só sai quando a ASSINATURA da call muda (canal, ocupantes, tela), então
  fala/mudo — que emitem `voice:update` o tempo todo — não geram tráfego para
  amigos.
- **Cache curto (30 s) de "F pode ver o canal C".** Sem ele, cada entrada em
  call custaria (amigos × consultas) no Postgres.
- **Invisível não aparece em call** para amigos, como já acontece com o jogo.
