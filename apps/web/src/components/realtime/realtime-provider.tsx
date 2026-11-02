"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@aether/shared";
import { createSocketTicketAction } from "@/server/actions/realtime";
import { sincronizarCatalogoDeJogos } from "@/lib/desktop/game-activity";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import { useVozDeAmigosStore } from "@/lib/stores/voz-de-amigos-store";
import { useConvitesStore } from "@/lib/stores/convites-store";
import { toast } from "@/lib/stores/toast-store";

/**
 * Dono da conexao com o gateway.
 *
 * Este componente nao guarda estado de aplicacao — ele traduz eventos do
 * socket para a store Zustand e devolve o socket para quem precisa emitir.
 *
 * Autenticacao: pedimos ao servidor um TICKET curto e de uso unico e o
 * enviamos no handshake. Em desenvolvimento o cookie de sessao tambem
 * funciona (app e gateway sao o mesmo site em localhost), mas em producao eles
 * ficam em dominios diferentes e o navegador nao envia cookie SameSite=Lax
 * para outro site. O ticket atravessa essa fronteira sem afrouxar o cookie da
 * aplicacao inteira.
 */

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const REALTIME_URL =
  process.env.NEXT_PUBLIC_REALTIME_URL ?? "http://localhost:4000";

/**
 * O socket vive ACIMA do ciclo de vida do React, num modulo.
 *
 * POR QUE: o `RealtimeProvider` mora em `/app/layout`, que deveria sobreviver
 * a navegacao entre `/app/s/[serverId]` e `/app/amigos` — mas na pratica o
 * App Router remonta o provedor nessa troca. Com o socket preso ao efeito, a
 * remonta fechava a conexao, o gateway tratava como desconexao e derrubava a
 * pessoa do canal de voz; o `RealtimeProvider` reconectava na hora e re-entrava
 * na call — o sintoma era "a chamada pisca e volta, com barulho" a cada clique
 * no icone da home.
 *
 * Agora o `.close()` e ADIADO: uma remonta rapida cancela o descarte e
 * reaproveita o mesmo socket (os handlers continuam presos), entao nada na
 * arvore de voz re-renderiza. Saida real do app (nenhuma remonta em 4s) fecha
 * de verdade. Recarga de pagina (`session:revoked`, `server:evicted`, F5) leva
 * o modulo junto.
 */
let socketVivo: TypedSocket | null = null;
let descarteAgendado: ReturnType<typeof setTimeout> | null = null;

const SocketContext = createContext<TypedSocket | null>(null);

export function useSocket(): TypedSocket | null {
  return useContext(SocketContext);
}

/**
 * Conexao em tempo real do app inteiro.
 *
 * Montado UMA VEZ, no layout de `/app` — nunca dentro de um servidor. Isso e
 * o que faz a chamada sobreviver a navegacao, e a licao veio de um bug real:
 * enquanto vivia no layout do servidor, abrir a tela de amigos desmontava o
 * provedor, o socket fechava, e o gateway tratava aquilo como desconexao e
 * tirava a pessoa do canal de voz para todo mundo. Trocar de tela encerrava a
 * call.
 *
 * O servidor aberto e descoberto pela ROTA, e nao recebido por propriedade:
 * quem passasse a propriedade teria de estar dentro do servidor, que e
 * exatamente o acoplamento que causou o problema. `null` significa "fora de
 * qualquer servidor" (a tela de amigos), e ai so o `server:join` nao acontece
 * — o socket e a sessao de midia seguem de pe.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const params = useParams<{ serverId?: string }>();
  const serverId = params?.serverId ?? null;
  const [socket, setSocket] = useState<TypedSocket | null>(null);
  /** distingue a primeira conexao de uma reconexao — a segunda recupera o intervalo */
  const hadConnected = useRef(false);
  const router = useRouter();
  /**
   * `router.refresh()` mora numa ref para o efeito da conexao nao depender
   * dele: o router e recriado a cada render, e listar como dependencia
   * derrubaria e reabriria o socket sem motivo.
   */
  const refreshRef = useRef(() => router.refresh());
  refreshRef.current = () => router.refresh();

  /**
   * Entrega ao desktop o catalogo de jogos aprovado pela comunidade.
   *
   * AQUI porque este provedor monta uma vez por sessao autenticada, que e
   * exatamente a frequencia certa: o catalogo muda quando a equipe aprova algo,
   * e nao a cada navegacao. No navegador a funcao nao faz nada — nao ha
   * processo principal a quem entregar.
   *
   * Sem `await` e sem tratamento: e um extra sobre a deteccao que ja funciona,
   * e falhar em busca-lo nao pode atrapalhar quem so quer conversar.
   */
  useEffect(() => {
    void sincronizarCatalogoDeJogos();
  }, []);

  // 1. conexao: criada uma vez e mantida entre navegacoes de canal
  useEffect(() => {
    /** Fecha o socket de verdade — so quando ninguem remontou a tempo. */
    function descartar() {
      socketVivo?.removeAllListeners();
      socketVivo?.close();
      socketVivo = null;
      descarteAgendado = null;
    }
    function adiarDescarte() {
      if (descarteAgendado) clearTimeout(descarteAgendado);
      descarteAgendado = setTimeout(descartar, 4000);
    }

    // Remonta rapida do provedor: o socket anterior ainda esta de pe (o
    // descarte foi so agendado), com os handlers presos. Reaproveita — a
    // referencia nao muda, entao effect 2 e a `<VoiceSession>` nao re-rodam e
    // a call nem pisca.
    if (descarteAgendado) {
      clearTimeout(descarteAgendado);
      descarteAgendado = null;
    }
    if (socketVivo) {
      setSocket(socketVivo);
      return adiarDescarte;
    }

    let instance: TypedSocket | null = null;
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Deixa um ticket novo em maos para a PROXIMA tentativa. O socket.io
     * reconecta sozinho e de forma sincrona — nao da para buscar credencial no
     * meio da tentativa, entao ela precisa estar pronta antes.
     */
    async function stageNextTicket(target: TypedSocket) {
      const ticket = await createSocketTicketAction();
      if (ticket) target.auth = { ticket };
    }

    /**
     * Reemite `voice:join` quando ha intencao de estar na call mas nao ha mais
     * credencial de midia — depois de um reconnect ou de um reload da aba. O
     * gateway revalida a permissao e devolve um token NOVO; o `selfVoice` vem
     * do proprio ack porque o broadcast de `voice:update` so alcanca quem esta
     * na sala do servidor, e a pessoa pode ter recarregado na tela de amigos.
     */
    /**
     * Foto das calls dos amigos — a cada `friend:sync`, porque durante a queda os
     * `friend:voice` nao chegaram. Substitui o mapa: quem saiu enquanto
     * estavamos fora nao vem na lista.
     */
    function pedirVozDosAmigos(target: TypedSocket) {
      target.emit("friend:voice-sync", (resultado) => {
        if (resultado.ok) useVozDeAmigosStore.getState().substituir(resultado.entries);
      });
    }

    /** Convites de jogo e o seu jogo atual — mesma hora e motivo da voz dos amigos. */
    function pedirConvites(target: TypedSocket) {
      target.emit("game-invite:list", ({ convites, meuJogo }) => {
        useConvitesStore.getState().substituir(convites, meuJogo);
      });
    }

    function rejoinVoice(target: TypedSocket, tentativa = 0) {
      const state = useRealtimeStore.getState();
      const intent = state.voiceIntent;
      if (!intent || state.media) return;

      target.emit(
        "voice:join",
        { channelId: intent.channelId },
        (resultado) => {
          const store = useRealtimeStore.getState();
          // O canal pode ter mudado enquanto o ack voltava (a pessoa clicou
          // "desconectar", ou foi movida). Ignora respostas de canal antigo.
          if (store.voiceIntent?.channelId !== intent.channelId) return;

          if (!resultado.ok) {
            if (resultado.retriable && tentativa < 4 && !cancelled) {
              // Recusa passageira (rate-limit numa tempestade de reconexao,
              // falha momentanea): tenta de novo com recuo, sem descartar a
              // intencao de estar na call.
              const recuo = 1000 * 2 ** tentativa; // 1s, 2s, 4s, 8s
              setTimeout(() => {
                if (target.connected) rejoinVoice(target, tentativa + 1);
              }, recuo);
              return;
            }
            // Definitiva (canal apagado, sem acesso) ou tentativas esgotadas.
            store.setVoiceIntent(null);
            store.setVoiceError(resultado.error);
            return;
          }
          store.setVoiceError(null);
          store.setMedia(resultado.media);
          const eu = resultado.participants.find(
            (p) => p.userId === store.selfUserId,
          );
          if (eu) store.setSelfVoice(eu);
        },
      );
    }

    void (async () => {
      const ticket = await createSocketTicketAction();
      if (cancelled) return;

      instance = io(REALTIME_URL, {
        path: "/ws",
        // Mantido para o caminho de desenvolvimento, onde o cookie basta.
        withCredentials: true,
        auth: ticket ? { ticket } : {},
        /**
         * Backoff exponencial explicito. O socket.io-client ja faz isso por
         * padrao, mas padrao implicito muda numa atualizacao de dependencia
         * sem ninguem notar. 1s -> 8s com jitter de 50% para nao sincronizar
         * todos os clientes num mesmo instante depois de uma queda.
         */
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 8000,
        randomizationFactor: 0.5,
      });

      const socketInstance = instance;
      socketVivo = socketInstance;

      socketInstance.on("connect", () => {
        const state = useRealtimeStore.getState();
        state.setConnectionStatus("online");
        state.setError(null);
        // O ticket usado agora ja foi consumido; prepara o proximo.
        void stageNextTicket(socketInstance);
        // Religa a call. O socket volta sozinho apos uma queda (e apos um
        // reload da aba a intencao vem do `sessionStorage`), mas a OCUPACAO de
        // voz nao: o gateway tirou a pessoa no disconnect e nada aqui a
        // recolocava. Mesmo padrao do `server:join` reemitido abaixo.
        rejoinVoice(socketInstance);
      });

      socketInstance.on("disconnect", () => {
        const state = useRealtimeStore.getState();
        state.setConnectionStatus("offline");
        state.clearVolatile();
      });

      socketInstance.on("connect_error", () => {
        useRealtimeStore.getState().setConnectionStatus("offline");
        // Recusa pode ser ticket expirado ou ja usado: renova antes da
        // proxima tentativa do backoff.
        void stageNextTicket(socketInstance);
      });

      socketInstance.on("ready", ({ user }) => {
        useRealtimeStore.getState().setSelfUserId(user.id);

        /**
         * Puxa as conversas diretas uma vez por conexao. E o que da rosto e
         * destino ao contador de nao-lidas de DM no trilho — sem isto o
         * `unread` teria a chave da conversa mas nada saberia dizer de quem.
         * As DMs em si chegam pela sala pessoal (`message:new`), como sempre.
         */
        socketInstance.emit("dm:list", (r) => {
          if (r?.ok) {
            useRealtimeStore.getState().hidratarConversasDm(r.conversas);
          }
        });
      });

      socketInstance.on("presence:sync", ({ serverId: incoming, entries }) => {
        const state = useRealtimeStore.getState();
        if (incoming !== state.serverId) return;
        state.syncPresence(entries);
      });

      socketInstance.on("presence:update", ({ serverId: incoming, entry }) => {
        const state = useRealtimeStore.getState();
        if (incoming !== state.serverId) return;
        state.updatePresence(entry);
      });

      /**
       * Presenca de amigo, pela sala pessoal. Sem `serverId` para conferir:
       * este evento nao pertence a servidor nenhum, e e exatamente por isso
       * que ele existe separado do `presence:update`.
       */
      socketInstance.on("friend:presence", ({ entry }) => {
        useRealtimeStore.getState().updatePresence(entry);
      });

      /**
       * `mergePresence`, nunca `syncPresence`: este evento chega tambem
       * enquanto voce esta dentro de um servidor, e substituir o mapa apagaria
       * a presenca de todo mundo dali.
       */
      socketInstance.on("friend:sync", ({ entries }) => {
        useRealtimeStore.getState().mergePresence(entries);
        /**
         * A foto das calls vem DEPOIS do `friend:sync`, e nao no `connect`: o
         * gateway carrega a lista de amigos sem segurar o handshake, e um
         * pedido no `connect` podia chegar antes dela — e voltar vazio. O
         * `friend:sync` so sai com a lista pronta, e sai de novo quando ela
         * muda (amigo novo).
         */
        pedirVozDosAmigos(socketInstance);
        pedirConvites(socketInstance);
      });

      /**
       * A lista de amizades mudou. Igual ao `server:changed`: o evento nao
       * carrega o que mudou, so pede a tela nova ao Next — quem sabe montar
       * "pendente"/"aceito" e o servidor, e duplicar isso aqui seria uma
       * segunda versao da mesma consulta.
       */
      socketInstance.on("friend:changed", () => {
        refreshRef.current();
      });

      /**
       * A call de um amigo, ja filtrada no gateway para o que VOCE pode ver
       * (membro do servidor + `VIEW_CHANNEL`). `null` = saiu ou deixou de ser
       * visivel.
       */
      socketInstance.on("friend:voice", ({ userId, voz }) => {
        useVozDeAmigosStore.getState().atualizar(userId, voz);
      });

      /**
       * Convite de jogo seu mudou. Recusa e expiracao de um pedido SEU viram
       * aviso aqui (uma vez, no evento); o aceite fica no overlay, porque
       * carrega o "como entrar" e precisa ficar na tela ate a pessoa fechar.
       */
      socketInstance.on("game-invite:update", ({ convite }) => {
        const anterior = useConvitesStore.getState().porId[convite.id];
        useConvitesStore.getState().atualizar(convite);
        const eu = useRealtimeStore.getState().selfUserId;
        if (convite.de.id !== eu || anterior?.estado === convite.estado) return;
        if (convite.estado === "recusado") {
          toast.info(`${convite.para.displayName} recusou o ${convite.tipo === "pedir" ? "pedido" : "convite"}.`);
        } else if (convite.estado === "expirado") {
          toast.info(`${convite.para.displayName} nao respondeu a tempo.`);
        }
      });

      socketInstance.on("presence:self", ({ game }) => {
        useConvitesStore.getState().setMeuJogo(game);
      });

      socketInstance.on(
        "voice:sync",
        ({ serverId: incoming, participants }) => {
          const state = useRealtimeStore.getState();
          if (incoming !== state.serverId) return;
          state.syncVoice(participants);
        },
      );

      socketInstance.on(
        "voice:update",
        ({ serverId: incoming, participant }) => {
          const state = useRealtimeStore.getState();
          if (incoming !== state.serverId) return;
          state.updateVoice(participant);
        },
      );

      /**
       * Fui movido de canal por um moderador. As credenciais novas vem junto
       * porque cada canal e uma sala propria no SFU — sem elas eu ficaria mudo
       * ate pedir acesso. O canal em si chega pelo voice:update.
       */
      socketInstance.on("voice:moved", ({ channelId, media }) => {
        const state = useRealtimeStore.getState();
        state.setMedia(media);
        // A intencao acompanha o canal novo: um reload depois de ser movido
        // deve religar onde a pessoa esta agora, nao de onde ela saiu.
        state.setVoiceIntent(channelId);
      });

      socketInstance.on("reaction:update", ({ messageId, reactions }) => {
        useRealtimeStore.getState().aplicarReacoes(messageId, reactions);
      });

      socketInstance.on("message:new", ({ message, nonce, serverId }) => {
        useRealtimeStore
          .getState()
          .receiveMessage(message, nonce, serverId ?? null);
      });

      socketInstance.on("message:deleted", ({ messageId }) => {
        useRealtimeStore.getState().removerMensagem(messageId);
      });

      /**
       * Fui removido do servidor. O gateway ja tirou este socket das salas, o
       * que corta o acesso; aqui so tiramos a pessoa de uma tela que nao existe
       * mais para ela.
       *
       * Carga completa da pagina, e nao navegacao do router, de proposito:
       * a barra de servidores mora no layout `/app`, COMPARTILHADO entre `/app`
       * e `/app/s/[serverId]`. Navegar entre as duas nao re-renderiza esse
       * layout, entao o icone do servidor continuava la — e clicar nele dava
       * 404. `router.refresh()` junto de `replace()` ainda disputava com a
       * navegacao.
       *
       * Despejo e evento raro; recarregar garante estado limpo e nao ha
       * beneficio em economizar aqui.
       */
      socketInstance.on("server:evicted", ({ serverId: incoming }) => {
        if (incoming !== useRealtimeStore.getState().serverId) return;
        // A intencao NAO e limpa aqui: a call pode estar num canal de OUTRO
        // servidor (o gateway so tira da voz quem foi expulso do servidor em
        // que estava falando). Se o canal virou proibido, o `rejoinVoice` no
        // proximo `connect` recebe a recusa e limpa sozinho.
        window.location.assign("/app");
      });

      /**
       * Minha sessao nao vale mais (logout, revogacao, expiracao). O gateway
       * revalida periodicamente, e sem este aviso o socket cairia num retry
       * infinito e silencioso: `reconnectionAttempts: Infinity` tentaria de
       * novo a cada poucos segundos com um ticket que nunca vai validar,
       * sem a pessoa nunca saber que precisa logar de novo.
       *
       * Carga completa para /login, mesmo raciocinio do server:evicted: o
       * unload da pagina e o que garante que o loop de reconexao para de
       * verdade, em vez de so trocar o estado de uma tela que segue viva.
       */
      socketInstance.on("session:revoked", () => {
        window.location.assign("/login");
      });

      /**
       * A estrutura do servidor mudou (canal, categoria, cargo, acesso).
       *
       * O evento nao diz O QUE mudou de proposito — pedimos ao Next para
       * re-renderizar, e o servidor devolve a arvore ja filtrada pelas
       * permissoes de quem esta olhando. Sem isso, um canal criado agora so
       * aparecia para os outros depois de um F5.
       *
       * Debounce porque reordenar canal e uma sequencia de cliques: sem ele,
       * cada seta viraria um re-render para todo mundo no servidor.
       */
      socketInstance.on("server:changed", ({ serverId: incoming }) => {
        if (incoming !== useRealtimeStore.getState().serverId) return;
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          refreshTimer = null;
          refreshRef.current();
        }, 300);
      });

      setSocket(socketInstance);
    })();

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      /**
       * NAO fecha na hora e NAO faz `setSocket(null)`: se for uma remonta
       * rapida do provedor, a proxima montagem cancela `descarteAgendado` e
       * reaproveita o socket com a mesma referencia — nada na arvore de voz
       * re-renderiza. So fecha se ninguem remontar em 4s (saida real do app).
       */
      adiarDescarte();
    };
  }, []);

  // 2. entrada no servidor, refeita a cada reconexao
  useEffect(() => {
    if (!socket) return;
    /**
     * Fora de servidor nao ha nada a entrar nem a limpar: `enterServer` zeraria
     * presenca, voz e mensagens, e o `friend:sync` que ja chegou junto com a
     * conexao seria perdido.
     */
    if (!serverId) return;
    // Amarrado numa const para o TypeScript manter o estreitamento dentro das
    // funcoes abaixo: `serverId` e `string | null`, e o guard acima nao
    // atravessa fronteira de closure.
    const alvo: string = serverId;
    useRealtimeStore.getState().enterServer(alvo);

    function join() {
      const reconnecting = hadConnected.current;
      hadConnected.current = true;

      socket?.emit("server:join", alvo, (result) => {
        const state = useRealtimeStore.getState();
        if (!result.ok) {
          state.setError(result.error);
          return;
        }
        state.setError(null);
        state.syncPresence(result.presence);
        if (reconnecting) recoverMissedMessages();
      });
    }

    /**
     * Recupera o intervalo perdido durante a queda.
     * Socket.IO reconecta sozinho, mas o que passou enquanto o socket estava
     * fora nao volta por magica: pedimos, por canal ja visitado, tudo que veio
     * depois da ultima mensagem que temos.
     */
    function recoverMissedMessages() {
      const state = useRealtimeStore.getState();
      for (const [channelId, messages] of Object.entries(state.messages)) {
        const last = [...messages].reverse().find((m) => !m.pending);
        if (last) recoverChannelGap(channelId, last.id, 0);
      }
    }

    /**
     * Uma pagina do intervalo perdido, e a proxima se ainda houver.
     *
     * Antes fazia UMA chamada e parava, ignorando `hasMore` — depois de uma
     * queda longa (notebook que dormiu), qualquer canal com mais de
     * `MESSAGE_PAGE_SIZE` mensagens novas ficava com um BURACO no meio do
     * historico que so o F5 fechava (auditoria M3). Agora pagina em cadeia,
     * com teto: acima de ~5 paginas o custo nao vale, e o F5 resolve o resto.
     */
    function recoverChannelGap(
      channelId: string,
      afterId: string,
      pagina: number,
    ) {
      socket?.emit(
        "message:history",
        { conversationId: channelId, after: afterId },
        (result) => {
          if (!result.ok || result.messages.length === 0) return;
          useRealtimeStore.getState().seedMessages(channelId, result.messages);
          const ultima = result.messages[result.messages.length - 1];
          if (result.hasMore && ultima && pagina < 5) {
            recoverChannelGap(channelId, ultima.id, pagina + 1);
          }
        },
      );
    }

    if (socket.connected) join();
    socket.on("connect", join);

    return () => {
      socket.off("connect", join);
      if (socket.connected) socket.emit("server:leave", alvo);
    };
  }, [socket, serverId]);

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  );
}
