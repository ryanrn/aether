"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Volume2 } from "lucide-react";
import {
  listMicrophones,
  listSpeakers,
  readPreferredMicrophone,
  readPreferredSpeaker,
  savePreferredMicrophone,
  savePreferredSpeaker,
  type AudioDevice,
} from "@/lib/voice/devices";
import { startMicLevel, type MicLevelHandle } from "@/lib/voice/mic-level";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * Voz e video.
 *
 * O teste de microfone e o motivo desta aba existir: antes, descobrir que o
 * microfone estava mudo exigia entrar numa call e perguntar para alguem.
 *
 * O audio do teste NAO sai desta maquina — e lido localmente para desenhar a
 * barra, e o stream e fechado quando a tela sai. Por isso o teste e um botao,
 * e nao algo que liga sozinho ao abrir: ninguem deve ter o microfone aberto
 * sem ter pedido.
 */
export function VoiceTab() {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [speakers, setSpeakers] = useState<AudioDevice[]>([]);
  const [selectedSpeaker, setSelectedSpeaker] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<MicLevelHandle | null>(null);

  const roomControls = useRealtimeStore((state) => state.roomControls);

  useEffect(() => {
    setSelected(readPreferredMicrophone());
    void listMicrophones().then(setDevices);
    setSelectedSpeaker(readPreferredSpeaker());
    void listSpeakers().then(setSpeakers);
  }, []);

  /** O teste morre junto com a tela: microfone aberto sem dono e vazamento. */
  useEffect(() => {
    return () => handleRef.current?.stop();
  }, []);

  function stopTest() {
    handleRef.current?.stop();
    handleRef.current = null;
    setTesting(false);
    setLevel(0);
  }

  async function toggleTest() {
    if (testing) {
      stopTest();
      return;
    }
    setError(null);
    try {
      handleRef.current = await startMicLevel({
        deviceId: selected,
        onLevel: setLevel,
      });
      setTesting(true);
      // Os nomes dos aparelhos so aparecem depois de conceder o microfone
      // uma vez — agora que concedemos, a lista pode ser preenchida de novo.
      setDevices(await listMicrophones());
    } catch {
      setError(
        "Nao consegui abrir o microfone. Ele pode estar em uso por outro programa, ou o acesso foi negado.",
      );
    }
  }

  async function pickSpeaker(deviceId: string) {
    setSelectedSpeaker(deviceId);
    savePreferredSpeaker(deviceId);
    // Sem call ativa a escolha fica guardada e vale na proxima conexao.
    await roomControls?.setOutputDevice(deviceId);
  }

  async function pick(deviceId: string) {
    setSelected(deviceId);
    savePreferredMicrophone(deviceId);
    // Numa call, troca a fonte sem derrubar ninguem.
    await roomControls?.setMicrophone(deviceId);
    // Testando, reabre no aparelho novo para a barra refletir a escolha.
    if (testing) {
      stopTest();
      setError(null);
      try {
        handleRef.current = await startMicLevel({ deviceId, onLevel: setLevel });
        setTesting(true);
      } catch {
        setError("Nao consegui abrir esse microfone.");
      }
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <Field
        label="Microfone"
        hint="Vale para as proximas conexoes e tambem para a call em andamento."
      >
        {devices.length === 0 ? (
          <p className="text-[13px] text-ink-500">
            Nenhum microfone encontrado. Conecte um e abra esta tela de novo.
          </p>
        ) : (
          <div className="flex flex-col gap-1 rounded-md border border-base-700 bg-base-900 p-1">
            {devices.map((device) => (
              <button
                key={device.deviceId}
                type="button"
                onClick={() => void pick(device.deviceId)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] transition-colors hover:bg-base-800",
                  device.deviceId === selected
                    ? "text-accent-300"
                    : "text-ink-200",
                )}
              >
                <Mic className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{device.label}</span>
              </button>
            ))}
          </div>
        )}
      </Field>

      <Field
        label="Alto-falante"
        hint="Para onde tocamos o microfone dos outros e o som de tela."
      >
        {speakers.length === 0 ? (
          <p className="text-[13px] text-ink-500">
            {typeof window !== "undefined" &&
            !("setSinkId" in HTMLMediaElement.prototype)
              ? "Este navegador nao permite escolher o alto-falante de saida."
              : "Nenhum alto-falante encontrado."}
          </p>
        ) : (
          <div className="flex flex-col gap-1 rounded-md border border-base-700 bg-base-900 p-1">
            {speakers.map((device) => (
              <button
                key={device.deviceId}
                type="button"
                onClick={() => void pickSpeaker(device.deviceId)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] transition-colors hover:bg-base-800",
                  device.deviceId === selectedSpeaker
                    ? "text-accent-300"
                    : "text-ink-200",
                )}
              >
                <Volume2 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{device.label}</span>
              </button>
            ))}
          </div>
        )}
      </Field>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => void toggleTest()}>
            {testing ? "Parar teste" : "Testar microfone"}
          </Button>
          <span className="text-[12px] text-ink-500">
            {testing ? "Fale — a barra deve se mexer." : "O som nao sai daqui."}
          </span>
        </div>

        {/* Barra de nivel: segmentada, para nao parecer um carregamento. */}
        <div
          className="flex h-2.5 gap-[3px]"
          role="meter"
          aria-label="Nivel do microfone"
          aria-valuenow={Math.round(level * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {Array.from({ length: 28 }, (_, index) => {
            const aceso = testing && level * 28 > index;
            return (
              <span
                key={index}
                className={cn(
                  "flex-1 rounded-[2px] transition-colors duration-75",
                  aceso
                    ? index > 23
                      ? "bg-signal-dnd"
                      : "bg-accent-500"
                    : "bg-base-800",
                )}
              />
            );
          })}
        </div>

        {error ? (
          <p className="text-[13px] text-signal-dnd">{error}</p>
        ) : null}
      </div>

      <div className="rounded-md border border-base-700 bg-base-900 p-3">
        <p className="text-[11px] uppercase tracking-[0.1em] text-ink-500">
          Ainda nao disponivel
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-400">
          Sensibilidade manual e atalho de push-to-talk. O volume de cada
          pessoa fica no menu dela, na arvore de canais.
        </p>
      </div>
    </section>
  );
}
