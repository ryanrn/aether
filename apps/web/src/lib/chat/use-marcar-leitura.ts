"use client";

import { useEffect, useRef } from "react";
import { useSocket } from "@/components/realtime/realtime-provider";
import { useRealtimeStore } from "@/lib/stores/realtime-store";

/** Intervalo minimo entre duas marcacoes da mesma conversa. */
const INTERVALO_MS = 2000;

/**
 * Salva no servidor que a conversa aberta foi lida (P1-3).
 *
 * Marca a mensagem mais nova CONFIRMADA (pendente e falhada nao tem id no
 * banco), quando ela muda e a aba esta visivel. Aba em segundo plano nao
 * conta como leitura: ao voltar para ela, marca.
 *
 * No maximo uma marcacao a cada 2 s: uma conversa movimentada mandaria uma
 * por mensagem. A ultima sempre sai (o timer pendente e reaproveitado), entao
 * o servidor nunca fica com uma leitura mais velha do que a tela mostrou.
 */
export function useMarcarLeitura(conversationId: string): void {
  const socket = useSocket();
  const ultimaId = useRealtimeStore((state) => {
    const lista = state.messages[conversationId];
    if (!lista) return null;
    for (let i = lista.length - 1; i >= 0; i--) {
      const m = lista[i]!;
      if (!m.pending && !m.failed) return m.id;
    }
    return null;
  });

  const enviadaRef = useRef<string | null>(null);
  const ultimoEnvioRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    enviadaRef.current = null;
    ultimoEnvioRef.current = 0;
  }, [conversationId]);

  useEffect(() => {
    if (!socket || !ultimaId) return;

    function enviar() {
      timerRef.current = null;
      if (!socket || !ultimaId) return;
      if (document.visibilityState !== "visible") return;
      if (enviadaRef.current === ultimaId) return;
      enviadaRef.current = ultimaId;
      ultimoEnvioRef.current = Date.now();
      socket.emit("read:mark", { conversationId, messageId: ultimaId });
    }

    function agendar() {
      if (timerRef.current) return;
      const espera = Math.max(0, ultimoEnvioRef.current + INTERVALO_MS - Date.now());
      timerRef.current = setTimeout(enviar, espera);
    }

    agendar();
    document.addEventListener("visibilitychange", agendar);
    return () => {
      document.removeEventListener("visibilitychange", agendar);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [socket, conversationId, ultimaId]);
}
