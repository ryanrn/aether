import { prisma } from "@aether/db";
import { getChannelPermissions, loadMemberAccess } from "@aether/access";
import {
  has,
  mencoesPedidas,
  nomesDigitados,
  trocarNomesPorMarcadores,
  MENCOES_MAX,
} from "@aether/shared";
import type { Conversa } from "./enviar-mensagem";

/**
 * Decide quais mencoes de uma mensagem VALEM (P1-2). O texto so pede; quem
 * decide e esta funcao, com as mesmas regras de permissao do resto do chat.
 *
 *  - `@pessoa`: so quem ENXERGA a conversa. Mencionar alguem de fora deixa o
 *    texto como esta e nao avisa ninguem — avisar contaria a essa pessoa que
 *    a conversa existe.
 *  - `@everyone` e `@cargo`: so com MENTION_EVERYONE no canal (o bit existia
 *    sem efeito desde a fase 2). Em conversa direta nao existem.
 *
 * `@nome` digitado a mao vira marcador (`<@id>`) aqui, so para quem passou na
 * regra acima: nome que nao valeu continua texto, igual ao que foi digitado.
 */

export interface MencoesResolvidas {
  /** O texto com `@nome` trocado pelos marcadores validos. */
  content: string;
  usuarios: string[];
  cargos: string[];
  todos: boolean;
}

/** `@nome` -> pessoa. So humanos e bots: webhook nao e mencionavel. */
async function buscarPorNome(nomes: string[]) {
  if (nomes.length === 0) return [];
  return prisma.user.findMany({
    where: {
      username: { in: nomes, mode: "insensitive" },
      kind: { in: ["HUMAN", "BOT"] },
    },
    select: { id: true, username: true },
    take: MENCOES_MAX,
  });
}

export async function resolverMencoes(
  autorId: string,
  conversa: Conversa,
  texto: string,
): Promise<MencoesResolvidas> {
  const porNome = await buscarPorNome(nomesDigitados(texto));
  const pedidas = mencoesPedidas(texto);
  const candidatos = [
    ...new Set([...pedidas.usuarios, ...porNome.map((u) => u.id)]),
  ].slice(0, MENCOES_MAX);

  let usuarios: string[];
  let cargos: string[] = [];
  let todos = false;

  if (conversa.tipo === "dm") {
    // Numa conversa direta so ha duas pessoas para chamar.
    const pessoas = new Set([autorId, conversa.outroId]);
    usuarios = candidatos.filter((id) => pessoas.has(id));
  } else {
    const { serverId, channelId } = conversa;

    // Cada pessoa passa pela mesma porta que decide se ela VE o canal.
    const enxerga = await Promise.all(
      candidatos.map(async (id) => {
        const acesso = await loadMemberAccess(serverId, id);
        if (!acesso) return false;
        const bits = await getChannelPermissions(acesso, channelId);
        return bits !== null && has(bits, "VIEW_CHANNEL");
      }),
    );
    usuarios = candidatos.filter((_, i) => enxerga[i]);

    if (pedidas.todos || pedidas.cargos.length > 0) {
      const acessoDoAutor = await loadMemberAccess(serverId, autorId);
      const bits = acessoDoAutor
        ? await getChannelPermissions(acessoDoAutor, channelId)
        : null;
      const podeChamarTodos = bits !== null && has(bits, "MENTION_EVERYONE");

      if (podeChamarTodos) {
        todos = pedidas.todos;
        const vagas = Math.max(0, MENCOES_MAX - usuarios.length);
        if (pedidas.cargos.length > 0 && vagas > 0) {
          // So cargo DESTE servidor; o cargo padrao e o proprio @everyone.
          const validos = await prisma.role.findMany({
            where: { id: { in: pedidas.cargos }, serverId, isDefault: false },
            select: { id: true },
            take: vagas,
          });
          cargos = validos.map((c) => c.id);
        }
      }
    }
  }

  const validos = new Set(usuarios);
  const idPorNome: Record<string, string> = {};
  for (const u of porNome) {
    if (validos.has(u.id)) idPorNome[u.username.toLowerCase()] = u.id;
  }

  return {
    content: trocarNomesPorMarcadores(texto, idPorNome),
    usuarios,
    cargos,
    todos,
  };
}
