"use client";

import { useEffect, useState } from "react";

/**
 * "Ha quanto tempo", contado a partir de um instante ISO.
 *
 * O carimbo vem SEMPRE do servidor (o gateway marca `joinedAt` e `gameSince`),
 * nunca do relogio local: duas maquinas com horarios diferentes mostrariam
 * tempos diferentes para a mesma chamada.
 *
 * Devolve `null` quando nao ha inicio — quem chama simplesmente nao desenha o
 * relogio.
 */
export function useElapsed(startedAt: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return null;

  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  // Abaixo de uma hora o campo de hora so ocuparia espaco dizendo "00".
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(rest)}`
    : `${pad(minutes)}:${pad(rest)}`;
}

/**
 * A mesma duracao, porem GROSSA: "1h", "30m", "agora".
 *
 * Serve para a linha de resumo ("Jogando GTA V — 1h"), onde o segundo a
 * segundo seria ruido em movimento. O relogio preciso fica ao lado do jogo,
 * que e onde alguem de fato o le.
 *
 * Sem `useState` proprio: recebe o valor ja calculado pelo `useElapsed` de
 * quem chama, para os dois nao contarem separado e piscarem fora de sincronia.
 */
export function duracaoGrossa(startedAt: string | null, agora: number): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return null;

  const minutos = Math.max(0, Math.floor((agora - start) / 60_000));
  if (minutos < 1) return "agora";
  if (minutos < 60) return `${minutos}m`;
  const horas = Math.floor(minutos / 60);
  return `${horas}h`;
}
