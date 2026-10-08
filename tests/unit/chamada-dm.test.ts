import { describe, expect, it } from "vitest";
import type { MediaGrant, PublicUser } from "@aether/shared";
import {
  aoAtenderem,
  aoEncerrar,
  motivoAoEncerrar,
  reagirAChamada,
  type ChamadaDm,
} from "@/lib/voice/chamada-dm";

/**
 * Maquina de estados da chamada em conversa direta (apps/web/src/lib/voice/
 * chamada-dm.ts). O gateway nao guarda chamada — estas decisoes sao a UNICA
 * coisa que impede, por exemplo, uma aba de recusar a ligacao que outra aba
 * acabou de atender.
 */

const EU = "u-eu";
const OUTRO = "u-outro";

const outro = {
  id: OUTRO,
  username: "joao",
  displayName: "Joao",
} as PublicUser;

const media = { url: "wss://sfu", token: "t" } as MediaGrant;

const chamando: ChamadaDm = {
  fase: "chamando",
  dmId: "dm1",
  outro,
  media,
  desde: 0,
};
const recebendo: ChamadaDm = { fase: "recebendo", dmId: "dm1", outro, desde: 0 };
const emChamada: ChamadaDm = { ...chamando, fase: "em_chamada" };

describe("reagirAChamada", () => {
  it("linha livre: toca", () => {
    expect(reagirAChamada(null, "dm1")).toBe("tocar");
  });

  it("os dois ligaram ao mesmo tempo: atende na hora, sem tocar", () => {
    expect(reagirAChamada(chamando, "dm1")).toBe("atender");
  });

  it("ja em chamada com a mesma pessoa e ela religou (recarregou a aba): atende", () => {
    expect(reagirAChamada(emChamada, "dm1")).toBe("atender");
  });

  it("em chamada com OUTRA conversa: ocupado", () => {
    expect(reagirAChamada(emChamada, "dm2")).toBe("ocupado");
    expect(reagirAChamada(recebendo, "dm2")).toBe("ocupado");
  });

  it("aviso repetido do que ja esta tocando: ignora", () => {
    expect(reagirAChamada(recebendo, "dm1")).toBe("ignorar");
  });
});

describe("aoAtenderem", () => {
  it("quem ligou passa a em_chamada quando o OUTRO atende, mantendo o token do ring", () => {
    const proximo = aoAtenderem(chamando, { dmId: "dm1", por: OUTRO }, EU);
    expect(proximo?.fase).toBe("em_chamada");
    expect(proximo && "media" in proximo ? proximo.media : null).toBe(media);
  });

  it("outra aba minha atendeu: esta para de tocar", () => {
    expect(aoAtenderem(recebendo, { dmId: "dm1", por: EU }, EU)).toBeNull();
  });

  it("eco do proprio aceite nao muda nada", () => {
    expect(aoAtenderem(emChamada, { dmId: "dm1", por: EU }, EU)).toBe(emChamada);
  });

  it("aviso de outra conversa nao mexe na chamada atual", () => {
    expect(aoAtenderem(chamando, { dmId: "dm2", por: OUTRO }, EU)).toBe(chamando);
  });
});

describe("aoEncerrar", () => {
  it("o outro recusou: limpa e explica", () => {
    const fim = aoEncerrar(chamando, { dmId: "dm1", por: OUTRO, motivo: "recusada" }, EU);
    expect(fim.proximo).toBeNull();
    expect(fim.aviso).toBe("Joao recusou a chamada.");
  });

  it("quem ligou desistiu: chamada perdida para quem recebia", () => {
    const fim = aoEncerrar(recebendo, { dmId: "dm1", por: OUTRO, motivo: "cancelada" }, EU);
    expect(fim.proximo).toBeNull();
    expect(fim.aviso).toBe("Chamada perdida de Joao.");
  });

  it("fui eu (noutra aba): limpa sem aviso", () => {
    const fim = aoEncerrar(recebendo, { dmId: "dm1", por: EU, motivo: "recusada" }, EU);
    expect(fim).toEqual({ proximo: null, aviso: null });
  });

  it("recusa 'ocupado' de OUTRA ligacao nao derruba a chamada atual", () => {
    const fim = aoEncerrar(emChamada, { dmId: "dm2", por: EU, motivo: "ocupado" }, EU);
    expect(fim.proximo).toBe(emChamada);
  });
});

describe("motivoAoEncerrar", () => {
  it("um botao so; o nome do motivo vem da fase", () => {
    expect(motivoAoEncerrar(chamando)).toBe("cancelada");
    expect(motivoAoEncerrar(recebendo)).toBe("recusada");
    expect(motivoAoEncerrar(emChamada)).toBe("encerrada");
  });
});
