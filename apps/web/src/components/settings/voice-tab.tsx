"use client";

import { useEffect, useState } from "react";
import { Mic, MonitorUp, Volume2 } from "lucide-react";
import {
  listMicrophones,
  listSpeakers,
  readPreferredMicrophone,
  readPreferredSpeaker,
  savePreferredMicrophone,
  savePreferredSpeaker,
  type AudioDevice,
} from "@/lib/voice/devices";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import { Field } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import {
  CodecDaTela,
  TratamentoDoMicrofone,
} from "@/components/settings/media-advanced";
import { MicrophoneTest } from "@/components/aether-design-v2";

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

  const roomControls = useRealtimeStore((state) => state.roomControls);

  useEffect(() => {
    setSelected(readPreferredMicrophone());
    void listMicrophones().then(setDevices);
    setSelectedSpeaker(readPreferredSpeaker());
    void listSpeakers().then(setSpeakers);
  }, []);

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

      {/* Teste de microfone (Design v2 isolado) */}
      <MicrophoneTest
        deviceId={selected}
        onDeviceListRefreshed={setDevices}
      />

      <div className="rounded-md border border-base-700 bg-base-900 p-3">
        <p className="text-[11px] uppercase tracking-[0.1em] text-ink-500">
          Ainda nao disponivel
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-400">
          Sensibilidade manual e atalho de push-to-talk. O volume de cada
          pessoa fica no menu dela, na arvore de canais.
        </p>
      </div>

      {/*
        DOIS GRUPOS, e nao um bloco de "avancado".
        Estavam juntos sob um titulo so, e isso misturava coisas sem relacao:
        como o SEU MICROFONE e tratado antes de sair, e como a SUA TELA e
        codificada quando voce transmite. Quem ia mexer no codec passava por
        tres chaves de microfone; quem ia desligar a supressao de ruido
        esbarrava em AV1.
      */}
      <div className="border-t border-base-800 pt-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-500">
          Microfone — avancado
        </h3>
        <div className="mt-3">
          <TratamentoDoMicrofone />
        </div>
      </div>

      <div className="border-t border-base-800 pt-5">
        <div className="flex items-center gap-2">
          <MonitorUp className="h-3.5 w-3.5 text-ink-500" />
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-500">
            Transmissao
          </h3>
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-400">
          Vale para quando VOCE compartilha a tela. Nao afeta o que voce ve de
          quem esta transmitindo.
        </p>
        <div className="mt-3">
          <CodecDaTela />
        </div>
      </div>
    </section>
  );
}
