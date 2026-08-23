import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser } from "@aether/shared";
import {
  joinVoice,
  leaveVoice,
  voiceParticipant,
} from "../../apps/realtime/src/state";

/**
 * `joinedAt` — o carimbo que sustenta o "ha quanto tempo" do AETHER Activity.
 *
 * Sem dubles: `state.ts` so importa TIPOS de @aether/shared, entao o estado
 * real do gateway roda aqui como roda em producao. Nao ha banco envolvido —
 * presenca e voz vivem em memoria de proposito.
 *
 * O que importa testar nao e o formato da data, e as duas regras que decidem
 * quando o relogio zera: trocar de canal reinicia, reconectar no mesmo canal
 * preserva. A segunda existe porque uma queda de rede chama `joinVoice` de
 * novo — e zerar ali faria o tempo da pessoa voltar do zero por causa de um
 * soluco de conexao que ela nem viu.
 */

const user: PublicUser = {
  id: "usuario-1",
  username: "ryan",
  displayName: "Ryan",
  avatarUrl: null,
  status: "ONLINE",
};

/** Cada teste comeca sem ninguem em voz — o estado do modulo e global. */
beforeEach(() => {
  leaveVoice(user.id);
  vi.useRealTimers();
});

describe("joinedAt no estado de voz", () => {
  it("carimba a entrada com a hora do SERVIDOR", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T10:00:00.000Z"));

    joinVoice({
      socketId: "socket-1",
      userId: user.id,
      user,
      serverId: "servidor-1",
      channelId: "canal-a",
    });

    expect(voiceParticipant(user.id)?.joinedAt).toBe(
      "2026-08-22T10:00:00.000Z",
    );
  });

  it("REINICIA a contagem ao trocar de canal", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T10:00:00.000Z"));
    joinVoice({
      socketId: "socket-1",
      userId: user.id,
      user,
      serverId: "servidor-1",
      channelId: "canal-a",
    });

    vi.setSystemTime(new Date("2026-08-22T10:30:00.000Z"));
    joinVoice({
      socketId: "socket-1",
      userId: user.id,
      user,
      serverId: "servidor-1",
      channelId: "canal-b",
    });

    // A atividade e "estar NESTE canal", nao "estar em voz em algum lugar".
    expect(voiceParticipant(user.id)?.joinedAt).toBe(
      "2026-08-22T10:30:00.000Z",
    );
  });

  it("PRESERVA a contagem quando o mesmo canal e reentrado (reconexao)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T10:00:00.000Z"));
    joinVoice({
      socketId: "socket-1",
      userId: user.id,
      user,
      serverId: "servidor-1",
      channelId: "canal-a",
    });

    // Socket novo, mesmo canal: e o que uma queda de rede produz.
    vi.setSystemTime(new Date("2026-08-22T10:30:00.000Z"));
    joinVoice({
      socketId: "socket-2",
      userId: user.id,
      user,
      serverId: "servidor-1",
      channelId: "canal-a",
    });

    expect(voiceParticipant(user.id)?.joinedAt).toBe(
      "2026-08-22T10:00:00.000Z",
    );
  });

  it("some junto com a pessoa quando ela sai da voz", () => {
    joinVoice({
      socketId: "socket-1",
      userId: user.id,
      user,
      serverId: "servidor-1",
      channelId: "canal-a",
    });
    leaveVoice(user.id);

    expect(voiceParticipant(user.id)).toBeNull();
  });
});
