/**
 * Verificacao da camada de metadados de jogo, contra o IGDB de VERDADE.
 *
 * O `tests/unit/game-metadata.test.ts` cobre o casamento, que e funcao pura.
 * Este script cobre o que so se prova falando com o servico: o token da Twitch
 * sai, a busca responde, o jogo casa, a capa existe e o cache no banco evita a
 * segunda consulta.
 *
 * Sem TWITCH_CLIENT_ID/SECRET ele PULA em vez de reprovar — a integracao e
 * opcional, e reprovar aqui descreveria uma configuracao ausente, nao um
 * defeito.
 *
 * Roda por `tsx`, e nao por `node` direto como os outros verify: este importa
 * os modulos TypeScript do gateway de verdade, para testar o mesmo codigo que
 * roda em producao em vez de uma reimplementacao.
 *
 * Uso:
 *   dotenv -e .env -- npx tsx scripts/verify-igdb.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
let passed = 0;
let failed = 0;

function check(rotulo, ok, detalhe = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${rotulo}`);
  } else {
    failed += 1;
    console.log(`  FALHA ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

const ID = process.env.TWITCH_CLIENT_ID;
const SECRET = process.env.TWITCH_CLIENT_SECRET;

/** Jogos reais, escolhidos porque exercitam casos diferentes do casamento. */
const CASOS = [
  { detectado: "Hollow Knight", esperaCapa: true },
  { detectado: "ELDEN RING", esperaCapa: true, nota: "grafia toda maiuscula" },
  { detectado: "Rocket League", esperaCapa: true },
  {
    detectado: "Marvel's Spider-Man Remastered",
    esperaCapa: true,
    nota: "apostrofo e sufixo de edicao",
  },
  {
    detectado: "ZzzJogoQueNaoExisteAether",
    esperaCapa: false,
    nota: "tem de falhar sem quebrar",
  },
];

async function main() {
  // A tabela e conferida SEMPRE — nao depende de credencial nenhuma.
  await conferirTabela();

  if (!ID || !SECRET) {
    console.log("\nSem credencial do IGDB — conferindo o caminho de FALLBACK");
    console.log("(que e o que esta valendo em producao agora)");
    await conferirFallback();
    console.log(`\n${passed} passaram, ${failed} falharam`);
    console.log("\nA busca no IGDB em si ficou POR CONFERIR: falta");
    console.log(
      ID
        ? "  TWITCH_CLIENT_SECRET no .env."
        : "  TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET no .env.",
    );
    return;
  }

  console.log("\nToken da Twitch (client credentials, sem login de usuario)");

  const { buscarJogos, igdbConfigurado } = await import(
    "../apps/realtime/src/games/igdb.ts"
  );
  const { melhorCasamento, urlDaCapa, normalizarNome } = await import(
    "../apps/realtime/src/games/normalize.ts"
  );

  check("as credenciais estao visiveis para o modulo", igdbConfigurado());

  const primeiros = await buscarJogos("Hollow Knight");
  check(
    "a busca respondeu (logo o token saiu)",
    primeiros.length > 0,
    "nenhum candidato — token ou rede",
  );

  console.log("\nCasamento com jogos reais");

  for (const caso of CASOS) {
    const candidatos = await buscarJogos(caso.detectado);
    const casamento = melhorCasamento(caso.detectado, candidatos);
    const capa = casamento ? urlDaCapa(casamento.candidato.coverImageId) : null;
    const rotulo = `${caso.detectado}${caso.nota ? ` (${caso.nota})` : ""}`;

    if (caso.esperaCapa) {
      check(
        `${rotulo} -> capa`,
        capa !== null,
        casamento
          ? `casou "${casamento.candidato.name}" mas sem image_id`
          : `nenhum candidato passou do corte entre ${candidatos.length}`,
      );
      if (casamento) {
        console.log(
          `        casou "${casamento.candidato.name}" (igdb ${casamento.candidato.id}, confianca ${casamento.confianca})`,
        );
      }
    } else {
      check(
        `${rotulo} -> sem capa, e sem quebrar`,
        capa === null,
        `casou indevidamente "${casamento?.candidato.name}"`,
      );
    }
    // Respeita o limite de 4 por segundo do IGDB.
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log("\nA capa aponta mesmo para uma imagem");

  const candidatos = await buscarJogos("Hollow Knight");
  const casamento = melhorCasamento("Hollow Knight", candidatos);
  const capa = urlDaCapa(casamento?.candidato.coverImageId);
  if (capa) {
    const resposta = await fetch(capa, { method: "HEAD" });
    check(`a URL da capa responde 200`, resposta.status === 200, `respondeu ${resposta.status}`);
    check(
      "e o tipo e imagem",
      (resposta.headers.get("content-type") ?? "").startsWith("image/"),
      resposta.headers.get("content-type") ?? "sem content-type",
    );
  } else {
    check("consegui uma capa para conferir", false);
  }

  console.log("\nO caminho de fallback continua valendo");
  await conferirFallback();

  console.log(`\n${passed} passaram, ${failed} falharam`);
}

/** O que vale conferir na tabela, com ou sem IGDB configurado. */
async function conferirTabela() {
  console.log("\nA tabela de cache");

  const colunas = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'GameMetadata' AND column_name ILIKE '%user%'`,
  );
  /**
   * A checagem que mais importa nesta tabela: ela guarda "Hollow Knight tem
   * esta capa", nunca "fulano jogou Hollow Knight". Uma coluna de usuario aqui
   * transformaria cache de arte em historico de habitos de jogo — o dado que a
   * deteccao local justamente se recusa a mandar para o servidor.
   */
  check(
    "NAO tem nenhuma coluna de usuario",
    Array.isArray(colunas) && colunas.length === 0,
    JSON.stringify(colunas),
  );

  const rls = await prisma.$queryRawUnsafe(
    `SELECT relrowsecurity FROM pg_class WHERE relname = 'GameMetadata'`,
  );
  check("nasce com RLS ligado", rls[0]?.relrowsecurity === true);

  const grants = await prisma.$queryRawUnsafe(
    `SELECT grantee FROM information_schema.role_table_grants
     WHERE table_name = 'GameMetadata' AND grantee IN ('anon','authenticated')`,
  );
  check(
    "fechada para a chave publica do Supabase",
    Array.isArray(grants) && grants.length === 0,
    JSON.stringify(grants),
  );
}

/**
 * O caminho que vale SEM IGDB — e que precisa continuar valendo mesmo depois
 * de configurar, porque e para onde tudo cai quando o servico falha.
 */
async function conferirFallback() {
  const { metadadosDe } = await import("../apps/realtime/src/games/metadata.ts");
  const { normalizarNome } = await import(
    "../apps/realtime/src/games/normalize.ts"
  );

  const nome = `JogoDeTeste ${Date.now()}`;
  const chave = normalizarNome(nome);

  const meta = await metadadosDe(nome);
  check(
    "devolve o nome do detector intacto",
    meta.displayName === nome,
    meta.displayName,
  );
  check("sem capa, e sem lancar erro", meta.coverUrl === null);

  if (!ID || !SECRET) {
    /**
     * Sem credencial NAO grava. Se gravasse, o jogo ficaria dias sem nova
     * tentativa DEPOIS de configurar as chaves: o cache teria guardado a
     * ausencia de configuracao em vez de um fato sobre o jogo.
     */
    const linha = await prisma.gameMetadata.findUnique({
      where: { lookupKey: chave },
    });
    check(
      "NAO grava cache negativo quando o IGDB nem esta configurado",
      linha === null,
      "gravou — configurar as chaves depois nao teria efeito imediato",
    );
  }

  // E uma linha que ja existe, e mesmo respeitada sem consultar nada?
  const comCapa =
    "https://images.igdb.com/igdb/image/upload/t_cover_big/co1rgi.jpg";
  await prisma.gameMetadata.upsert({
    where: { lookupKey: chave },
    update: { displayName: "Nome Vindo Do Cache", coverUrl: comCapa },
    create: {
      lookupKey: chave,
      detectedName: nome,
      displayName: "Nome Vindo Do Cache",
      coverUrl: comCapa,
      source: "IGDB",
      confidence: 1,
    },
  });
  const doCache = await metadadosDe(nome);
  check("linha existente e usada", doCache.coverUrl === comCapa);
  check(
    "inclusive o nome guardado",
    doCache.displayName === "Nome Vindo Do Cache",
    doCache.displayName,
  );

  await prisma.gameMetadata.delete({ where: { lookupKey: chave } });

  if (!ID || !SECRET) await conferirComCredencialInvalida();
}

/**
 * O IGDB configurado, porem RECUSANDO — que e o estado de 401, de credencial
 * revogada e de conta suspensa.
 *
 * Duas coisas se provam aqui, e nenhuma das duas se prova sem credencial
 * nenhuma configurada:
 *
 *  1. a atividade sobrevive ao IGDB recusando (secao 20 da especificacao);
 *  2. o cache e MESMO consultado antes da rede. Sem credencial configurada os
 *     dois caminhos devolvem a linha do banco e sao indistinguiveis — foi o
 *     que uma checagem por mutacao mostrou. Com credencial invalida eles
 *     divergem: pelo cache vem a capa, pela rede vem nada.
 *
 * As credenciais falsas nao sao segredo de ninguem e a Twitch responde 401.
 */
async function conferirComCredencialInvalida() {
  console.log("\nCom o IGDB configurado mas RECUSANDO (o caso do 401)");

  const idOriginal = process.env.TWITCH_CLIENT_ID;
  const secretOriginal = process.env.TWITCH_CLIENT_SECRET;
  process.env.TWITCH_CLIENT_ID = "aether-credencial-de-teste";
  process.env.TWITCH_CLIENT_SECRET = "aether-credencial-de-teste";

  try {
    const { metadadosDe } = await import(
      "../apps/realtime/src/games/metadata.ts"
    );
    const { normalizarNome } = await import(
      "../apps/realtime/src/games/normalize.ts"
    );

    // (a) sem linha no cache: a rede falha e a atividade continua de pe.
    const semCache = `JogoSemCache ${Date.now()}`;
    const meta = await metadadosDe(semCache);
    check(
      "o IGDB recusando NAO derruba a atividade",
      meta.displayName === semCache && meta.coverUrl === null,
      JSON.stringify(meta),
    );

    // (b) com linha no cache: a capa vem sem a rede entrar na conversa.
    const comCache = `JogoComCache ${Date.now()}`;
    const chave = normalizarNome(comCache);
    const capa =
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co1rgi.jpg";
    await prisma.gameMetadata.create({
      data: {
        lookupKey: chave,
        detectedName: comCache,
        displayName: comCache,
        coverUrl: capa,
        source: "IGDB",
        confidence: 1,
      },
    });
    const doCache = await metadadosDe(comCache);
    check(
      "o cache e consultado ANTES da rede",
      doCache.coverUrl === capa,
      "veio sem capa — a rede foi consultada primeiro e falhou",
    );
    await prisma.gameMetadata.delete({ where: { lookupKey: chave } });

    // Falha de rede nao pode virar cache negativo.
    const gravou = await prisma.gameMetadata.findUnique({
      where: { lookupKey: normalizarNome(semCache) },
    });
    check(
      "falha de credencial vira cache negativo (3 dias) e nao consulta em loop",
      gravou !== null && gravou.coverUrl === null,
      gravou === null ? "nao gravou nada" : "gravou com capa",
    );
    if (gravou) {
      await prisma.gameMetadata.delete({ where: { id: gravou.id } });
    }
  } finally {
    if (idOriginal === undefined) delete process.env.TWITCH_CLIENT_ID;
    else process.env.TWITCH_CLIENT_ID = idOriginal;
    if (secretOriginal === undefined) delete process.env.TWITCH_CLIENT_SECRET;
    else process.env.TWITCH_CLIENT_SECRET = secretOriginal;
  }
}

main()
  .catch((erro) => {
    console.error("\nerro:", erro.message);
    failed += 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
