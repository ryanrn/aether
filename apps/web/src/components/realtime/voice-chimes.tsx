"use client";

import { useEffect, useRef } from "react";
import { useRealtimeStore, useSelfVoice } from "@/lib/stores/realtime-store";
import { playJoinChime, playLeaveChime } from "@/lib/voice/sounds";

/**
 * Toca o aviso sonoro quando alguem entra ou sai da SUA call.
 *
 * Dois cuidados que separam isso de tocar som a cada evento:
 *
 * 1. Ao entrar num canal que ja tem gente, voce ouve um som — o seu — e nao um
 *    por pessoa que ja estava la. O conjunto inicial e registrado sem tocar.
 * 2. Ensurdecido nao ouve nada. Quem desligou o audio nao quer ser avisado
 *    por audio.
 *
 * Fica no layout do servidor, nao na pagina do canal: a call continua quando
 * voce navega para um canal de texto, e o aviso tem de continuar junto.
 */
export function VoiceChimes() {
  const selfVoice = useSelfVoice();
  const voice = useRealtimeStore((state) => state.voice);
  const selfUserId = useRealtimeStore((state) => state.selfUserId);

  const channelId = selfVoice?.channelId ?? null;
  const deafened = selfVoice?.selfDeafened ?? false;

  /** ocupantes conhecidos do canal atual; null enquanto nao entramos */
  const knownRef = useRef<Set<string> | null>(null);
  const channelRef = useRef<string | null>(null);
  const deafenedRef = useRef(deafened);
  deafenedRef.current = deafened;

  useEffect(() => {
    const previousChannel = channelRef.current;

    // Saiu da call
    if (channelId === null) {
      if (previousChannel !== null && !deafenedRef.current) playLeaveChime();
      channelRef.current = null;
      knownRef.current = null;
      return;
    }

    const occupants = new Set(
      Object.values(voice)
        .filter((participant) => participant.channelId === channelId)
        .map((participant) => participant.userId),
    );

    // Entrou agora (ou trocou de canal): um som so, o seu.
    if (previousChannel !== channelId) {
      if (!deafenedRef.current) playJoinChime();
      channelRef.current = channelId;
      knownRef.current = occupants;
      return;
    }

    const known = knownRef.current;
    if (!known) {
      knownRef.current = occupants;
      return;
    }

    if (!deafenedRef.current) {
      for (const userId of occupants) {
        if (userId !== selfUserId && !known.has(userId)) playJoinChime();
      }
      for (const userId of known) {
        if (userId !== selfUserId && !occupants.has(userId)) playLeaveChime();
      }
    }

    knownRef.current = occupants;
  }, [channelId, voice, selfUserId]);

  return null;
}
