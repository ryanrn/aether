/**
 * Concede a permissao CAMERA aos cargos que ja podem compartilhar tela.
 *
 * POR QUE PRECISA: `CAMERA` e um bit NOVO, e os valores de permissao dos
 * cargos estao gravados no banco como numero. Cargo criado antes disto nao
 * tem o bit — nem o Dono. Sem este script o botao de camera nasceria sem
 * ninguem que pudesse usa-lo, e pareceria quebrado.
 *
 * O criterio e SCREEN_SHARE porque as duas coisas respondem a mesma pergunta
 * de confianca: "esta pessoa pode publicar video neste servidor?". Quem ja
 * podia mostrar a tela nao vira um risco novo por poder mostrar o rosto.
 *
 * NAO concede a quem nao tinha SCREEN_SHARE. Cargo restrito continua
 * restrito — ampliar permissao de quem foi deliberadamente limitado seria
 * decidir pelo dono do servidor.
 *
 * Uso — confira antes de aplicar:
 *   dotenv -e .env -- npx tsx scripts/liberar-camera.mjs
 *   dotenv -e .env -- npx tsx scripts/liberar-camera.mjs --aplicar
 *   dotenv -e .env -- npx tsx scripts/liberar-camera.mjs --dono=ryan --aplicar
 */
import { PrismaClient } from "@prisma/client";
import { Permission } from "@aether/shared";

const prisma = new PrismaClient();
const APLICAR = process.argv.includes("--aplicar");
const DONO = process.argv.find((a) => a.startsWith("--dono="))?.slice(7);

const TELA = Permission.SCREEN_SHARE;
const CAMERA = Permission.CAMERA;

async function main() {
  let filtro;
  if (DONO) {
    const dono = await prisma.user.findUnique({
      where: { username: DONO },
      select: { id: true },
    });
    if (!dono) {
      console.log(`\nUsuario "${DONO}" nao encontrado.\n`);
      return;
    }
    filtro = { ownerId: dono.id };
    console.log(`\nLimitado aos servidores de "${DONO}".`);
  } else {
    console.log("\nSem --dono: TODOS os servidores do banco.");
  }

  const cargos = await prisma.role.findMany({
    where: filtro ? { server: filtro } : undefined,
    select: {
      id: true,
      name: true,
      permissions: true,
      isOwner: true,
      server: { select: { name: true } },
    },
    orderBy: [{ serverId: "asc" }, { position: "desc" }],
  });

  const alvos = cargos.filter((c) => {
    const bits = BigInt(c.permissions);
    /**
     * ADMINISTRATOR ja recebe tudo no calculo de permissao, entao nao ha o que
     * conceder — mexer no numero dele so sujaria o registro sem mudar nada.
     */
    if ((bits & Permission.ADMINISTRATOR) !== 0n) return false;
    return (bits & TELA) !== 0n && (bits & CAMERA) === 0n;
  });

  const jaTinham = cargos.filter((c) => (BigInt(c.permissions) & CAMERA) !== 0n);
  const semTela = cargos.filter(
    (c) =>
      (BigInt(c.permissions) & Permission.ADMINISTRATOR) === 0n &&
      (BigInt(c.permissions) & TELA) === 0n,
  );

  console.log(APLICAR ? "\nAPLICANDO\n" : "\nCONFERENCIA (nada foi gravado)\n");

  const porServidor = new Map();
  for (const c of alvos) {
    const lista = porServidor.get(c.server.name) ?? [];
    lista.push(c);
    porServidor.set(c.server.name, lista);
  }

  for (const [servidor, lista] of porServidor) {
    console.log(`  ${servidor}`);
    for (const c of lista) console.log(`    ${c.name} -> ganha CAMERA`);
    console.log("");
  }

  if (alvos.length === 0) console.log("  (nenhum cargo a mudar)\n");

  console.log(`ja tinham CAMERA ......... ${jaTinham.length}`);
  console.log(`sem SCREEN_SHARE (nao toco) ${semTela.length}`);
  console.log(`seriam alterados ......... ${alvos.length}`);

  if (!APLICAR) {
    console.log("\nPara aplicar:");
    console.log(
      `  dotenv -e .env -- npx tsx scripts/liberar-camera.mjs${
        DONO ? ` --dono=${DONO}` : ""
      } --aplicar\n`,
    );
    return;
  }

  // Uma transacao so: metade dos cargos com camera e metade sem seria pior do
  // que nao ter comecado.
  await prisma.$transaction(
    alvos.map((c) =>
      prisma.role.update({
        where: { id: c.id },
        data: { permissions: BigInt(c.permissions) | CAMERA },
      }),
    ),
  );
  console.log(`\n${alvos.length} cargo(s) atualizados.\n`);
}

main()
  .catch((erro) => {
    console.error("\nerro:", erro.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
