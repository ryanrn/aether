"use client";

import { useEffect, useRef, useState } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/field";
import { startMicLevel, type MicLevelHandle } from "@/lib/voice/mic-level";
import { listMicrophones, type AudioDevice } from "@/lib/voice/devices";
import { cn } from "@/lib/utils";

export interface MicrophoneTestProps {
  /** ID do dispositivo de microfone selecionado */
  deviceId?: string | null;
  /** Callback opcional quando a lista de dispositivos for atualizada após obter permissão */
  onDeviceListRefreshed?: (devices: AudioDevice[]) => void;
  /** Variante de cor dos segmentos: "signal" (verde/amarelo/vermelho como no print) ou "accent" (tons do tema) */
  colorScheme?: "signal" | "accent";
  className?: string;
}

const TOTAL_SEGMENTS = 20;
const MIN_BAR_HEIGHT_PX = 8;
const MAX_BAR_HEIGHT_PX = 24;

/**
 * Componente moderno e isolado de Teste de Microfone (redesign).
 *
 * Características:
 * - Card unificado com bordas e superfície suaves nos tokens base-900 / base-800
 * - Barra de áudio segmentada com inclinação (skew) e altura progressiva ascendente
 * - Reatividade em tempo real com taxa de resposta suave
 * - Botão de ação integrado na lateral direita (Play/Stop)
 * - Compatível 100% com o design system do Aether (Tailwind 4 + tokens do globals.css)
 */
export function MicrophoneTest({
  deviceId = null,
  onDeviceListRefreshed,
  colorScheme = "signal",
  className,
}: MicrophoneTestProps) {
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<MicLevelHandle | null>(null);

  // Limpa o stream ao desmontar o componente para não deixar o microfone aberto
  useEffect(() => {
    return () => {
      handleRef.current?.stop();
    };
  }, []);

  // Se o dispositivo mudar enquanto estiver testando, reinicia com o novo dispositivo
  useEffect(() => {
    if (!testing) return;

    let isCancelled = false;
    handleRef.current?.stop();
    handleRef.current = null;

    void (async () => {
      try {
        const handle = await startMicLevel({
          deviceId,
          onLevel: (lvl) => {
            if (!isCancelled) setLevel(lvl);
          },
        });
        if (!isCancelled) {
          handleRef.current = handle;
        } else {
          handle.stop();
        }
      } catch {
        if (!isCancelled) {
          setError("Não consegui abrir esse microfone.");
          setTesting(false);
          setLevel(0);
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [deviceId]);

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
        deviceId,
        onLevel: setLevel,
      });
      setTesting(true);

      // Re-consulta os aparelhos para preencher os nomes agora que o acesso foi concedido
      if (onDeviceListRefreshed) {
        const freshList = await listMicrophones();
        onDeviceListRefreshed(freshList);
      }
    } catch {
      setError(
        "Não foi possível acessar o microfone. Verifique as permissões ou se ele está em uso.",
      );
      setTesting(false);
      setLevel(0);
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Cabeçalho do campo */}
      <div className="flex items-center justify-between">
        <Label className="text-ink-300">Teste de microfone</Label>
        <span className="text-[12px] text-ink-500">
          {testing
            ? "Fale — a barra deve se mexer"
            : "O som não sai desta máquina"}
        </span>
      </div>

      {/* Card principal com o medidor e o botão de ação */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border border-line bg-base-900 px-3.5 py-3 transition-colors duration-150",
          testing && "border-line bg-base-900/90 shadow-panel",
        )}
      >
        {/* Barra segmentada inclinada com altura progressiva */}
        <div
          className="flex h-7 flex-1 items-end gap-1.5 overflow-hidden"
          role="meter"
          aria-label="Nível de entrada do microfone"
          aria-valuenow={Math.round(level * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {Array.from({ length: TOTAL_SEGMENTS }, (_, index) => {
            // Altura progressiva da barra (de MIN a MAX)
            const progressRatio = index / (TOTAL_SEGMENTS - 1);
            const barHeight =
              MIN_BAR_HEIGHT_PX +
              progressRatio * (MAX_BAR_HEIGHT_PX - MIN_BAR_HEIGHT_PX);

            const isLit = testing && level * TOTAL_SEGMENTS > index;

            // Determinação da cor do segmento ativo
            let litColorClass = "bg-signal-online";
            if (colorScheme === "signal") {
              if (index >= TOTAL_SEGMENTS * 0.8) {
                litColorClass = "bg-signal-dnd";
              } else if (index >= TOTAL_SEGMENTS * 0.55) {
                litColorClass = "bg-signal-idle";
              } else {
                litColorClass = "bg-signal-online";
              }
            } else {
              // Esquema com tokens accent
              if (index >= TOTAL_SEGMENTS * 0.8) {
                litColorClass = "bg-accent-300";
              } else if (index >= TOTAL_SEGMENTS * 0.55) {
                litColorClass = "bg-accent-400";
              } else {
                litColorClass = "bg-accent-500";
              }
            }

            return (
              <span
                key={index}
                style={{ height: `${barHeight}px` }}
                className={cn(
                  "flex-1 -skew-x-[14deg] rounded-[2px] transition-colors duration-75",
                  isLit ? litColorClass : "bg-base-800",
                )}
              />
            );
          })}
        </div>

        {/* Botão de Controle (Play / Stop) */}
        <button
          type="button"
          onClick={() => void toggleTest()}
          title={testing ? "Parar teste" : "Iniciar teste de microfone"}
          aria-label={testing ? "Parar teste" : "Iniciar teste de microfone"}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500",
            testing
              ? "bg-base-800 text-ink-100 border border-line hover:bg-base-750 active:bg-base-700"
              : "bg-base-800 text-ink-300 border border-line hover:bg-base-750 hover:text-ink-100 active:bg-base-700",
          )}
        >
          {testing ? (
            <AetherIcon name="stop" size="sm" className="h-3 w-3" />
          ) : (
            <AetherIcon name="play" size="sm" className="translate-x-px" />
          )}
        </button>
      </div>

      {/* Mensagem de Erro, se houver */}
      {error ? (
        <div className="flex items-center gap-1.5 text-[13px] text-signal-dnd animate-in-fast">
          <AetherIcon name="alert" size="sm" className="shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}
