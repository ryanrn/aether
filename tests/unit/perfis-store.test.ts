import type { PublicUser } from "@aether/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { comPerfilAoVivo, usePerfisStore } from "@/lib/stores/perfis-store";

/**
 * O perfil ao vivo (`user:profile`). O que estes testes travam: a versao nova
 * so troca os campos de PERFIL — `status` e `plano` continuam os de quem
 * desenha —, e sem mudanca o objeto original volta intacto (sem quebrar memo).
 */

const base = {
  id: "u1",
  username: "ana",
  displayName: "Ana",
  avatarUrl: "https://x.test/velha.png",
  status: "ONLINE",
  kind: "HUMAN",
  plano: "FREE",
  moldura: null,
  decoracao: null,
  placa: null,
} as unknown as PublicUser;

describe("perfis-store", () => {
  beforeEach(() => usePerfisStore.setState({ porUsuario: {} }));

  it("guarda so os campos de perfil do evento", () => {
    usePerfisStore.getState().atualizar({
      ...base,
      displayName: "Ana Nova",
      avatarUrl: "https://x.test/nova.png",
      status: "OFFLINE",
    } as PublicUser);
    expect(usePerfisStore.getState().porUsuario.u1).toEqual({
      displayName: "Ana Nova",
      avatarUrl: "https://x.test/nova.png",
      moldura: null,
      decoracao: null,
      placa: null,
    });
  });

  it("aplica o perfil novo por cima sem trocar status", () => {
    usePerfisStore.getState().atualizar({
      ...base,
      displayName: "Ana Nova",
      avatarUrl: null,
      status: "OFFLINE",
    } as PublicUser);
    const aoVivo = usePerfisStore.getState().porUsuario.u1 ?? null;
    const final = comPerfilAoVivo(base, aoVivo);
    expect(final.displayName).toBe("Ana Nova");
    expect(final.avatarUrl).toBeNull();
    expect(final.status).toBe("ONLINE");
  });

  it("sem mudanca devolve o mesmo objeto", () => {
    expect(comPerfilAoVivo(base, null)).toBe(base);
  });

  it("a mudanca mais recente vence", () => {
    const { atualizar } = usePerfisStore.getState();
    atualizar({ ...base, displayName: "Um" } as PublicUser);
    atualizar({ ...base, displayName: "Dois" } as PublicUser);
    expect(usePerfisStore.getState().porUsuario.u1?.displayName).toBe("Dois");
  });
});
