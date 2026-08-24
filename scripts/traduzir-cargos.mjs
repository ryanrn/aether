/**
 * Traduz os nomes dos cargos PADRAO que ja existem no banco.
 *
 * Por que um script, e nao uma migration: nome de cargo e DADO editavel, nao
 * estrutura. Quem administra um servidor pode renomear os cargos dele quando
 * quiser — e uma migration passaria por cima disso sem perguntar, em servidor
 * de outra pessoa.
 *
 * A protecao que isso implica: so renomeamos cargos que ainda carregam o nome
 * padrao EXATO em ingles. Qualquer cargo criado ou renomeado por alguem fica
 * intacto, porque um nome diferente e uma escolha de alguem, e nao um resto de
 * traducao esquecido.
 *
 * O que NAO e tocado: permissoes, posicao, cor, e quem tem cada cargo. Muda o
 * texto do nome, e mais nada.
 *
 * `--dono=<usuario>` limita aos servidores DAQUELA pessoa, e existe por um
 * motivo que so apareceu no ensaio: o banco tem servidores de outras pessoas.
 * Renomear cargo no espaco de alguem por script e invasivo — a pessoa veria os
 * cargos dela mudarem de nome sem ter pedido nada. Sem o filtro, o script pega
 * tudo; com ele, so o que e seu.
 *
 * Uso — confira ANTES de aplicar:
 *   dotenv -e .env -- node scripts/traduzir-cargos.mjs --dono=ryan
 *   dotenv -e .env -- node scripts/traduzir-cargos.mjs --dono=ryan --aplicar
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APLICAR = process.argv.includes("--aplicar");
const DONO = process.argv
  .find((a) => a.startsWith("--dono="))
  ?.slice("--dono=".length);

/**
 * De-para dos nomes padrao. A ordem nao importa; o casamento e exato e
 * sensivel a maiusculas, de proposito: "moderator" em minusculas foi alguem
 * digitando, nao o nosso molde.
 */
const TRADUCAO = new Map([
  ["Owner", "Dono"],
  ["Administrator", "Administrador"],
  ["Moderator", "Moderador"],
  ["Member", "Membro"],
  ["Guest", "Convidado"],
]);

async function main() {
  let filtroDeServidor;
  if (DONO) {
    const dono = await prisma.user.findUnique({
      where: { username: DONO },
      select: { id: true },
    });
    if (!dono) {
      console.log(`\nUsuario "${DONO}" nao encontrado.\n`);
      return;
    }
    filtroDeServidor = { ownerId: dono.id };
    console.log(`\nLimitado aos servidores de "${DONO}".`);
  } else {
    console.log(
      "\nSem --dono: TODOS os servidores do banco, inclusive de outras pessoas.",
    );
  }

  const alvos = await prisma.role.findMany({
    where: {
      name: { in: [...TRADUCAO.keys()] },
      ...(filtroDeServidor ? { server: filtroDeServidor } : null),
    },
    select: {
      id: true,
      name: true,
      position: true,
      server: { select: { id: true, name: true } },
      _count: { select: { members: true } },
    },
    orderBy: [{ serverId: "asc" }, { position: "desc" }],
  });

  if (alvos.length === 0) {
    console.log("\nNenhum cargo com nome padrao em ingles. Nada a fazer.\n");
    return;
  }

  /**
   * Um servidor pode ja ter um cargo com o nome de destino — por exemplo
   * alguem que criou "Membro" a mao. Renomear "Member" para "Membro" ali
   * deixaria dois cargos com o mesmo nome, o que confunde na tela de cargos
   * sem quebrar nada. Avisamos e pulamos: juntar dois cargos nao e traducao.
   */
  const existentes = await prisma.role.findMany({
    where: { name: { in: [...TRADUCAO.values()] } },
    select: { serverId: true, name: true },
  });
  const jaTem = new Set(existentes.map((r) => `${r.serverId}|${r.name}`));

  const porServidor = new Map();
  const conflitos = [];

  for (const cargo of alvos) {
    const destino = TRADUCAO.get(cargo.name);
    if (jaTem.has(`${cargo.server.id}|${destino}`)) {
      conflitos.push({ ...cargo, destino });
      continue;
    }
    const lista = porServidor.get(cargo.server.name) ?? [];
    lista.push({ ...cargo, destino });
    porServidor.set(cargo.server.name, lista);
  }

  console.log(APLICAR ? "\nAPLICANDO\n" : "\nCONFERENCIA (nada foi gravado)\n");

  let total = 0;
  for (const [servidor, cargos] of porServidor) {
    console.log(`  ${servidor}`);
    for (const c of cargos) {
      const pessoas = c._count.members;
      console.log(
        `    ${c.name.padEnd(15)} -> ${c.destino.padEnd(15)} ` +
          `(${pessoas} ${pessoas === 1 ? "pessoa" : "pessoas"})`,
      );
      total += 1;
    }
    console.log("");
  }

  if (conflitos.length > 0) {
    console.log("  PULADOS — o servidor ja tem um cargo com o nome de destino:");
    for (const c of conflitos) {
      console.log(`    ${c.server.name}: ${c.name} (ja existe "${c.destino}")`);
    }
    console.log("");
  }

  if (!APLICAR) {
    console.log(`${total} cargo(s) seriam renomeados.`);
    console.log("\nPara aplicar de verdade:");
    console.log("  dotenv -e .env -- node scripts/traduzir-cargos.mjs --aplicar\n");
    return;
  }

  /**
   * Uma transacao so: renomear metade dos cargos deixaria a tela de cargos em
   * dois idiomas, que e pior do que nao ter comecado.
   */
  await prisma.$transaction(
    [...porServidor.values()].flat().map((c) =>
      prisma.role.update({ where: { id: c.id }, data: { name: c.destino } }),
    ),
  );

  console.log(`${total} cargo(s) renomeados.`);
  console.log("\nPermissoes, posicao, cor e quem tem cada cargo: intocados.\n");
}

main()
  .catch((erro) => {
    console.error("\nerro:", erro.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
