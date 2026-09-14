"use client";

import { useEffect, useState, useTransition } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { SwitchVisual } from "@/components/ui/switch";
import type {
  PublicChannel,
  PublicUser,
  UserStatus,
  ViewerContext,
} from "@aether/shared";
import { logoutAction } from "@/server/actions/auth";
import { Avatar } from "@/components/ui/avatar";
import { AppSettingsModal } from "@/components/settings/app-settings-modal";
import {
  SelfUserCard,
  type SelfCardAnchor,
} from "@/components/profile/self-user-card";
import { viewerCan } from "@/lib/permissions";
import { meuPlano } from "@/server/actions/planos";
import { PLANS, perfilCabeNoPlano } from "@aether/shared";
import { useSocket } from "@/components/realtime/realtime-provider";
import {
  useConnectionStatus,
  useMicTest,
  useRealtimeStore,
  useSelfVoice,
} from "@/lib/stores/realtime-store";
import {
  lerTratamentoDeAudio,
  salvarTratamentoDeAudio,
  type TratamentoDeAudio,
} from "@/lib/voice/audio-prefs";
import {
  canCaptureScreen,
  isDesktopApp,
  PRESET_LIST,
  readShareAudioPreference,
  saveShareAudioPreference,
  type SharePresetId,
} from "@/lib/voice/screen-share";
import {
  listMicrophones,
  listCameras,
  readPreferredCamera,
  readPreferredMicrophone,
  savePreferredCamera,
  savePreferredMicrophone,
  type AudioDevice,
} from "@/lib/voice/devices";
import { toast } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";

/**
 * Barra de controles inferior.
 *
 * FASE 1: mic/audio/tela guardam apenas a PREFERENCIA local do usuario e ainda
 * nao abrem dispositivo nenhum — nada de audio simulado. A fase 4 conecta esses
 * mesmos botoes ao pipeline WebRTC (getUserMedia / faixa do SFU) e a fase 5
 * conecta o botao de tela ao getDisplayMedia.
 */
export function ControlBar({
  user,
  viewer,
  serverId: currentServerId,
  memberId,
  nickname,
  voiceChannels,
}: {
  /**
   * O usuario publico mais as preferencias de contato.
   *
   * Escrito como extensao de `PublicUser`, e nao campo a campo: a copia
   * anterior repetia a mesma lista e obrigava a mexer aqui a cada campo novo
   * do perfil — foi assim que o plano quase ficou de fora desta tela.
   */
  user: PublicUser & {
    allowServerDms: boolean;
    allowServerFriendRequests: boolean;
  };
  viewer: ViewerContext;
  /** servidor aberto agora — o apelido vale so nele */
  serverId: string;
  memberId: string;
  nickname: string | null;
  /** canais de voz — o cartao resolve o NOME do canal em que voce esta */
  voiceChannels: PublicChannel[];
}) {
  const [pending, startTransition] = useTransition();
  const socket = useSocket();
  const status = useConnectionStatus();
  const connected = status === "online";
  const presence = useRealtimeStore((state) => state.presence);
  const selfVoice = useSelfVoice();

  /**
   * Fora de uma call, mic/audio sao preferencia local. Dentro de uma call,
   * quem manda e o gateway — ele e a fonte de verdade que os outros veem, e
   * discordar dele deixaria seu icone diferente do que aparece para todos.
   */
  const [localMuted, setLocalMuted] = useState(false);
  const [localDeafened, setLocalDeafened] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [noiseOpen, setNoiseOpen] = useState(false);
  /**
   * Tratamento do microfone. A preferencia mora no `localStorage`
   * (`audio-prefs`) e o `room.ts` a respeita ao entrar; o popover do dock
   * aplica AO VIVO: RNNoise via `setProcessor`, as tres nativas via
   * `restartTrack`. Nascendo `null` ate ler — sem piscar um estado que pode
   * nao ser o da pessoa.
   */
  const [tratamento, setTratamento] = useState<TratamentoDeAudio | null>(null);
  const [reaplicandoNativo, setReaplicandoNativo] = useState(false);
  useEffect(() => setTratamento(lerTratamentoDeAudio()), []);
  const rnnoise = tratamento?.rnnoise ?? false;
  const micTest = useMicTest();
  const setMicTest = useRealtimeStore((state) => state.setMicTest);
  const [profileOpen, setProfileOpen] = useState(false);
  /**
   * Volta do OAuth do Spotify: no desktop o fluxo navega a janela e cai em
   * `/app?spotify=...`. Abre as configuracoes ja na aba Atividade e limpa o
   * parametro da URL.
   */
  const [voltouDoSpotify, setVoltouDoSpotify] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (!q.has("spotify")) return;
    setVoltouDoSpotify(true);
    setProfileOpen(true);
    q.delete("spotify");
    const nova = q.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (nova ? `?${nova}` : ""),
    );
  }, []);
  const [selfCard, setSelfCard] = useState<SelfCardAnchor | null>(null);
  const [shareAudio, setShareAudio] = useState(true);
  /** No desktop o seletor do Electron tem a chave de som; duas confundiriam. */
  const [noDesktop, setNoDesktop] = useState(false);
  const [micMenuOpen, setMicMenuOpen] = useState(false);
  const [camMenuOpen, setCamMenuOpen] = useState(false);
  const [cameras, setCameras] = useState<AudioDevice[]>([]);
  const [camId, setCamId] = useState<string | null>(null);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [micId, setMicId] = useState<string | null>(null);

  /**
   * O teto de altura do plano, para TRANCAR os perfis acima dele.
   *
   * Comeca no gratuito e sobe quando a resposta chega. Comecar pelo maior
   * mostraria 1440p liberado por um instante para quem nao tem — oferecer e
   * tirar e pior do que demorar a oferecer.
   */
  const [limitesDeTela, setLimitesDeTela] = useState({
    alturaMax: PLANS.FREE.alturaMax,
    quadrosMax: PLANS.FREE.quadrosMax,
  });
  useEffect(() => {
    void (async () => {
      const r = await meuPlano();
      if (r.ok) {
        setLimitesDeTela({
          alturaMax: r.data.limites.alturaMax,
          quadrosMax: r.data.limites.quadrosMax,
        });
      }
    })();
  }, []);

  // localStorage nao existe no servidor: so lemos depois de montar.
  useEffect(() => setMicId(readPreferredMicrophone()), []);
  useEffect(() => setCamId(readPreferredCamera()), []);
  useEffect(() => setShareAudio(readShareAudioPreference()), []);
  // Depois de montar: `window.aetherDesktop` nao existe no servidor.
  useEffect(() => setNoDesktop(isDesktopApp()), []);

  async function openMicMenu() {
    const next = !micMenuOpen;
    setMicMenuOpen(next);
    // Enumerar a cada abertura, e nao uma vez: aparelho USB pode ter sido
    // conectado depois que a pagina abriu.
    if (next) setDevices(await listMicrophones());
  }

  async function abrirMenuDeCamera() {
    const proximo = !camMenuOpen;
    setCamMenuOpen(proximo);
    // Enumerar a cada abertura: camera USB pode ter sido ligada depois.
    if (proximo) setCameras(await listCameras());
  }

  async function escolherCamera(deviceId: string) {
    setCamMenuOpen(false);
    setCamId(deviceId);
    savePreferredCamera(deviceId);
    /**
     * Com a camera JA ligada, trocar exige republicar com o aparelho novo —
     * o LiveKit nao troca a fonte de uma faixa no ar. Desligada, a escolha
     * fica guardada e vale quando ligar.
     */
    if (cameraLigada) await roomControls?.setCameraEnabled(true, deviceId);
    // Unico fluxo de preferencia do app sem confirmacao nenhuma equivalente
    // ao "Salvo." — o menu fechar sozinho nao diz que pegou.
    toast.sucesso("Câmera alterada.");
  }

  async function pickMicrophone(deviceId: string) {
    setMicMenuOpen(false);
    setMicId(deviceId);
    savePreferredMicrophone(deviceId);
    // Sem call ativa a escolha fica guardada e vale na proxima conexao.
    await roomControls?.setMicrophone(deviceId);
    toast.sucesso("Microfone alterado.");
  }

  const roomControls = useRealtimeStore((state) => state.roomControls);
  const localSharing = useRealtimeStore((state) => state.localSharing);
  const sharePreset = useRealtimeStore((state) => state.sharePreset);

  /**
   * Moderacao ganha do proprio controle: quem foi silenciado pelo servidor nao
   * se desfaz sozinho. O SFU ja impede publicar, mas deixar o botao ligavel
   * daria a impressao de que voltou a falar.
   */
  const serverMuted = selfVoice?.serverMuted ?? false;
  const serverDeafened = selfVoice?.serverDeafened ?? false;

  const muted = serverMuted || (selfVoice ? selfVoice.selfMuted : localMuted);
  const deafened =
    serverDeafened || (selfVoice ? selfVoice.selfDeafened : localDeafened);

  function toggleMute() {
    if (serverMuted) return;
    const next = !muted;
    setLocalMuted(next);
    socket?.emit("voice:state", { selfMuted: next });
  }

  function toggleDeafen() {
    if (serverDeafened) return;
    const next = !deafened;
    setLocalDeafened(next);
    // Ensurdecer implica mutar, como no TeamSpeak.
    if (next) setLocalMuted(true);
    socket?.emit("voice:state", { selfDeafened: next });
  }

  /**
   * Liga/desliga o RNNoise. Grava a preferencia SEMPRE (vale na proxima
   * conexao) e, se houver call, aplica na faixa ja publicada.
   */
  async function alternarRuido(ligar: boolean) {
    const novo = { ...lerTratamentoDeAudio(), rnnoise: ligar };
    setTratamento(novo);
    salvarTratamentoDeAudio(novo);
    const aplicado = await roomControls?.definirSupressaoAvancada(ligar);
    /**
     * `false` numa call com o mic ABERTO = o worklet nao carregou de verdade
     * — nao deixa a chave mentir, reverte. Com o mic MUTADO, `false` e
     * esperado: a `room.ts` reaplica a preferencia quando a faixa republica
     * (ao desmutar). Sem call, `roomControls` e null e a preferencia salva
     * acima ja vale para a proxima conexao.
     */
    if (roomControls && aplicado === false && !muted) {
      const revertido = { ...novo, rnnoise: !ligar };
      setTratamento(revertido);
      salvarTratamentoDeAudio(revertido);
    }
  }

  /**
   * Forca do gate pela VAD do RNNoise (0..1). Grava e aplica ao vivo — o
   * `room.ts` empurra no worklet sem refazer o grafo.
   */
  function ajustarForcaRuido(valor: number) {
    const novo = { ...lerTratamentoDeAudio(), forcaRnnoise: valor };
    setTratamento(novo);
    salvarTratamentoDeAudio(novo);
    roomControls?.definirForcaSupressao(valor);
  }

  /**
   * Alterna uma das TRES nativas (supressao nativa, eco, ganho). Grava e, se
   * houver call, `restartTrack` re-adquire o mic com a constraint nova sem
   * derrubar ninguem. Trava o popover durante a troca.
   */
  async function alternarNativo(
    campo: "supressaoDeRuido" | "cancelamentoDeEco" | "ganhoAutomatico",
  ) {
    if (reaplicandoNativo) return;
    const atual = lerTratamentoDeAudio();
    const novo = { ...atual, [campo]: !atual[campo] };
    setTratamento(novo);
    salvarTratamentoDeAudio(novo);
    if (!roomControls) return;
    setReaplicandoNativo(true);
    await roomControls.reaplicarTratamentoNativo();
    setReaplicandoNativo(false);
  }

  const canShare = viewerCan(viewer, "SCREEN_SHARE");
  /**
   * Compartilhar exige tres coisas ao mesmo tempo: permissao do cargo, estar
   * numa call (a tela vai para a sala de midia) e um navegador com captura —
   * que so existe em contexto seguro, ou seja, HTTPS ou localhost.
   */
  const shareBlocked = !canShare || !roomControls || !canCaptureScreen();

  /**
   * A camera exige o cargo e estar numa call, pelas mesmas razoes da tela.
   *
   * A checagem AQUI e conveniencia: quem decide de verdade e o token do SFU,
   * que so lista a fonte CAMERA para quem tem a permissao. Esconder o botao
   * evita oferecer o que seria recusado; nao e o que protege.
   */
  const podeCamera = viewerCan(viewer, "CAMERA");
  const cameraBloqueada = !podeCamera || !roomControls;
  const cameraLigada =
    useRealtimeStore((estado) => estado.localCameraTrack) !== null;

  async function alternarCamera() {
    if (!roomControls) return;
    const desejado = !cameraLigada;
    const deu = await roomControls.setCameraEnabled(
      desejado,
      desejado ? (camId ?? undefined) : undefined,
    );
    if (!deu) return;
    /**
     * O indicador so e anunciado DEPOIS de a faixa mudar de verdade. Anunciar
     * antes acenderia a camera na tela dos outros enquanto o dispositivo ainda
     * podia recusar.
     */
    socket?.emit("voice:camera", desejado);
  }

  /**
   * Transmitindo, troca a qualidade da faixa que ja esta no ar; parado,
   * comeca uma transmissao nova. O mesmo menu serve para os dois porque a
   * escolha e a mesma — o que muda e so haver ou nao faixa para ajustar.
   */
  async function pickPreset(preset: SharePresetId) {
    setPresetOpen(false);
    if (localSharing) {
      await roomControls?.setSharePreset(preset);
      return;
    }
    const started = await roomControls?.startShare(preset, shareAudio);
    /**
     * O `startScreenShare` desliga a preferencia sozinho quando o sistema
     * recusa abrir o som. Relemos para a chave na tela refletir isso — senao
     * ela continuaria ligada e a proxima tentativa falharia igual.
     */
    if (!started) setShareAudio(readShareAudioPreference());
  }

  function toggleShareAudio() {
    const next = !shareAudio;
    setShareAudio(next);
    saveShareAudioPreference(next);
  }

  return (
    <footer
      /**
       * HUD, nao rodape. Ancorada no PALCO (o <main> e `relative`), flutuando
       * a 20px do fundo e centrada — nao presa a borda da janela nem ocupando
       * a largura toda. `z-30` a mantem sobre o conteudo do canal; `w-max`
       * impede que ela estique.
       *
       * NO CELULAR ela tambem nao pode ESTOURAR. `w-max` so cuida do lado de
       * cima: medido numa tela de 375px, a barra pedia 386 e saia 5px para
       * cada lado, cortando o botao de camera. O teto deixa o nome truncar —
       * ele ja nasce com `min-w-0` e `truncate` — em vez de empurrar os
       * botoes para fora, que sao o que se vem clicar aqui.
       */
      className="absolute bottom-5 left-1/2 z-30 flex w-max max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-2 rounded-lg border border-line bg-base-750/95 px-3 py-2 shadow-[var(--shadow-pop)] backdrop-blur-sm md:max-w-none"
    >
      {/*
        O nome abre o CARTAO, nao as configuracoes.
        Antes ia direto para uma tela inteira — e o que se quer ao clicar no
        proprio nome, na maioria das vezes, e olhar a call ou trocar o status.
        As configuracoes seguem a um clique, de dentro do cartao.
      */}
      <button
        type="button"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setSelfCard((atual) =>
            atual ? null : { x: rect.left, y: rect.top - 340 },
          );
        }}
        title="Voce"
        className="flex min-w-0 items-center gap-2 rounded-md py-0.5 pr-1 text-left transition-opacity hover:opacity-80"
      >
        <Avatar
          userId={user.id}
          name={user.displayName}
          src={user.avatarUrl}
          moldura={user.moldura}
          status={presence[user.id] ?? "OFFLINE"}
          size="sm"
        />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13px] font-medium text-ink-100">
            {user.displayName}
          </p>
          <p className="select-text truncate font-mono text-[11px] text-ink-500">
            @{user.username}
          </p>
        </div>
      </button>

      {selfCard ? (
        <SelfUserCard
          user={user}
          voiceChannels={voiceChannels}
          anchor={selfCard}
          onClose={() => setSelfCard(null)}
          onOpenSettings={() => setProfileOpen(true)}
        />
      ) : null}

      <AppSettingsModal
        open={profileOpen}
        onClose={() => {
          setProfileOpen(false);
          setVoltouDoSpotify(false);
        }}
        user={user}
        server={{ id: currentServerId, memberId, nickname }}
        abaInicial={voltouDoSpotify ? "conexoes" : undefined}
      />

      <div className="mx-0.5 h-6 w-px bg-line" />

      <div className="flex items-center gap-1">
        <div className="relative flex items-center">
          <ControlToggle
            active={!muted && !micTest}
            onClick={toggleMute}
            disabled={serverMuted || micTest}
            label={
              micTest
                ? "Microfone em teste — nao transmitindo"
                : serverMuted
                  ? "Silenciado pela moderacao do servidor"
                  : muted
                    ? "Microfone desligado"
                    : "Microfone ligado"
            }
            danger={muted && !micTest}
          >
            <AetherIcon name={muted ? "mic-off" : "mic"} />
          </ControlToggle>

          <button
            type="button"
            onClick={() => void openMicMenu()}
            title="Escolher microfone"
            aria-label="Escolher microfone"
            className="grid h-9 w-4 place-items-center rounded-r-md text-ink-500 transition-colors hover:text-ink-100"
          >
            <AetherIcon
              name="chevron"
              size="sm"
              className="h-3 w-3 rotate-180"
            />
          </button>

          {micMenuOpen ? (
            <>
              <button
                type="button"
                aria-label="Fechar"
                onClick={() => setMicMenuOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div className="absolute bottom-11 left-0 z-50 w-72 animate-rise rounded-lg border border-line bg-base-900 p-1 shadow-xl">
                <p className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-500">
                  microfone
                </p>
                {devices.length === 0 ? (
                  <p className="px-2 pb-2 text-[12px] leading-snug text-ink-500">
                    Nenhum microfone encontrado. Conecte um e abra de novo.
                  </p>
                ) : (
                  devices.map((device) => (
                    <button
                      key={device.deviceId}
                      type="button"
                      onClick={() => void pickMicrophone(device.deviceId)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] transition-colors hover:bg-base-800",
                        device.deviceId === micId
                          ? "text-accent-300"
                          : "text-ink-200",
                      )}
                    >
                      <AetherIcon name="mic" size="sm" className="shrink-0" />
                      <span className="truncate">{device.label}</span>
                    </button>
                  ))
                )}
                <p className="border-t border-line px-2 py-1.5 text-[11px] leading-snug text-ink-600">
                  Os nomes so aparecem depois de voce permitir o microfone uma
                  vez.
                </p>
              </div>
            </>
          ) : null}
        </div>

        <ControlToggle
          active={!deafened}
          onClick={toggleDeafen}
          disabled={serverDeafened}
          label={
            serverDeafened
              ? "Audio desativado pela moderacao do servidor"
              : deafened
                ? "Audio desativado"
                : "Audio ativado"
          }
          danger={deafened}
        >
          <AetherIcon name={deafened ? "volume-off" : "headset"} />
        </ControlToggle>

        <div className="relative flex items-center">
          <ControlToggle
            active={cameraLigada}
            danger={cameraLigada}
            disabled={cameraBloqueada}
            onClick={() => void alternarCamera()}
            label={
              cameraLigada
                ? "Desligar a camera"
                : !podeCamera
                  ? "Seu cargo nao permite ligar a camera"
                  : !roomControls
                    ? "Entre em um canal de voz para ligar a camera"
                    : "Ligar a camera"
            }
          >
            <AetherIcon name={cameraLigada ? "camera-off" : "camera"} />
          </ControlToggle>

          <button
            type="button"
            onClick={() => void abrirMenuDeCamera()}
            disabled={cameraBloqueada}
            title="Escolher camera"
            aria-label="Escolher camera"
            className="grid h-9 w-4 place-items-center rounded-r-md text-ink-500 transition-colors hover:text-ink-100 disabled:opacity-40"
          >
            <AetherIcon
              name="chevron"
              size="sm"
              className="h-3 w-3 rotate-180"
            />
          </button>

          {camMenuOpen ? (
            <>
              <button
                type="button"
                aria-label="Fechar"
                onClick={() => setCamMenuOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div className="absolute bottom-11 left-0 z-50 w-72 animate-rise rounded-lg border border-line bg-base-900 p-1 shadow-xl">
                <p className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-500">
                  camera
                </p>
                {cameras.length === 0 ? (
                  <p className="px-2 pb-2 text-[12px] leading-snug text-ink-500">
                    Nenhuma camera encontrada. Conecte uma e abra de novo.
                  </p>
                ) : (
                  cameras.map((aparelho) => (
                    <button
                      key={aparelho.deviceId}
                      type="button"
                      onClick={() => void escolherCamera(aparelho.deviceId)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] transition-colors hover:bg-base-800",
                        aparelho.deviceId === camId
                          ? "text-accent-300"
                          : "text-ink-200",
                      )}
                    >
                      <AetherIcon
                        name="camera"
                        size="sm"
                        className="shrink-0"
                      />
                      <span className="truncate">{aparelho.label}</span>
                    </button>
                  ))
                )}
                <p className="border-t border-line px-2 py-1.5 text-[11px] leading-snug text-ink-600">
                  Os nomes so aparecem depois de voce permitir a camera uma vez.
                </p>
              </div>
            </>
          ) : null}
        </div>

        <div className="relative flex items-center">
          <ControlToggle
            active={localSharing}
            danger={localSharing}
            disabled={shareBlocked}
            onClick={() => {
              if (localSharing) {
                void roomControls?.stopShare();
                return;
              }
              setPresetOpen((open) => !open);
            }}
            label={
              localSharing
                ? "Parar de compartilhar"
                : !canShare
                  ? "Seu cargo nao permite compartilhar tela"
                  : !roomControls
                    ? "Entre em um canal de voz para compartilhar"
                    : !canCaptureScreen()
                      ? "Este navegador nao permite captura de tela"
                      : "Compartilhar tela"
            }
          >
            <AetherIcon name={localSharing ? "screen-stop" : "screen-share"} />
          </ControlToggle>

          {/*
            Setinha para a qualidade, no mesmo vocabulario que o microfone ja
            usa para trocar de aparelho. Existe SOBRETUDO enquanto se
            transmite: sem ela, mudar de perfil obrigava a parar e comecar de
            novo, e o Chrome reabriria o seletor de tela no meio da conversa.
          */}
          {localSharing ? (
            <button
              type="button"
              onClick={() => setPresetOpen((open) => !open)}
              title="Trocar a qualidade sem parar a transmissao"
              aria-label="Trocar a qualidade da transmissao"
              className="grid h-9 w-4 place-items-center rounded-r-md text-ink-500 transition-colors hover:text-ink-100"
            >
              <AetherIcon
                name="chevron"
                size="sm"
                className="h-3 w-3 rotate-180"
              />
            </button>
          ) : null}

          {presetOpen ? (
            <>
              {/* clique fora fecha, sem prender o foco da pagina */}
              <button
                type="button"
                aria-label="Fechar"
                onClick={() => setPresetOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div className="absolute bottom-11 left-0 z-50 w-64 animate-rise rounded-lg border border-line bg-base-900 p-1 shadow-xl">
                <p className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-500">
                  {localSharing ? "trocar qualidade" : "qualidade"}
                </p>

                {/*
                  A escolha do som vem ANTES do seletor nativo abrir, de
                  proposito. `getDisplayMedia` e tudo-ou-nada com audio: se o
                  sistema recusar abrir o som, a captura inteira falha. Antes
                  descobriamos isso tentando e refazendo — o que reabria o
                  seletor. Melhor decidir aqui.

                  So aparece antes de comecar: com a transmissao no ar, mudar
                  isso exigiria recapturar, que e justamente o que evitamos.
                */}
                {!localSharing && !noDesktop ? (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={shareAudio}
                    onClick={() => toggleShareAudio()}
                    className="mb-1 flex w-full items-start gap-2.5 border-b border-line px-2 pb-2 text-left text-[12px] text-ink-200"
                  >
                    <span className="pt-0.5">
                      <SwitchVisual checked={shareAudio} />
                    </span>
                    <span className="leading-snug">
                      Levar o som do sistema
                      <span className="mt-0.5 block text-[11px] text-ink-500">
                        Aba e tela inteira oferecem som; janela avulsa nao.
                      </span>
                    </span>
                  </button>
                ) : null}
                {PRESET_LIST.map((preset) => {
                  const active = localSharing && preset.id === sharePreset;
                  /**
                   * Perfil acima do plano aparece TRANCADO, e nao escondido.
                   *
                   * Esconder faria a pessoa nunca saber que existe 1080p — e o
                   * unico jeito de ela descobrir seria alguem contar. Trancado,
                   * o cadeado explica o limite e diz onde ele muda. Isto e
                   * INTERFACE: quem burlar publica assim mesmo, e o gateway
                   * silencia a faixa no SFU alguns segundos depois.
                   */
                  const bloqueado = !perfilCabeNoPlano(preset, limitesDeTela);
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={bloqueado}
                      onClick={() => void pickPreset(preset.id)}
                      title={
                        bloqueado
                          ? `Seu plano vai ate ${limitesDeTela.alturaMax}p a ${limitesDeTela.quadrosMax}fps`
                          : undefined
                      }
                      className={cn(
                        "flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left transition-colors",
                        bloqueado
                          ? "cursor-not-allowed opacity-45"
                          : "hover:bg-base-800",
                        active && "bg-base-800",
                      )}
                    >
                      <span
                        className={cn(
                          "flex items-center gap-1.5 text-[13px]",
                          active ? "text-accent-300" : "text-ink-100",
                        )}
                      >
                        {preset.label}
                        {bloqueado ? (
                          <AetherIcon
                            name="lock"
                            size="sm"
                            className="h-3 w-3 shrink-0 text-amber-400/80"
                          />
                        ) : active ? (
                          <AetherIcon
                            name="check"
                            size="sm"
                            className="h-3 w-3 shrink-0"
                          />
                        ) : null}
                      </span>
                      <span className="text-[11px] leading-snug text-ink-500">
                        {preset.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>

        {selfVoice ? (
          <>
            <span className="mx-0.5 h-6 w-px bg-line" />

            <div className="relative flex items-center">
              <ControlToggle
                active={rnnoise}
                isolate={micTest}
                disabled={!roomControls}
                onClick={() => setNoiseOpen((open) => !open)}
                label={
                  micTest
                    ? "Testando o microfone"
                    : rnnoise
                      ? "Supressao de ruido avancada ligada"
                      : "Supressao de ruido"
                }
              >
                <AetherIcon name="noise" />
              </ControlToggle>

              {noiseOpen ? (
                <>
                  <button
                    type="button"
                    aria-label="Fechar"
                    onClick={() => setNoiseOpen(false)}
                    className="fixed inset-0 z-40 cursor-default"
                  />
                  <div className="absolute bottom-11 left-1/2 z-50 w-[320px] -translate-x-1/2 animate-rise rounded-lg border border-line bg-base-750 p-4 shadow-[var(--shadow-pop)]">
                    <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-500">
                      Tratamento do microfone
                    </p>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={rnnoise}
                      onClick={() => void alternarRuido(!rnnoise)}
                      className="flex w-full items-start gap-3 rounded-md border border-line bg-base-850 p-3 text-left"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-base-950 text-ink-200">
                        <AetherIcon name="sparkle" size="sm" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-semibold text-ink-100">
                          Modelo de IA (RNNoise)
                        </span>
                        <span className="block text-[11px] leading-snug text-ink-500">
                          Roda na sua maquina, alem da supressao nativa. Corta
                          teclado, ventilador e ar-condicionado que a nativa
                          deixa passar. Baixa ~1,9 MB na primeira vez.
                        </span>
                      </span>
                      <span className="pt-0.5">
                        <SwitchVisual checked={rnnoise} />
                      </span>
                    </button>

                    {rnnoise ? (
                      <div className="mt-2 rounded-md border border-line bg-base-850 px-3 py-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-ink-200">
                            Forca
                          </span>
                          <span className="font-mono text-[10px] text-ink-500">
                            {Math.round(
                              (tratamento?.forcaRnnoise ?? 0.5) * 100,
                            )}
                            %
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={tratamento?.forcaRnnoise ?? 0.5}
                          onChange={(e) =>
                            ajustarForcaRuido(Number(e.target.value))
                          }
                          className="mt-1.5 w-full accent-accent-500"
                          aria-label="Forca da supressao de ruido"
                        />
                        <p className="mt-1 flex justify-between text-[10px] text-ink-500">
                          <span>suave</span>
                          <span>agressivo</span>
                        </p>
                        <p className="mt-1.5 text-[11px] leading-snug text-ink-500">
                          Mais forca corta melhor o teclado nas pausas, mas pode
                          engolir o comeco de uma palavra ou um sussurro.
                        </p>
                      </div>
                    ) : null}

                    {/*
                      As tres nativas. Vinham so em Configuracoes porque muda-las
                      exige re-adquirir o microfone; agora o `restartTrack` faz
                      isso no meio da call sem derrubar ninguem. `reaplicandoNativo`
                      trava as tres durante a troca.
                    */}
                    <div className="mt-2 space-y-0.5 rounded-md border border-line bg-base-850 p-1">
                      {tratamento
                        ? (
                            [
                              [
                                "supressaoDeRuido",
                                "Supressao de ruido (nativa)",
                              ],
                              ["cancelamentoDeEco", "Cancelamento de eco"],
                              ["ganhoAutomatico", "Ganho automatico"],
                            ] as const
                          ).map(([campo, rotulo]) => (
                            <button
                              key={campo}
                              type="button"
                              role="switch"
                              aria-checked={tratamento[campo]}
                              disabled={reaplicandoNativo}
                              onClick={() => void alternarNativo(campo)}
                              className={cn(
                                "flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-[12px] text-ink-200 hover:bg-base-800",
                                reaplicandoNativo && "cursor-wait opacity-60",
                              )}
                            >
                              {rotulo}
                              <SwitchVisual checked={tratamento[campo]} />
                            </button>
                          ))
                        : null}
                    </div>
                    <p className="mt-1.5 text-[11px] leading-snug text-ink-500">
                      Desligue as tres se voce toca, canta ou passa uma mesa de
                      som pelo microfone — elas foram feitas para favorecer
                      fala.
                    </p>

                    <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                      <button
                        type="button"
                        onClick={() => {
                          setMicTest(!micTest);
                          setNoiseOpen(false);
                        }}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                          micTest
                            ? "border-signal-isolate/40 bg-signal-isolate/15 text-signal-isolate-ink"
                            : "border-line bg-base-850 text-ink-200 hover:bg-base-800",
                        )}
                      >
                        <AetherIcon name="headset-monitor" size="sm" />
                        {micTest ? "Parar teste" : "Ouvir a si mesmo"}
                      </button>
                      <span className="text-[11px] text-ink-500">
                        Use fones para evitar eco.
                      </span>
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            <span className="mx-0.5 h-6 w-px bg-line" />

            <ControlToggle
              active={false}
              danger
              onClick={() => socket?.emit("voice:leave")}
              label="Desconectar da voz"
            >
              <AetherIcon name="disconnect" />
            </ControlToggle>
          </>
        ) : null}
      </div>

      <div className="flex items-center gap-1">
        {/*
          O estado do tempo real virou um PONTO. Escrito por extenso
          ("tempo real · ligado") ele sozinho era mais largo que todos os
          botoes somados, e numa HUD flutuante largura e o recurso escasso.
          A informacao continua inteira no title.
        */}
        <span
          title={
            connected
              ? "Conectado ao gateway em tempo real"
              : "Sem conexao com o gateway — presenca e chat ficam parados"
          }
          className={cn(
            "mr-1 h-1.5 w-1.5 shrink-0 rounded-full transition-colors",
            status === "online"
              ? "bg-signal-online"
              : status === "connecting"
                ? "bg-signal-idle"
                : "bg-ink-500",
          )}
        />

        {/*
          Esta engrenagem e do APP, nao do servidor. A do servidor mora no
          cabecalho da coluna de canais — antes as duas faziam a MESMA coisa,
          e uma delas era caminho repetido sem nada a mais.
        */}
        <ControlToggle
          active={false}
          label="Configuracoes"
          onClick={() => setProfileOpen(true)}
        >
          <AetherIcon name="settings" />
        </ControlToggle>

        <ControlToggle
          active={false}
          label="Sair da conta"
          onClick={() => startTransition(() => logoutAction())}
          disabled={pending}
        >
          <AetherIcon name="logout" className="h-4 w-4" />
        </ControlToggle>
      </div>
    </footer>
  );
}

/**
 * Botao do dock — o `.ctl` do redesign: 36px, borda, cantos curtos. Quatro
 * estados, cada um por FORMA e COR (nunca so cor):
 *  - `active`   — recurso ligado, azul do AETHER + ponto no canto.
 *  - `danger`   — mic mudo / audio off, `signal-dnd`.
 *  - `isolate`  — teste de microfone, `signal-isolate` + ponto.
 *  - `disabled` — unico estado que pode reduzir contraste.
 */
function ControlToggle({
  children,
  active,
  danger,
  isolate,
  disabled,
  label,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  danger?: boolean;
  isolate?: boolean;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "relative grid h-9 w-9 place-items-center rounded-md border transition-colors duration-150",
        "active:translate-y-px",
        isolate
          ? "border-signal-isolate/40 bg-signal-isolate/15 text-signal-isolate"
          : danger
            ? "border-signal-dnd/35 bg-signal-dnd/12 text-signal-dnd hover:bg-signal-dnd/20"
            : active
              ? "border-accent-600/60 bg-accent-500/15 text-accent-300 shadow-[inset_0_0_0_1px_var(--color-accent-600)]"
              : "border-line bg-base-850 text-ink-200 hover:bg-base-800 hover:text-ink-100",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      {children}
      {(active || isolate) && !disabled ? (
        <span className="absolute right-1 top-1 h-1 w-1 rounded-full bg-current" />
      ) : null}
    </button>
  );
}
