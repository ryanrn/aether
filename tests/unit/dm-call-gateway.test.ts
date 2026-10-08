import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Handler `dmcall:*` do gateway (apps/realtime/src/handlers/dm-call.ts).
 *
 * O que importa travar: token de midia SO sai depois de `loadDmAccess` (a
 * mesma regra das mensagens), recusa de acesso e indistinguivel de conversa
 * inexistente, e DESLIGAR funciona mesmo quando a porta ja fechou (bloqueio no
 * meio da chamada) — porque usa `participanteDaDm`, nao `loadDmAccess`.
 */

const userFindUnique = vi.fn();
vi.mock("@aether/db", () => ({
  prisma: { user: { findUnique: userFindUnique } },
}));

const flagLigada = vi.fn();
const loadDmAccess = vi.fn();
const participanteDaDm = vi.fn();
const loadPlan = vi.fn();
vi.mock("@aether/access", () => ({ flagLigada, loadDmAccess, participanteDaDm, loadPlan }));

const createDmCallCredentials = vi.fn();
const conferirQualidadeDaTela = vi.fn();
vi.mock("../../apps/realtime/src/livekit", () => ({
  createDmCallCredentials,
  conferirQualidadeDaTela,
  dmRoomName: (dmId: string) => `dm:${dmId}`,
}));

const { registerDmCallHandlers } = await import(
  "../../apps/realtime/src/handlers/dm-call"
);

type Handler = (...args: unknown[]) => unknown;

let contador = 0;
function montar() {
  contador += 1;
  // userId novo a cada teste: o rate limiter e de modulo e lembraria do anterior.
  const userId = `u-eu-${contador}`;
  const emits: Array<{ salas: string | string[]; evento: string; payload: unknown }> = [];
  const handlers = new Map<string, Handler>();
  const io = {
    to: (salas: string | string[]) => ({
      emit: (evento: string, payload: unknown) => emits.push({ salas, evento, payload }),
    }),
  };
  const socket = {
    id: "s1",
    data: { userId, user: { displayName: "Eu" } },
    on: (evento: string, fn: Handler) => handlers.set(evento, fn),
    emit: (evento: string, payload: unknown) =>
      emits.push({ salas: "socket", evento, payload }),
  };
  registerDmCallHandlers(io as never, socket as never);

  async function chamar(evento: string, payload: unknown) {
    let resposta: unknown;
    await handlers.get(evento)!(payload, (r: unknown) => {
      resposta = r;
    });
    return resposta as { ok: boolean; error?: string; media?: unknown };
  }
  return { userId, emits, chamar };
}

const MEDIA = { url: "wss://sfu", token: "jwt" };

beforeEach(() => {
  vi.clearAllMocks();
  flagLigada.mockResolvedValue(true);
  createDmCallCredentials.mockResolvedValue(MEDIA);
  userFindUnique.mockResolvedValue({
    id: "u-eu",
    username: "eu",
    displayName: "Eu",
    avatarUrl: null,
    status: "ONLINE",
  });
});

describe("dmcall:ring", () => {
  it("com acesso: devolve o token e toca na sala pessoal do outro", async () => {
    const { emits, chamar } = montar();
    loadDmAccess.mockResolvedValue({ dmId: "dm1", outroId: "u-outro" });

    const r = await chamar("dmcall:ring", { dmId: "dm1" });

    expect(r).toEqual({ ok: true, media: MEDIA });
    expect(emits).toHaveLength(1);
    expect(emits[0]).toMatchObject({ salas: "user:u-outro", evento: "dmcall:incoming" });
    expect((emits[0]!.payload as { dmId: string }).dmId).toBe("dm1");
  });

  it("sem acesso (bloqueio, conversa alheia): 'nao encontrada', sem token e sem tocar", async () => {
    const { emits, chamar } = montar();
    loadDmAccess.mockResolvedValue(null);

    const r = await chamar("dmcall:ring", { dmId: "dm1" });

    expect(r).toEqual({ ok: false, error: "Conversa nao encontrada" });
    expect(createDmCallCredentials).not.toHaveBeenCalled();
    expect(emits).toHaveLength(0);
  });

  it("kill switch de voz desligado: recusa antes de consultar acesso", async () => {
    const { chamar } = montar();
    flagLigada.mockResolvedValue(false);

    const r = await chamar("dmcall:ring", { dmId: "dm1" });

    expect(r.ok).toBe(false);
    expect(loadDmAccess).not.toHaveBeenCalled();
  });

  it("sem SFU configurado: nao toca o telefone do outro para uma chamada muda", async () => {
    const { emits, chamar } = montar();
    loadDmAccess.mockResolvedValue({ dmId: "dm1", outroId: "u-outro" });
    createDmCallCredentials.mockResolvedValue(null);

    const r = await chamar("dmcall:ring", { dmId: "dm1" });

    expect(r.ok).toBe(false);
    expect(emits).toHaveLength(0);
  });
});

describe("dmcall:accept", () => {
  it("avisa os DOIS lados (quem ligou e as outras abas de quem atendeu)", async () => {
    const { userId, emits, chamar } = montar();
    loadDmAccess.mockResolvedValue({ dmId: "dm1", outroId: "u-outro" });

    const r = await chamar("dmcall:accept", { dmId: "dm1" });

    expect(r).toEqual({ ok: true, media: MEDIA });
    expect(emits[0]).toEqual({
      salas: [`user:${userId}`, "user:u-outro"],
      evento: "dmcall:accepted",
      payload: { dmId: "dm1", por: userId },
    });
  });
});

describe("dmcall:end", () => {
  it("desliga mesmo depois de a porta fechar (usa participanteDaDm, nao loadDmAccess)", async () => {
    const { userId, emits, chamar } = montar();
    loadDmAccess.mockResolvedValue(null);
    participanteDaDm.mockResolvedValue({ dmId: "dm1", outroId: "u-outro" });

    await chamar("dmcall:end", { dmId: "dm1", motivo: "encerrada" });

    expect(loadDmAccess).not.toHaveBeenCalled();
    expect(emits[0]).toEqual({
      salas: [`user:${userId}`, "user:u-outro"],
      evento: "dmcall:ended",
      payload: { dmId: "dm1", por: userId, motivo: "encerrada" },
    });
  });

  it("quem nao e participante nao consegue mandar aviso a ninguem", async () => {
    const { emits, chamar } = montar();
    participanteDaDm.mockResolvedValue(null);

    await chamar("dmcall:end", { dmId: "dm-alheia", motivo: "encerrada" });

    expect(emits).toHaveLength(0);
  });

  it("motivo inventado e descartado antes do banco", async () => {
    const { emits, chamar } = montar();

    await chamar("dmcall:end", { dmId: "dm1", motivo: "<script>" });

    expect(participanteDaDm).not.toHaveBeenCalled();
    expect(emits).toHaveLength(0);
  });
});

describe("dmcall:tela", () => {
  it("confere a tela contra o plano na sala da conversa e avisa quem excedeu", async () => {
    vi.useFakeTimers();
    try {
      const { userId, emits, chamar } = montar();
      loadDmAccess.mockResolvedValue({ dmId: "dm1", outroId: "u-outro" });
      loadPlan.mockResolvedValue({ tier: "FREE", limites: { alturaMax: 720 } });
      conferirQualidadeDaTela.mockResolvedValue({
        alturaPublicada: 1440,
        alturaMax: 720,
        silenciada: true,
      });

      await chamar("dmcall:tela", { dmId: "dm1" });
      await vi.advanceTimersByTimeAsync(2500);

      expect(conferirQualidadeDaTela).toHaveBeenCalledWith({
        sala: "dm:dm1",
        userId,
        alturaMax: 720,
      });
      expect(emits).toContainEqual({
        salas: "socket",
        evento: "voice:qualidade-excedida",
        payload: { alturaPublicada: 1440, alturaMax: 720, plano: "FREE" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("sem acesso a conversa, nem consulta o plano", async () => {
    const { chamar } = montar();
    loadDmAccess.mockResolvedValue(null);

    await chamar("dmcall:tela", { dmId: "dm-alheia" });

    expect(loadPlan).not.toHaveBeenCalled();
    expect(conferirQualidadeDaTela).not.toHaveBeenCalled();
  });
});
