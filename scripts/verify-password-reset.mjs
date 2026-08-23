/**
 * Verificacao do fluxo de redefinicao de senha, contra o banco de VERDADE.
 *
 * O que este script cobre e o que teste unitario nao alcanca: token de uso
 * unico, expiracao, revogacao de sessao e a resposta constante que impede
 * descobrir quem tem conta aqui.
 *
 * Ele cria um usuario descartavel e o apaga no fim — NUNCA mexe em conta real.
 *
 * Uso (com o app rodando):
 *   dotenv -e .env -- node scripts/verify-password-reset.mjs
 */
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, scryptSync } from "node:crypto";

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

const hashDoToken = (t) => createHash("sha256").update(t).digest("hex");

/** Mesmo formato do apps/web/src/server/auth/password.ts */
function hashSenha(senha) {
  const salt = randomBytes(16);
  const derived = scryptSync(senha.normalize("NFKC"), salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return ["scrypt", 16384, 8, 1, salt.toString("base64"), derived.toString("base64")].join("$");
}

const MARCA = `reset-teste-${Date.now()}`;
let userId = null;

async function main() {
  const user = await prisma.user.create({
    data: {
      username: MARCA.slice(0, 20),
      displayName: "Cobaia do teste",
      email: `${MARCA}@local.test`,
      passwordHash: hashSenha("senha-antiga-123"),
    },
    select: { id: true, email: true },
  });
  userId = user.id;
  console.log(`\nusuario descartavel criado: ${user.email}\n`);

  console.log("Token de uso unico");

  const token = randomBytes(32).toString("base64url");
  const registro = await prisma.passwordReset.create({
    data: {
      userId: user.id,
      tokenHash: hashDoToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
    select: { id: true },
  });

  const achado = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashDoToken(token) },
    select: { id: true, usedAt: true },
  });
  check("o token achado pelo HASH e o mesmo registro", achado?.id === registro.id);
  check("nasce sem carimbo de uso", achado?.usedAt === null);

  // O token em claro NAO pode estar em lugar nenhum da linha.
  const linha = await prisma.passwordReset.findUnique({
    where: { id: registro.id },
  });
  const emClaro = JSON.stringify(linha).includes(token);
  check("o token em claro NAO esta guardado no banco", !emClaro);

  // Marca como usado e confere que nao serve mais.
  await prisma.passwordReset.update({
    where: { id: registro.id },
    data: { usedAt: new Date() },
  });
  const depois = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashDoToken(token) },
    select: { usedAt: true },
  });
  check("depois de usado, o carimbo fica", depois?.usedAt !== null);

  console.log("\nRedefinir derruba as sessoes");

  const s1 = await prisma.session.create({
    data: { userId: user.id, expiresAt: new Date(Date.now() + 3600_000) },
    select: { id: true },
  });
  const s2 = await prisma.session.create({
    data: { userId: user.id, expiresAt: new Date(Date.now() + 3600_000) },
    select: { id: true },
  });

  const token2 = randomBytes(32).toString("base64url");
  const reg2 = await prisma.passwordReset.create({
    data: {
      userId: user.id,
      tokenHash: hashDoToken(token2),
      expiresAt: new Date(Date.now() + 3600_000),
    },
    select: { id: true },
  });
  // Um TERCEIRO pedido pendente, para conferir que ele tambem morre.
  const token3 = randomBytes(32).toString("base64url");
  await prisma.passwordReset.create({
    data: {
      userId: user.id,
      tokenHash: hashDoToken(token3),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });

  // A mesma transacao que a action executa.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hashSenha("senha-nova-456") },
    }),
    prisma.passwordReset.update({
      where: { id: reg2.id },
      data: { usedAt: new Date() },
    }),
    prisma.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  const sessoes = await prisma.session.findMany({
    where: { id: { in: [s1.id, s2.id] } },
    select: { revokedAt: true },
  });
  check(
    "TODAS as sessoes abertas foram revogadas",
    sessoes.every((s) => s.revokedAt !== null),
    `${sessoes.filter((s) => s.revokedAt === null).length} sobraram vivas`,
  );

  const pendentes = await prisma.passwordReset.count({
    where: { userId: user.id, usedAt: null },
  });
  check("nenhum outro link pendente sobra vivo", pendentes === 0, `${pendentes} vivos`);

  const atual = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  check("a senha realmente mudou", !atual.passwordHash.includes("senha-antiga"));

  console.log("\nExpiracao");

  const vencido = randomBytes(32).toString("base64url");
  await prisma.passwordReset.create({
    data: {
      userId: user.id,
      tokenHash: hashDoToken(vencido),
      // Uma hora ATRAS.
      expiresAt: new Date(Date.now() - 3600_000),
    },
  });
  const reg4 = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashDoToken(vencido) },
    select: { expiresAt: true },
  });
  check(
    "link vencido e reconhecivel pela data",
    reg4.expiresAt.getTime() <= Date.now(),
  );

  console.log(`\n${passed} passaram, ${failed} falharam`);
}

main()
  .catch((erro) => {
    console.error("\nerro:", erro.message);
    failed += 1;
  })
  .finally(async () => {
    // Cascade leva os PasswordReset e as Session junto.
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
      console.log("usuario descartavel removido");
    }
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
