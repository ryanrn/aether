/**
 * Registro de jogos. E aqui que se "adiciona um jogo" ao sistema.
 *
 * Um jogo = um place do Roblox + uma chave + a conta do TikTok que o alimenta.
 * Varios jogos podem ouvir a MESMA live (util para testar uma versao nova sem
 * derrubar a que esta no ar) e a mesma ponte pode servir lives diferentes.
 *
 * O arquivo recarrega sozinho quando salvo. Nao e luxo: reiniciar o processo
 * derruba a conexao com o TikTok, e reconectar durante a live tem limite de
 * taxa do lado deles. Trocar uma chave nao pode custar a live inteira.
 */
import { readFileSync, watch } from "node:fs";
import { resolve } from "node:path";
import { timingSafeEqual } from "node:crypto";
import type { GameConfig } from "./types.ts";
import { profileExists } from "./commands.ts";

const MIN_KEY_LENGTH = 12;

function parseGame(raw: unknown, index: number): GameConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`games[${index}] nao e um objeto`);
  }
  const value = raw as Record<string, unknown>;
  const id = String(value.id ?? "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)) {
    // O id vai na URL. Restringir aqui evita ter que escapar em todo lugar.
    throw new Error(`games[${index}].id invalido: use a-z, 0-9, "-" e "_" (ate 32)`);
  }
  const key = String(value.key ?? "");
  if (key.length < MIN_KEY_LENGTH) {
    throw new Error(`games[${index}].key curta demais (minimo ${MIN_KEY_LENGTH} caracteres)`);
  }
  if (/TROQUE/i.test(key)) {
    throw new Error(`games[${index}].key ainda e a do exemplo — gere uma de verdade`);
  }
  const tiktok = String(value.tiktok ?? "").trim().replace(/^@/, "");
  if (tiktok === "") throw new Error(`games[${index}].tiktok vazio`);

  const profile = String(value.profile ?? "default");
  if (!profileExists(profile)) throw new Error(`games[${index}].profile "${profile}" nao existe`);

  return {
    id,
    name: String(value.name ?? id),
    key,
    tiktok,
    profile,
    spawnOnAnyComment: value.spawnOnAnyComment !== false,
    universeId: value.universeId == null ? null : String(value.universeId),
  };
}

function parseFile(contents: string): Map<string, GameConfig> {
  const parsed = JSON.parse(contents) as { games?: unknown };
  if (!Array.isArray(parsed.games)) throw new Error('arquivo sem a lista "games"');
  const games = new Map<string, GameConfig>();
  parsed.games.forEach((raw, index) => {
    const game = parseGame(raw, index);
    if (games.has(game.id)) throw new Error(`id "${game.id}" repetido`);
    games.set(game.id, game);
  });
  if (games.size === 0) throw new Error("nenhum jogo cadastrado");
  return games;
}

export interface GameRegistry {
  list(): GameConfig[];
  get(id: string): GameConfig | null;
  /**
   * Confere a chave em tempo constante.
   *
   * Devolve `null` tanto para jogo inexistente quanto para chave errada, e quem
   * chama responde 404 nos dois casos — a mesma regra do resto do projeto: nao
   * confirmamos a existencia de um recurso para quem nao tem acesso a ele.
   */
  authenticate(id: string, key: string | null): GameConfig | null;
  /** Chamado a cada recarga bem-sucedida do arquivo. */
  onChange(listener: (games: GameConfig[]) => void): void;
  stop(): void;
}

export function loadGames(path: string): GameRegistry {
  const file = resolve(path);
  let games: Map<string, GameConfig>;

  try {
    games = parseFile(readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `nao consegui ler ${file}: ${reason}\n` +
        "Copie games.example.json para games.json e edite (veja o README).",
    );
  }

  const listeners: Array<(games: GameConfig[]) => void> = [];
  let reloadTimer: NodeJS.Timeout | null = null;

  /**
   * Editor de texto costuma salvar em duas etapas (trunca e escreve), e o
   * `watch` dispara nas duas. Sem o atraso, a primeira leitura pega o arquivo
   * pela metade e a recarga falha com JSON invalido em toda gravacao.
   */
  const watcher = watch(file, () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      try {
        games = parseFile(readFileSync(file, "utf8"));
        console.log(`[jogos] recarregado: ${[...games.keys()].join(", ")}`);
        for (const listener of listeners) listener([...games.values()]);
      } catch (error) {
        // Arquivo quebrado NAO derruba a ponte: fica valendo a versao anterior.
        console.error(
          `[jogos] arquivo invalido, mantendo a configuracao anterior: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }, 250);
    reloadTimer.unref?.();
  });
  watcher.unref?.();

  return {
    list: () => [...games.values()],
    get: (id) => games.get(id) ?? null,

    authenticate(id, key) {
      const game = games.get(id);
      if (!game || key === null) return null;
      const expected = Buffer.from(game.key);
      const received = Buffer.from(key);
      // `timingSafeEqual` exige tamanhos iguais; comparar o tamanho antes ja
      // vaza o tamanho da chave, e tamanho de chave nao e segredo.
      if (expected.length !== received.length) return null;
      return timingSafeEqual(expected, received) ? game : null;
    },

    onChange(listener) {
      listeners.push(listener);
    },

    stop() {
      if (reloadTimer) clearTimeout(reloadTimer);
      watcher.close();
    },
  };
}
