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
 * 3. A propria (re)montagem do componente NAO toca nada — `primeiraVezRef`
 *    sincroniza em silencio. Sem isso, montar ja em call (voltar da home para
 *    um servidor) tocava o som de "entrei" do nada.
 *
 * Mora no `<RealtimeRoot>` (layout raiz), junto da `<VoiceSession>`: o aviso
 * acompanha a call por TODA a navegacao dentro de `/app`, nao so entre canais.
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
  /** a primeira passada so registra o estado — nunca toca som */
  const primeiraVezRef = useRef(true);

  useEffect(() => {
    const occupantsAgora = new Set(
      Object.values(voice)
        .filter((p) => p.channelId === channelId)
        .map((p) => p.userId),
    );

    // Montou (ou remontou): sincroniza em silencio. Entrar de fato numa call
    // depois disso ja passa pela logica normal abaixo e toca o som certo.
    if (primeiraVezRef.current) {
      primeiraVezRef.current = false;
      channelRef.current = channelId;
      knownRef.current = channelId === null ? null : occupantsAgora;
      return;
    }

    const previousChannel = channelRef.current;

    // Saiu da call
    if (channelId === null) {
      if (previousChannel !== null && !deafenedRef.current) playLeaveChime();
      channelRef.current = null;
      knownRef.current = null;
      return;
    }

    // Entrou agora (ou trocou de canal): um som so, o seu.
    if (previousChannel !== channelId) {
      if (!deafenedRef.current) playJoinChime();
      channelRef.current = channelId;
      knownRef.current = occupantsAgora;
      return;
    }

    const known = knownRef.current;
    if (!known) {
      knownRef.current = occupantsAgora;
      return;
    }

    if (!deafenedRef.current) {
      for (const userId of occupantsAgora) {
        if (userId !== selfUserId && !known.has(userId)) playJoinChime();
      }
      for (const userId of known) {
        if (userId !== selfUserId && !occupantsAgora.has(userId)) {
          playLeaveChime();
        }
      }
    }

    knownRef.current = occupantsAgora;
  }, [channelId, voice, selfUserId]);

  return null;
}
