/**
 * Gera chaves de plano, e lista o que ja existe.
 *
 * E assim que se da VIP para alguem hoje: gere a chave, mande para a pessoa,
 * ela resgata nas configuracoes. Diferente de `definir-plano.mjs`, que marca a
 * conta direto, a chave serve quando voce NAO sabe de quem e a conta — sorteio,
 * parceiro, brinde num video.
 *
 * O CODIGO APARECE UMA VEZ. Depois disso so existe o sha256 no banco: se
 * perder, revogue e gere outra. E de proposito — chave guardada em claro no
 * banco vira plano de graca no dia de um vazamento.
 *
 * Uso:
 *   node scripts/gerar-chave.mjs PRO 30
 *   node scripts/gerar-chave.mjs PLUS 30 --usos 50 --validade 7 --motivo "sorteio"
 *   node scripts/gerar-chave.mjs --listar
 *   node scripts/gerar-chave.mjs --revogar <id>
 *
 * (sempre com `npx dotenv -e .env --` na frente)
 */
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

const prisma = new PrismaClient();
const TIERS = ["FREE", "PLUS", "PRO"];
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Mesmo alfabeto e mesmo formato do servico — sem `0/O/1/I/L`. */
function gerarCodigo() {
  const bytes = randomBytes(12);
  let corpo = "";
  for (let i = 0; i < 12; i++) {
    corpo += ALFABETO[bytes[i] % ALFABETO.length];
    if (i % 4 === 3 && i < 11) corpo += "-";
  }
  return `AETHER-${corpo}`;
}

const normalizar = (c) => c.trim().toUpperCase().replace(/[\s-]/g, "");
const hashDoCodigo = (c) =>
  createHash("sha256").update(normalizar(c)).digest("hex");

function argumento(nome, padrao = null) {
  const i = process.argv.indexOf(`--${nome}`);
  return i === -1 ? padrao : process.argv[i + 1];
}

async function listar() {
  const chaves = await prisma.planKey.findMany({
    orderBy: { createdAt: "desc" },
    take: 40,
    select: {
      id: true,
      prefixo: true,
      tier: true,
      dias: true,
      usos: true,
      maxUsos: true,
      expiraEm: true,
      revogadaEm: true,
      motivo: true,
      createdAt: true,
    },
  });

  if (chaves.length === 0) {
    console.log("nenhuma chave criada ainda");
    return;
  }

  console.log("chaves (mais novas primeiro):\n");
  for (const c of chaves) {
    const estado = c.revogadaEm
      ? "REVOGADA"
      : c.expiraEm && c.expiraEm < new Date()
        ? "VENCIDA"
        : c.usos >= c.maxUsos
          ? "esgotada"
          : "ativa";
    const validade = c.dias ? `${c.dias}d` : "sem validade";
    console.log(
      `  ${c.id}  AETHER-${c.prefixo}...  ${c.tier} ${validade}  ` +
        `${c.usos}/${c.maxUsos}  [${estado}]` +
        (c.motivo ? `  "${c.motivo}"` : ""),
    );
  }

  console.log("\nquem resgatou:");
  const resgates = await prisma.planKeyRedemption.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      tierConcedido: true,
      createdAt: true,
      key: { select: { prefixo: true } },
      user: { select: { username: true, displayName: true } },
    },
  });
  if (resgates.length === 0) {
    console.log("  (ninguem ainda)");
    return;
  }
  for (const r of resgates) {
    console.log(
      `  @${r.user.username} <- AETHER-${r.key.prefixo}... ` +
        `(${r.tierConcedido}) em ${r.createdAt.toISOString().slice(0, 10)}`,
    );
  }
}

async function revogar(id) {
  const chave = await prisma.planKey.findUnique({
    where: { id },
    select: { id: true, prefixo: true, revogadaEm: true },
  });
  if (!chave) {
    console.log(`nao achei chave com id ${id}`);
    process.exitCode = 1;
    return;
  }
  if (chave.revogadaEm) {
    console.log("essa chave ja estava revogada");
    return;
  }
  await prisma.planKey.update({
    where: { id },
    data: { revogadaEm: new Date() },
  });
  console.log(`AETHER-${chave.prefixo}... revogada`);
  console.log(
    "  (quem JA resgatou continua com o plano — revogar impede novos resgates,\n" +
      "   nao tira o que ja foi dado)",
  );
}

async function main() {
  if (process.argv.includes("--listar")) return listar();

  const idRevogar = argumento("revogar");
  if (idRevogar) return revogar(idRevogar);

  const [tierBruto, diasBruto] = process.argv
    .slice(2)
    .filter((a) => !a.startsWith("--"));

  if (!tierBruto) {
    console.log(
      "uso: node scripts/gerar-chave.mjs <PLUS|PRO> [dias] " +
        "[--usos N] [--validade DIAS] [--motivo TEXTO]",
    );
    console.log("     node scripts/gerar-chave.mjs --listar");
    console.log("     node scripts/gerar-chave.mjs --revogar <id>");
    process.exitCode = 1;
    return;
  }

  const tier = tierBruto.toUpperCase();
  if (!TIERS.includes(tier)) {
    console.log(`plano invalido: ${tierBruto}. Use um de: ${TIERS.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const dias = diasBruto ? Number(diasBruto) : null;
  if (diasBruto && (!Number.isFinite(dias) || dias <= 0)) {
    console.log(`dias invalido: ${diasBruto}`);
    process.exitCode = 1;
    return;
  }

  const maxUsos = Number(argumento("usos", "1"));
  const validade = argumento("validade");
  const motivo = argumento("motivo");

  const codigo = gerarCodigo();
  const chave = await prisma.planKey.create({
    data: {
      codigoHash: hashDoCodigo(codigo),
      prefixo: normalizar(codigo).slice(6, 10),
      tier,
      dias,
      maxUsos: Number.isFinite(maxUsos) && maxUsos > 0 ? maxUsos : 1,
      expiraEm: validade
        ? new Date(Date.now() + Number(validade) * 86400000)
        : null,
      criadaPor: "script",
      motivo,
    },
    select: { id: true },
  });

  console.log("");
  console.log(`  ${codigo}`);
  console.log("");
  console.log(
    `  ${tier} por ${dias ? `${dias} dias` : "tempo indeterminado"}` +
      `, ${maxUsos} ${maxUsos === 1 ? "uso" : "usos"}` +
      (validade ? `, chave valida por ${validade} dias` : ""),
  );
  console.log(`  id: ${chave.id}`);
  console.log("");
  console.log("  ANOTE AGORA. O codigo nao aparece de novo — o banco so guarda");
  console.log("  o hash. Perdeu, revogue e gere outra.");
}

main()
  .catch((erro) => {
    console.error("falhou:", erro.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
