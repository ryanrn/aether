/**
 * Verificacao das CONVERSAS DIRETAS.
 *
 * Comeca pelas garantias que moram no BANCO, e nao no codigo. Elas sao o
 * alicerce do desenho, e alicerce que nunca foi empurrado e so uma suposicao:
 *
 *   - o par e ordenado (`userAId < userBId`), o que faz o indice unico
 *     impedir de verdade duas conversas para as mesmas duas pessoas;
 *   - uma mensagem tem exatamente UM pai — canal de servidor ou conversa.
 *
 * Se qualquer um destes CHECK sumir numa migracao futura, o codigo continua
 * compilando e os testes unitarios continuam passando: o estrago so aparece
 * como conversa duplicada ou mensagem orfa, meses depois. Por isso a
 * verificacao tenta INSERIR o que nao pode existir.
 *
 * Uso:
 *   npx dotenv -e .env -- node scripts/verify-dm.mjs
 */
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { io } from "socket.io-client";

const BASE = process.env.VERIFY_REALTIME_URL ?? "http://localhost:4000";
const secret = new TextEncoder().encode(process.env.AUTH_SECRET);

/** `DIRECT_URL` e a conexao sem pgbouncer. */
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

let passed = 0;
let failed = 0;

/**
 * `deveAceitar` diz o que se espera. Sem esse parametro a funcao trataria
 * qualquer excecao como sucesso — e um teste que passa quando tudo quebra e
 * pior do que teste nenhum.
 */
async function tentar(rotulo, fn, deveAceitar = false) {
  try {
    await fn();
    if (deveAceitar) {
      passed += 1;
      console.log(`  ok   aceitou: ${rotulo}`);
    } else {
      failed += 1;
      console.log(`  FALHOU aceitou o que deveria recusar: ${rotulo}`);
    }
  } catch (erro) {
    if (deveAceitar) {
      failed += 1;
      const fim = erro.message.split("\n").pop().slice(0, 90);
      console.log(`  FALHOU recusou o que deveria aceitar: ${rotulo} — ${fim}`);
    } else {
      passed += 1;
      console.log(`  ok   recusou: ${rotulo}`);
    }
  }
}

const PREFIXO = `dmv${Date.now().toString(36)}`;

const sessoesCriadas = [];

/** Cookie de sessao real, como o navegador manda. Espelha verify-phase3. */
async function cookieDeSessao(userId) {
  const sessao = await prisma.session.create({
    data: { userId, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  });
  sessoesCriadas.push(sessao.id);
  const token = await new SignJWT({ sid: sessao.id })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt()
    .setIssuer("aether")
    .setAudience("aether-app")
    .setExpirationTime("1h")
    .sign(secret);
  return `aether_session=${token}`;
}

function conectar(cookie) {
  return new Promise((resolve) => {
    const socket = io(BASE, {
      path: "/ws",
      transports: ["websocket"],
      extraHeaders: { cookie },
      reconnection: false,
      timeout: 5000,
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", () => resolve(null));
  });
}

/** Emite e espera o ack, com teto de tempo para nao pendurar a suite. */
function pedir(socket, evento, payload) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: "timeout" }), 5000);
    const feito = (r) => {
      clearTimeout(timer);
      resolve(r);
    };
    if (payload === undefined) socket.emit(evento, feito);
    else socket.emit(evento, payload, feito);
  });
}

function checar(rotulo, ok, detalhe = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${rotulo}`);
  } else {
    failed += 1;
    console.log(`  FALHOU ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

async function main() {
  console.log("\nGarantias de banco das conversas diretas\n");

  const usuarios = await prisma.user.findMany({
    take: 2,
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (usuarios.length < 2) {
    console.log("  Precisa de dois usuarios. Rode `npm run db:seed`.");
    process.exit(1);
  }
  const [menor, maior] = [usuarios[0].id, usuarios[1].id];

  const canal = await prisma.channel.findFirst({
    where: { type: "TEXT" },
    select: { id: true },
  });

  const dm = `${PREFIXO}-dm`;

  try {
    await tentar(
      "par invertido (userAId > userBId)",
      () => prisma.$executeRaw`
        INSERT INTO "DmChannel"(id,"userAId","userBId")
        VALUES (${`${PREFIXO}-inv`}, ${maior}, ${menor})`,
    );

    await tentar(
      "conversa consigo mesmo",
      () => prisma.$executeRaw`
        INSERT INTO "DmChannel"(id,"userAId","userBId")
        VALUES (${`${PREFIXO}-self`}, ${menor}, ${menor})`,
    );

    await tentar(
      "par ordenado valido",
      () => prisma.$executeRaw`
        INSERT INTO "DmChannel"(id,"userAId","userBId")
        VALUES (${dm}, ${menor}, ${maior})`,
      true,
    );

    /**
     * A duplicata so e um teste de verdade DEPOIS que a linha valida existe —
     * por isso vem aqui, e nao antes. E ela e o par ordenado de novo: e o
     * CHECK de ordem que garante que ninguem escape do unique invertendo.
     */
    await tentar(
      "segunda conversa para o mesmo par",
      () => prisma.$executeRaw`
        INSERT INTO "DmChannel"(id,"userAId","userBId")
        VALUES (${`${PREFIXO}-dup`}, ${menor}, ${maior})`,
    );

    await tentar(
      "mensagem com DOIS pais",
      () => prisma.$executeRaw`
        INSERT INTO "Message"(id,"channelId","dmChannelId","authorId",content)
        VALUES (${`${PREFIXO}-m1`}, ${canal.id}, ${dm}, ${menor}, 'oi')`,
    );

    await tentar(
      "mensagem SEM pai nenhum",
      () => prisma.$executeRaw`
        INSERT INTO "Message"(id,"authorId",content)
        VALUES (${`${PREFIXO}-m2`}, ${menor}, 'oi')`,
    );

    await tentar(
      "mensagem so na conversa",
      () => prisma.$executeRaw`
        INSERT INTO "Message"(id,"dmChannelId","authorId",content)
        VALUES (${`${PREFIXO}-m3`}, ${dm}, ${menor}, 'oi')`,
      true,
    );

    /**
     * Apagar a conversa leva as mensagens dela. Sem o cascata, apagar uma
     * conta deixaria mensagem apontando para conversa que nao existe mais.
     */
    await prisma.$executeRaw`DELETE FROM "DmChannel" WHERE id = ${dm}`;
    const orfas = await prisma.message.count({ where: { dmChannelId: dm } });
    if (orfas === 0) {
      passed += 1;
      console.log("  ok   apagar a conversa levou as mensagens junto");
    } else {
      failed += 1;
      console.log(`  FALHOU ${orfas} mensagem(ns) sobraram sem conversa`);
    }
  } finally {
    // Rede de seguranca: se algum passo acima parou no meio, nao deixa lixo.
    await prisma.$executeRaw`DELETE FROM "DmChannel" WHERE id LIKE ${`${PREFIXO}%`}`;
    await prisma.$executeRaw`DELETE FROM "Message" WHERE id LIKE ${`${PREFIXO}%`}`;
  }

  await fluxoNoGateway();

  console.log(`\n${passed} ok, ${failed} falhou\n`);
  for (const id of sessoesCriadas) {
    await prisma.session.delete({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (erro) => {
  console.error(erro);
  await prisma.$disconnect();
  process.exit(1);
});

/**
 * O fluxo de verdade, por socket: abrir, mandar, receber, listar — e o que
 * mais importa, NAO conseguir ler a conversa dos outros.
 */
async function fluxoNoGateway() {
  console.log("\nFluxo no gateway\n");

  const amizade = await prisma.friendship.findFirst({
    where: { status: "ACCEPTED" },
    select: { requesterId: true, addresseeId: true },
  });
  if (!amizade) {
    console.log("  -- pulado: nao ha amizade aceita no banco");
    return;
  }
  const [aId, bId] = [amizade.requesterId, amizade.addresseeId];

  /**
   * Alguem que NAO e amigo de nenhum dos dois — o intruso do teste.
   * Precisa estar fora do circulo de A, senao ele conseguiria abrir conversa
   * legitimamente e o teste de acesso indevido nao provaria nada.
   */
  const amigosDeA = await prisma.friendship.findMany({
    where: { OR: [{ requesterId: aId }, { addresseeId: aId }] },
    select: { requesterId: true, addresseeId: true },
  });
  const ligados = new Set([
    aId,
    bId,
    ...amigosDeA.flatMap((f) => [f.requesterId, f.addresseeId]),
  ]);
  const estranho = await prisma.user.findFirst({
    where: { id: { notIn: [...ligados] } },
    select: { id: true },
  });

  const socketA = await conectar(await cookieDeSessao(aId));
  const socketB = await conectar(await cookieDeSessao(bId));
  if (!socketA || !socketB) {
    console.log("  -- pulado: gateway fora do ar (npm run dev:realtime)");
    return;
  }

  let dmId = null;
  try {
    const aberta = await pedir(socketA, "dm:open", { userId: bId });
    checar("abrir conversa com amigo", aberta.ok, aberta.error);
    if (!aberta.ok) return;
    dmId = aberta.dm.id;

    /**
     * Idempotencia importa porque a tela vai chamar isto a cada clique em
     * "conversar". Se cada clique criasse uma conversa, o historico se
     * espalharia por varias e pareceria ter sumido.
     */
    const denovo = await pedir(socketB, "dm:open", { userId: aId });
    checar(
      "abrir do OUTRO lado devolve a MESMA conversa",
      denovo.ok && denovo.dm.id === dmId,
      denovo.ok ? `veio ${denovo.dm.id}, esperado ${dmId}` : denovo.error,
    );

    const comigo = await pedir(socketA, "dm:open", { userId: aId });
    checar("conversa consigo mesmo e recusada", !comigo.ok);

    if (estranho) {
      const naoAmigo = await pedir(socketA, "dm:open", { userId: estranho.id });
      checar("abrir com quem nao e amigo e recusado", !naoAmigo.ok);
    }

    /** A mensagem tem de CHEGAR no outro, nao so ser aceita. */
    const chegou = new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), 5000);
      socketB.once("message:new", (payload) => {
        clearTimeout(t);
        resolve(payload);
      });
    });

    const texto = `${PREFIXO} ola`;
    const enviada = await pedir(socketA, "message:send", {
      conversationId: dmId,
      content: texto,
      nonce: PREFIXO,
    });
    checar("enviar mensagem na conversa", enviada.ok, enviada.error);

    const recebida = await chegou;
    checar(
      "a mensagem chega na sala pessoal do outro",
      recebida?.message?.content === texto,
      recebida ? "conteudo diferente" : "nada chegou em 5s",
    );
    checar(
      "a mensagem vem com o id da conversa",
      recebida?.message?.conversationId === dmId,
      `veio ${recebida?.message?.conversationId}`,
    );

    const hist = await pedir(socketB, "message:history", {
      conversationId: dmId,
    });
    checar(
      "historico traz a mensagem",
      hist.ok && hist.messages.some((m) => m.content === texto),
      hist.error,
    );

    const lista = await pedir(socketA, "dm:list");
    checar(
      "a conversa aparece em dm:list",
      lista.ok && lista.conversas.some((c) => c.id === dmId),
      lista.error,
    );

    /**
     * O TESTE QUE MAIS IMPORTA. Alguem de fora, com o id da conversa em maos,
     * nao pode ler nem escrever nela. O id nao e segredo — ele viaja na URL —
     * entao a defesa tem de ser a checagem, nunca a obscuridade.
     */
    if (estranho) {
      const socketC = await conectar(await cookieDeSessao(estranho.id));
      if (socketC) {
        try {
          const leitura = await pedir(socketC, "message:history", {
            conversationId: dmId,
          });
          checar("estranho NAO le a conversa alheia", !leitura.ok);

          const escrita = await pedir(socketC, "message:send", {
            conversationId: dmId,
            content: "invadi",
            nonce: `${PREFIXO}x`,
          });
          checar("estranho NAO escreve na conversa alheia", !escrita.ok);
        } finally {
          socketC.close();
        }
      }
    }
    /**
     * O NOME ANTIGO DO CAMPO AINDA FUNCIONA.
     *
     * Existe uma compatibilidade temporaria no gateway: `message:send` e
     * `message:history` aceitam tanto `conversationId` quanto o antigo
     * `channelId`. Ela existe porque Vercel e Fly nao sobem no mesmo instante,
     * e sem ela a janela entre os dois deploys e chat quebrado.
     *
     * APAGAR ESTE TESTE junto com o shim, quando os dois lados estiverem em
     * producao com o nome novo.
     */
    const nomeAntigo = await pedir(socketA, "message:send", {
      channelId: dmId,
      content: `${PREFIXO} compat`,
      nonce: `${PREFIXO}c`,
    });
    checar("compat: o campo antigo channelId ainda e aceito", nomeAntigo.ok, nomeAntigo.error);

    /**
     * DESFAZER A AMIZADE FECHA A CONVERSA.
     *
     * Sem bloqueio no produto, essa e a unica forma de alguem parar de receber
     * mensagem de outra pessoa. Se a amizade so fosse conferida na ABERTURA,
     * o canal ficaria aberto para sempre depois de aceito uma vez — e a
     * regra existiria so no comentario.
     *
     * A amizade e recriada no fim: o teste nao pode deixar duas pessoas
     * desamigadas por ter rodado.
     */
    const relacao = await prisma.friendship.findFirst({
      where: {
        status: "ACCEPTED",
        OR: [
          { requesterId: aId, addresseeId: bId },
          { requesterId: bId, addresseeId: aId },
        ],
      },
      select: { id: true, requesterId: true, addresseeId: true },
    });
    if (relacao) {
      await prisma.friendship.delete({ where: { id: relacao.id } });
      try {
        const semAmizade = await pedir(socketA, "message:history", {
          conversationId: dmId,
        });
        checar("desfazer amizade fecha a conversa", !semAmizade.ok);

        const listaDepois = await pedir(socketA, "dm:list");
        checar(
          "a conversa some de dm:list depois de desfazer",
          listaDepois.ok && !listaDepois.conversas.some((c) => c.id === dmId),
          listaDepois.error,
        );
      } finally {
        await prisma.friendship.create({
          data: {
            requesterId: relacao.requesterId,
            addresseeId: relacao.addresseeId,
            status: "ACCEPTED",
            respondedAt: new Date(),
          },
        });
      }
    }
  } finally {
    socketA.close();
    socketB.close();
    if (dmId) {
      await prisma
        .$executeRaw`DELETE FROM "DmChannel" WHERE id = ${dmId}`
        .catch(() => {});
    }
  }
}
