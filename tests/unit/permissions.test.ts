import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_TEMPLATES,
  Permission,
  applyOverwrites,
  combine,
  has,
  hasAll,
  toKeys,
  type PermissionKey,
} from "@aether/shared";

/**
 * O bitfield e a base de toda decisao de acesso do projeto. Um bug aqui nao
 * aparece como tela errada: aparece como alguem entrando onde nao devia.
 *
 * Os verify-phase*.mjs exercitam isso de ponta a ponta, mas so pelos caminhos
 * que o cenario de seed produz. Aqui as combinacoes sao escolhidas.
 */

const NON_ADMIN_KEYS = (Object.keys(Permission) as PermissionKey[]).filter(
  (key) => key !== "ADMINISTRATOR",
);

describe("bitfield", () => {
  it("nao repete bit entre permissoes", () => {
    /**
     * Regressao para o erro mais silencioso possivel neste arquivo: duas
     * permissoes declaradas com o mesmo deslocamento viram a MESMA permissao,
     * e conceder uma passa a conceder a outra. Nada no typecheck pega isso.
     */
    const bits = Object.values(Permission);
    expect(new Set(bits).size).toBe(bits.length);
  });

  it("ALL_PERMISSIONS contem todas as flags declaradas", () => {
    expect(toKeys(ALL_PERMISSIONS).sort()).toEqual(
      (Object.keys(Permission) as PermissionKey[]).sort(),
    );
  });

  it("bitfield vazio nao concede nada", () => {
    for (const key of Object.keys(Permission) as PermissionKey[]) {
      expect(has(0n, key)).toBe(false);
    }
  });

  it("ADMINISTRATOR satisfaz qualquer checagem, inclusive as que nao possui", () => {
    const admin = Permission.ADMINISTRATOR;
    for (const key of NON_ADMIN_KEYS) {
      expect(has(admin, key)).toBe(true);
    }
    expect(hasAll(admin, NON_ADMIN_KEYS)).toBe(true);
  });

  it("combine e toKeys sao inversos", () => {
    const keys: PermissionKey[] = ["VIEW_CHANNEL", "SEND_MESSAGES", "CONNECT"];
    expect(toKeys(combine(...keys)).sort()).toEqual([...keys].sort());
  });

  it("hasAll exige todas — uma faltando reprova", () => {
    const bits = combine("VIEW_CHANNEL", "SEND_MESSAGES");
    expect(hasAll(bits, ["VIEW_CHANNEL", "SEND_MESSAGES"])).toBe(true);
    expect(hasAll(bits, ["VIEW_CHANNEL", "BAN_MEMBERS"])).toBe(false);
  });
});

describe("applyOverwrites", () => {
  const base = combine("VIEW_CHANNEL", "SEND_MESSAGES", "CONNECT");

  it("sem overwrite, devolve a base intacta", () => {
    expect(applyOverwrites(base, [])).toBe(base);
  });

  it("deny de cargo remove a permissao", () => {
    const result = applyOverwrites(base, [
      { allow: 0n, deny: Permission.SEND_MESSAGES },
    ]);
    expect(has(result, "SEND_MESSAGES")).toBe(false);
    expect(has(result, "VIEW_CHANNEL")).toBe(true);
  });

  it("allow de cargo concede permissao ausente da base", () => {
    const result = applyOverwrites(base, [
      { allow: Permission.SCREEN_SHARE, deny: 0n },
    ]);
    expect(has(result, "SCREEN_SHARE")).toBe(true);
  });

  it("entre cargos, allow vence deny", () => {
    /**
     * Ordem documentada: base -> deny dos cargos -> allow dos cargos. Quem tem
     * dois cargos, um negando e outro liberando, fica com a liberacao.
     */
    const result = applyOverwrites(base, [
      { allow: 0n, deny: Permission.SEND_MESSAGES },
      { allow: Permission.SEND_MESSAGES, deny: 0n },
    ]);
    expect(has(result, "SEND_MESSAGES")).toBe(true);
  });

  it("deny individual vence allow de cargo", () => {
    const result = applyOverwrites(
      base,
      [{ allow: Permission.SCREEN_SHARE, deny: 0n }],
      { allow: 0n, deny: Permission.SCREEN_SHARE },
    );
    expect(has(result, "SCREEN_SHARE")).toBe(false);
  });

  it("allow individual vence deny individual", () => {
    const result = applyOverwrites(base, [], {
      allow: Permission.SCREEN_SHARE,
      deny: Permission.SCREEN_SHARE,
    });
    expect(has(result, "SCREEN_SHARE")).toBe(true);
  });

  it("ADMINISTRATOR ignora ate um deny de tudo", () => {
    /**
     * Um overwrite de canal nao pode trancar um administrador para fora. Se
     * pudesse, daria para criar um canal que o dono do servidor nao enxerga.
     */
    const admin = base | Permission.ADMINISTRATOR;
    const result = applyOverwrites(
      admin,
      [{ allow: 0n, deny: ALL_PERMISSIONS }],
      { allow: 0n, deny: ALL_PERMISSIONS },
    );
    expect(result).toBe(ALL_PERMISSIONS);
  });

  it("nunca concede bit que nao veio da base nem de um allow", () => {
    /**
     * Propriedade geral, e nao um caso: o resultado tem de ser subconjunto de
     * (base | allows). Inventar bit aqui seria escalada de privilegio.
     */
    const roleOverwrites = [
      { allow: Permission.SCREEN_SHARE, deny: Permission.CONNECT },
      { allow: Permission.CREATE_INVITE, deny: Permission.VIEW_CHANNEL },
    ];
    const memberOverwrite = {
      allow: Permission.MOVE_MEMBERS,
      deny: Permission.SEND_MESSAGES,
    };
    const permitted =
      base |
      Permission.SCREEN_SHARE |
      Permission.CREATE_INVITE |
      Permission.MOVE_MEMBERS;

    const result = applyOverwrites(base, roleOverwrites, memberOverwrite);
    expect(result & ~permitted).toBe(0n);
  });

  it("deny de permissao que o membro nao tem e inofensivo", () => {
    const result = applyOverwrites(base, [
      { allow: 0n, deny: Permission.BAN_MEMBERS },
    ]);
    expect(result).toBe(base);
  });
});

describe("cargos padrao", () => {
  it("so o Owner carrega todas as permissoes", () => {
    const withEverything = DEFAULT_ROLE_TEMPLATES.filter(
      (role) => role.permissions === ALL_PERMISSIONS,
    );
    expect(withEverything.map((role) => role.name)).toEqual(["Owner"]);
  });

  it("nenhum cargo padrao abaixo do Owner recebe ADMINISTRATOR", () => {
    /**
     * O template de Administrator lista as permissoes uma a uma DE PROPOSITO.
     * Trocar isso por ADMINISTRATOR faria o cargo furar overwrite de canal e
     * ignorar a hierarquia — mudanca grande, disfarcada de simplificacao.
     */
    for (const role of DEFAULT_ROLE_TEMPLATES) {
      if (role.isOwner) continue;
      expect(has(role.permissions, "ADMINISTRATOR")).toBe(false);
    }
  });

  it("a hierarquia dos templates e estritamente decrescente", () => {
    const positions = DEFAULT_ROLE_TEMPLATES.map((role) => role.position);
    const sorted = [...positions].sort((a, b) => b - a);
    expect(positions).toEqual(sorted);
    expect(new Set(positions).size).toBe(positions.length);
  });
});
