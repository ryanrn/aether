import { Prisma, prisma } from "@aether/db";
import { loadDmList, ordenarPar, podeFalarCom } from "@aether/access";
import {
  SELECT_USUARIO_PUBLICO,
  toPublicUser,
  type DmResumo,
} from "@aether/shared";
import { log } from "@aether/shared/log";
import type { AetherSocket } from "../types";
import { createRateLimiter } from "../rate-limit";

/**
 * Conversas diretas: abrir e listar.
 *
 * Mandar e ler mensagem NAO passa por aqui — isso e `message:send` e
 * `message:history` em `messages.ts`, os mesmos eventos do chat de servidor.
 * Foi o ponto do desenho: uma conversa direta e so mais um lugar onde uma
 * mensagem pode viver, entao ela reusa o caminho de mensagem inteiro em vez de
 * ganhar um paralelo que precisaria receber cada correcao duas vezes.
 */

/**
 * Abrir conversa escreve no banco, entao precisa de limite.
 *
 * 10 de rajada cobre o app listando e abrindo ao iniciar; 1 por segundo em
 * regime e folgado — abrir conversa e coisa de clique, nao de laco.
 */
const dmLimiter = createRateLimiter({ capacity: 10, refillPerSecond: 1 });

/**
 * Encontra a conversa do par, criando se ainda nao houver.
 *
 * NAO usa `upsert`: tentar criar e tratar a colisao e o que torna isto correto
 * sob concorrencia de verdade. Se os dois lados clicarem em "conversar" no
 * mesmo instante, os dois chegam aqui sem linha nenhuma no banco e os dois
 * tentam criar — o indice unico sobre o par ORDENADO deixa so um passar, e o
 * outro cai no `P2002` e le a linha que acabou de nascer. Uma checagem
 * "existe? senao cria" perderia essa corrida em silencio, criando duas
 * conversas para as mesmas duas pessoas.
 */
async function encontrarOuCriar(a: string, b: string): Promise<string> {
  const [userAId, userBId] = ordenarPar(a, b);

  try {
    const criada = await prisma.dmChannel.create({
      data: { userAId, userBId },
      select: { id: true },
    });
    return criada.id;
  } catch (erro) {
    const jaExiste =
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === "P2002";
    if (!jaExiste) throw erro;

    const existente = await prisma.dmChannel.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
      select: { id: true },
    });
    // So chega aqui se a linha existe: o P2002 veio dela.
    if (!existente) throw erro;
    return existente.id;
  }
}

export function registerDmHandlers(socket: AetherSocket): void {
  const { userId } = socket.data;

  socket.on("dm:open", async (payload, ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;

    const outroId = payload?.userId;
    if (typeof outroId !== "string" || outroId.length === 0) {
      respond({ ok: false, error: "Usuario invalido" });
      return;
    }

    if (!dmLimiter.take(userId)) {
      respond({ ok: false, error: "Espere um instante." });
      return;
    }

    try {
      /**
       * Duas portas: amizade, ou servidor em comum com a chave do OUTRO
       * ligada. `podeFalarCom` ja devolve `null` quando os dois ids sao
       * iguais, entao conversa consigo mesmo cai aqui — antes de o CHECK do
       * banco precisar entrar em acao.
       */
      const motivo = await podeFalarCom(userId, outroId);

      const outro = await prisma.user.findUnique({
        where: { id: outroId },
        select: SELECT_USUARIO_PUBLICO,
      });

      if (motivo === null) {
        /**
         * A RECUSA DIZ O QUE ACONTECEU quando a pessoa existe.
         *
         * Some em silencio seria pior: quem manda acharia que foi entregue e
         * que esta sendo ignorado. Dizer "nao aceita mensagens de quem nao e
         * amigo" da o proximo passo — mandar pedido de amizade.
         *
         * Isso REVELA que a pessoa desligou a chave, e e uma troca aceita: a
         * alternativa (esconder) confunde mais do que protege, porque a
         * configuracao nao e um segredo, e uma preferencia de contato.
         *
         * Quem NAO existe continua indistinguivel de quem nao aceita — a
         * mensagem generica so aparece quando nao ha usuario.
         */
        respond({
          ok: false,
          error: outro
            ? "Esta pessoa so aceita mensagens de amigos. Envie um pedido de amizade."
            : "Usuario nao encontrado",
        });
        return;
      }

      if (!outro) {
        respond({ ok: false, error: "Usuario nao encontrado" });
        return;
      }

      const id = await encontrarOuCriar(userId, outroId);
      respond({ ok: true, dm: { id, outro: toPublicUser(outro) } });
    } catch (error) {
      log.error("gateway.dm.open", "dm:open falhou", {
        err: error,
        userId,
        socketId: socket.id,
      });
      respond({ ok: false, error: "Falha ao abrir conversa" });
    }
  });

  socket.on("dm:list", async (ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;

    if (!dmLimiter.take(userId)) {
      respond({ ok: false, error: "Espere um instante." });
      return;
    }

    try {
      const itens = await loadDmList(userId);
      if (itens.length === 0) {
        respond({ ok: true, conversas: [] });
        return;
      }

      const usuarios = await prisma.user.findMany({
        where: { id: { in: itens.map((item) => item.outroId) } },
        select: SELECT_USUARIO_PUBLICO,
      });
      const porId = new Map(usuarios.map((u) => [u.id, u]));

      const conversas: DmResumo[] = [];
      for (const item of itens) {
        const outro = porId.get(item.outroId);
        if (outro) conversas.push({ id: item.dmId, outro: toPublicUser(outro) });
      }

      respond({ ok: true, conversas });
    } catch (error) {
      log.error("gateway.dm.list", "dm:list falhou", {
        err: error,
        userId,
        socketId: socket.id,
      });
      respond({ ok: false, error: "Falha ao listar conversas" });
    }
  });
}
