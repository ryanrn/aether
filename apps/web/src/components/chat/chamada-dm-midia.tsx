"use client";

import { useEffect, useRef, useState } from "react";
import type { Track } from "livekit-client";
import { PLANS, perfilCabeNoPlano, type PublicUser } from "@aether/shared";
import { AetherIcon } from "@/components/ui/aether-icon";
import { SwitchVisual } from "@/components/ui/switch";
import { VolumeSlider } from "@/components/ui/volume-slider";
import { TrackVideo } from "@/components/voice/screen-share-view";
import { meuPlano } from "@/server/actions/planos";
import { useChamadaDmStore } from "@/lib/stores/chamada-dm-store";
import {
  PRESET_LIST,
  readShareAudioPreference,
  saveShareAudioPreference,
  type SharePresetId,
} from "@/lib/voice/screen-share";
import {
  DEFAULT_VOLUME,
  readScreenVolume,
  readUserVolumes,
  saveScreenVolume,
  saveUserVolume,
} from "@/lib/voice/volumes";
import { toast } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";

/**
 * Video, tela e volume da chamada direta.
 *
 * So interface: o que cada faixa PODE publicar ja veio assinado no token, e o
 * teto do plano na tela e imposto pelo gateway no SFU (`dmcall:tela`). O menu
 * de qualidade tranca o que passa do plano para nao oferecer o que sera
 * silenciado — mesma regra (`perfilCabeNoPlano`) da barra da voz de servidor.
 */

/** Fecha o menu com clique fora ou Esc. */
function useMenu() {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);
  return { aberto, setAberto, ref };
}

/** Mesmo visual do `BotaoRedondo` do painel, com estado ligado. */
function BotaoMidia({
  children,
  onClick,
  label,
  ligado,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  ligado: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={ligado}
      className={cn(
        "grid h-11 w-11 place-items-center rounded-full border transition-colors active:translate-y-px",
        ligado
          ? "border-accent-600/60 bg-accent-500/15 text-accent-300"
          : "border-line bg-base-850 text-ink-200 hover:bg-base-800 hover:text-ink-100",
        "disabled:cursor-not-allowed disabled:opacity-40",
      )}
    >
      {children}
    </button>
  );
}

export function BotaoCameraDm() {
  const controles = useChamadaDmStore((e) => e.controles);
  const minhaCamera = useChamadaDmStore((e) => e.minhaCamera);
  const [trocando, setTrocando] = useState(false);
  const ligada = minhaCamera !== null;

  async function alternar() {
    if (!controles) return;
    setTrocando(true);
    const deu = await controles.setCamera(!ligada);
    setTrocando(false);
    if (!deu && !ligada) toast.erro("Nao foi possivel abrir a camera.");
  }

  return (
    <BotaoMidia
      onClick={() => void alternar()}
      label={ligada ? "Desligar camera" : "Ligar camera"}
      ligado={ligada}
      disabled={!controles || trocando}
    >
      <AetherIcon name={ligada ? "camera" : "camera-off"} />
    </BotaoMidia>
  );
}

export function BotaoTelaDm() {
  const controles = useChamadaDmStore((e) => e.controles);
  const minhaTela = useChamadaDmStore((e) => e.minhaTela);
  const qualidade = useChamadaDmStore((e) => e.qualidadeDaTela);
  const { aberto, setAberto, ref } = useMenu();
  const [comAudio, setComAudio] = useState(false);
  /**
   * Comeca no gratuito e sobe quando a resposta chega — oferecer 1440p por um
   * instante e depois trancar seria pior do que demorar a oferecer.
   */
  const [limites, setLimites] = useState({
    alturaMax: PLANS.FREE.alturaMax,
    quadrosMax: PLANS.FREE.quadrosMax,
  });
  const compartilhando = minhaTela !== null;

  useEffect(() => setComAudio(readShareAudioPreference()), []);
  useEffect(() => {
    if (!aberto) return;
    void meuPlano().then((r) => {
      if (r.ok) {
        setLimites({
          alturaMax: r.data.limites.alturaMax,
          quadrosMax: r.data.limites.quadrosMax,
        });
      }
    });
  }, [aberto]);

  async function escolher(preset: SharePresetId) {
    if (!controles) return;
    setAberto(false);
    if (compartilhando) {
      await controles.trocarQualidade(preset);
      return;
    }
    const deu = await controles.iniciarTela(preset, comAudio);
    // O sistema pode ter recusado o som: relemos para a chave refletir.
    if (!deu) setComAudio(readShareAudioPreference());
  }

  return (
    <div ref={ref} className="relative">
      <BotaoMidia
        onClick={() => setAberto(!aberto)}
        label={compartilhando ? "Opcoes da transmissao" : "Compartilhar tela"}
        ligado={compartilhando}
        disabled={!controles}
      >
        <AetherIcon name={compartilhando ? "screen-stop" : "screen-share"} />
      </BotaoMidia>

      {aberto ? (
        <div className="absolute bottom-full left-1/2 z-30 mb-2 w-72 -translate-x-1/2 rounded-lg border border-line bg-base-850 p-1.5 shadow-2xl">
          {compartilhando ? (
            <button
              type="button"
              onClick={() => {
                setAberto(false);
                void controles?.pararTela();
              }}
              className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] text-signal-dnd hover:bg-base-800"
            >
              <AetherIcon name="screen-stop" size="sm" />
              Parar de compartilhar
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                const proximo = !comAudio;
                setComAudio(proximo);
                saveShareAudioPreference(proximo);
              }}
              className="mb-1 flex w-full items-start gap-2.5 border-b border-line px-2 pb-2 pt-1 text-left text-[12px] text-ink-200"
            >
              <span className="pt-0.5">
                <SwitchVisual checked={comAudio} />
              </span>
              <span className="leading-snug">
                Levar o som do sistema
                <span className="mt-0.5 block text-[11px] text-ink-500">
                  Aba e tela inteira oferecem som; janela avulsa nao.
                </span>
              </span>
            </button>
          )}
          {PRESET_LIST.map((preset) => {
            const ativo = compartilhando && preset.id === qualidade;
            const bloqueado = !perfilCabeNoPlano(preset, limites);
            return (
              <button
                key={preset.id}
                type="button"
                disabled={bloqueado}
                onClick={() => void escolher(preset.id)}
                title={
                  bloqueado
                    ? `Seu plano vai ate ${limites.alturaMax}p a ${limites.quadrosMax}fps`
                    : undefined
                }
                className={cn(
                  "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors",
                  bloqueado ? "cursor-not-allowed opacity-45" : "hover:bg-base-800",
                  ativo && "bg-base-800",
                )}
              >
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-[13px]",
                    ativo ? "text-accent-300" : "text-ink-100",
                  )}
                >
                  {preset.label}
                  {bloqueado ? (
                    <AetherIcon name="lock" size="sm" className="h-3 w-3 text-amber-400/80" />
                  ) : ativo ? (
                    <AetherIcon name="check" size="sm" className="h-3 w-3" />
                  ) : null}
                </span>
                <span className="text-[11px] leading-snug text-ink-500">
                  {preset.description}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Volume do amigo e do som da tela dele. Grava nas MESMAS preferencias da voz
 * de servidor (`saveUserVolume`/`saveScreenVolume`): o volume que voce deu a
 * alguem vale nos dois lugares, e a `room.ts` ja le na conexao.
 */
export function BotaoVolumeDm({ outro }: { outro: PublicUser }) {
  const controles = useChamadaDmStore((e) => e.controles);
  const temTela = useChamadaDmStore((e) => e.telas.length > 0);
  const { aberto, setAberto, ref } = useMenu();
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [volumeTela, setVolumeTela] = useState(DEFAULT_VOLUME);

  useEffect(() => {
    setVolume(readUserVolumes()[outro.id] ?? DEFAULT_VOLUME);
    setVolumeTela(readScreenVolume());
  }, [outro.id]);

  return (
    <div ref={ref} className="relative">
      <BotaoMidia
        onClick={() => setAberto(!aberto)}
        label={`Volume de ${outro.displayName}`}
        ligado={aberto}
        disabled={!controles}
      >
        <AetherIcon name={volume === 0 ? "volume-off" : "volume"} />
      </BotaoMidia>

      {aberto ? (
        <div className="absolute bottom-full left-1/2 z-30 mb-2 w-64 -translate-x-1/2 space-y-3 rounded-lg border border-line bg-base-850 p-3 shadow-2xl">
          <div>
            <p className="mb-1.5 text-[12px] font-medium text-ink-200">
              Volume de {outro.displayName}
            </p>
            <VolumeSlider
              value={volume}
              label={`Volume de ${outro.displayName}`}
              onChange={(v) => {
                setVolume(v);
                saveUserVolume(outro.id, v);
                controles?.setUserVolume(outro.id, v);
              }}
            />
          </div>
          {temTela ? (
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-ink-200">
                Som da tela compartilhada
              </p>
              <VolumeSlider
                value={volumeTela}
                label="Volume do som da tela"
                onChange={(v) => {
                  setVolumeTela(v);
                  saveScreenVolume(v);
                  controles?.setScreenAudioVolume(v);
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A area de video. Prioridade: a TELA do outro em destaque (e o que se quer
 * ver quando alguem compartilha), depois a camera dele; a minha camera e a
 * previa da minha tela ficam pequenas no canto.
 *
 * Devolve `null` sem nenhum video — o painel mostra os avatares.
 */
export function PalcoDaChamada({
  outro,
  eu,
}: {
  outro: PublicUser;
  eu: PublicUser;
}) {
  const telas = useChamadaDmStore((e) => e.telas);
  const cameras = useChamadaDmStore((e) => e.cameras);
  const minhaTela = useChamadaDmStore((e) => e.minhaTela);
  const minhaCamera = useChamadaDmStore((e) => e.minhaCamera);
  const palcoRef = useRef<HTMLDivElement>(null);

  const telaDele = telas.find((t) => t.userId === outro.id)?.track ?? null;
  const cameraDele = cameras.find((c) => c.userId === outro.id)?.track ?? null;

  const destaque = (telaDele ?? cameraDele) as Track | null;
  const ehTela = telaDele !== null;
  const miniaturas: { chave: string; track: Track; legenda: string; espelhar: boolean }[] = [];
  // Com a tela dele em destaque, a camera dele vira miniatura.
  if (ehTela && cameraDele) {
    miniaturas.push({ chave: "cam-dele", track: cameraDele as Track, legenda: outro.displayName, espelhar: false });
  }
  if (minhaCamera) {
    miniaturas.push({ chave: "minha-cam", track: minhaCamera, legenda: eu.displayName, espelhar: true });
  }
  if (minhaTela) {
    miniaturas.push({ chave: "minha-tela", track: minhaTela, legenda: "Sua tela", espelhar: false });
  }

  if (!destaque && miniaturas.length === 0) return null;

  return (
    <div
      ref={palcoRef}
      className="group relative flex aspect-video max-h-[55vh] w-full max-w-4xl items-center justify-center overflow-hidden rounded-xl bg-black"
    >
      {destaque ? (
        <TrackVideo
          track={destaque}
          className={cn(
            "h-full w-full",
            ehTela ? "object-contain" : "object-cover",
          )}
        />
      ) : (
        <p className="text-[12px] text-ink-500">
          {outro.displayName} esta sem video
        </p>
      )}

      {destaque ? (
        <span className="absolute left-3 top-3 rounded bg-black/60 px-2 py-0.5 text-[11px] text-ink-100">
          {ehTela ? `Tela de ${outro.displayName}` : outro.displayName}
        </span>
      ) : null}

      {destaque ? (
        <button
          type="button"
          onClick={() => {
            const el = palcoRef.current;
            if (!el) return;
            if (document.fullscreenElement) void document.exitFullscreen();
            else void el.requestFullscreen().catch(() => undefined);
          }}
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-md bg-black/60 text-ink-100 opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
          title="Tela cheia"
          aria-label="Tela cheia"
        >
          <AetherIcon name="maximize" size="sm" />
        </button>
      ) : null}

      {miniaturas.length > 0 ? (
        <div className="absolute bottom-3 right-3 flex gap-2">
          {miniaturas.map((m) => (
            <div
              key={m.chave}
              className="relative h-24 w-40 overflow-hidden rounded-lg border border-white/10 bg-base-900 shadow-lg"
            >
              <TrackVideo
                track={m.track}
                className={cn("h-full w-full object-cover", m.espelhar && "-scale-x-100")}
              />
              <span className="absolute bottom-1 left-1.5 rounded bg-black/60 px-1.5 text-[10px] text-ink-100">
                {m.legenda}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
