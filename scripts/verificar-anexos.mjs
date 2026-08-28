/**
 * O ciclo de vida de um anexo, do jeito que ele acontece de verdade.
 *
 * Cobre o que os testes de unidade nao alcancam: o servidor assina, o
 * "navegador" envia direto ao R2 sem credencial, o servidor confirma pelo
 * tamanho real, e so entao o anexo pode entrar numa mensagem.
 *
 * E cobre as recusas, que sao o que de fato protege o limite por plano:
 * declarar um tamanho e enviar outro, anexar arquivo de outra pessoa, anexar
 * o que ainda nao chegou, e usar o mesmo anexo em duas mensagens.
 *
 * Uso (com o .env preenchido):
 *   npx dotenv -e .env -- node scripts/verificar-anexos.mjs
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes, createHash } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const prisma = new PrismaClient();
let passou = 0;
let falhou = 0;

const ok = (r, d = "") => {
  passou += 1;
  console.log(`  ok    ${r}${d ? ` — ${d}` : ""}`);
};
const falha = (r, d = "") => {
  falhou += 1;
  console.log(`  FALHA ${r}${d ? ` — ${d}` : ""}`);
};

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET;

/** Assina como o servico assina: com o tamanho dentro da assinatura. */
async function assinar(chave, mime, tamanho) {
  return getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: chave,
      ContentType: mime,
      ContentLength: tamanho,
    }),
    { expiresIn: 600 },
  );
}

const criados = { anexos: [], mensagens: [], chaves: [] };

async function main() {
  if (!process.env.R2_BUCKET) {
    console.log("R2 nao configurado no .env — nao ha o que testar.");
    process.exitCode = 1;
    return;
  }

  const ryan = await prisma.user.findFirst({
    where: { username: "ryan" },
    select: { id: true },
  });
  const joao = await prisma.user.findFirst({
    where: { username: "joao" },
    select: { id: true },
  });
  const canal = await prisma.channel.findFirst({
    where: { type: "TEXT" },
    select: { id: true },
  });
  if (!ryan || !joao || !canal) {
    console.log("faltam usuarios ou canal de exemplo — rode o db:seed");
    process.exitCode = 1;
    return;
  }

  console.log("\nO caminho feliz");

  const conteudo = Buffer.from("conteudo de teste do anexo\n", "utf8");
  const chave = `anexos/${ryan.id}/${randomBytes(16).toString("hex")}.txt`;
  criados.chaves.push(chave);

  // 1. o servidor autoriza e cria a linha
  const anexo = await prisma.attachment.create({
    data: {
      userId: ryan.id,
      chave,
      nome: "teste.txt",
      // o servico regrava tipo desconhecido como octet-stream
      mime: "application/octet-stream",
      tamanho: conteudo.length,
    },
    select: { id: true },
  });
  criados.anexos.push(anexo.id);
  ok("autorizar cria a linha antes do arquivo existir");

  // 2. o navegador envia direto, sem credencial
  const url = await assinar(chave, "application/octet-stream", conteudo.length);
  const envio = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: conteudo,
  });
  envio.ok
    ? ok("navegador envia direto ao R2, sem credencial")
    : falha("navegador envia direto ao R2", `HTTP ${envio.status}`);

  // 3. o servidor confirma pelo tamanho REAL
  const head = await s3.send(
    new HeadObjectCommand({ Bucket: BUCKET, Key: chave }),
  );
  if (head.ContentLength === conteudo.length) {
    await prisma.attachment.update({
      where: { id: anexo.id },
      data: { prontoEm: new Date() },
    });
    ok("servidor confirma pelo tamanho real", `${head.ContentLength} bytes`);
  } else {
    falha("servidor confirma pelo tamanho real");
  }

  // 4. entra numa mensagem
  const msg = await prisma.message.create({
    data: { channelId: canal.id, authorId: ryan.id, content: "com anexo" },
    select: { id: true },
  });
  criados.mensagens.push(msg.id);
  const ligado = await prisma.attachment.updateMany({
    where: { id: { in: [anexo.id] }, userId: ryan.id, prontoEm: { not: null }, messageId: null },
    data: { messageId: msg.id },
  });
  ligado.count === 1
    ? ok("anexo pronto entra na mensagem")
    : falha("anexo pronto entra na mensagem", `ligou ${ligado.count}`);

  console.log("\nAs recusas — e o que cada uma protege");

  // A) tamanho diferente do assinado (o teto por plano depende disto)
  const chaveB = `anexos/${ryan.id}/${randomBytes(16).toString("hex")}.txt`;
  criados.chaves.push(chaveB);
  const urlB = await assinar(chaveB, "application/octet-stream", 10);
  const mentira = await fetch(urlB, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: Buffer.alloc(5000, 0x41),
  });
  mentira.ok
    ? falha(
        "R2 recusa tamanho diferente do assinado",
        "ACEITOU — o limite por plano nao valeria nada",
      )
    : ok("R2 recusa tamanho diferente do assinado", `HTTP ${mentira.status}`);

  // B) anexo de OUTRA pessoa
  const doJoao = await prisma.attachment.create({
    data: {
      userId: joao.id,
      chave: `anexos/${joao.id}/${randomBytes(8).toString("hex")}.txt`,
      nome: "do-joao.txt",
      mime: "application/octet-stream",
      tamanho: 10,
      prontoEm: new Date(),
    },
    select: { id: true },
  });
  criados.anexos.push(doJoao.id);
  const msg2 = await prisma.message.create({
    data: { channelId: canal.id, authorId: ryan.id, content: "roubando" },
    select: { id: true },
  });
  criados.mensagens.push(msg2.id);
  const roubo = await prisma.attachment.updateMany({
    where: { id: { in: [doJoao.id] }, userId: ryan.id, prontoEm: { not: null }, messageId: null },
    data: { messageId: msg2.id },
  });
  roubo.count === 0
    ? ok("anexo de outra pessoa NAO entra na sua mensagem")
    : falha("anexo de outra pessoa NAO entra na sua mensagem");

  // C) anexo que ainda nao chegou ao R2
  const naoEnviado = await prisma.attachment.create({
    data: {
      userId: ryan.id,
      chave: `anexos/${ryan.id}/${randomBytes(8).toString("hex")}.txt`,
      nome: "fantasma.txt",
      mime: "application/octet-stream",
      tamanho: 99,
    },
    select: { id: true },
  });
  criados.anexos.push(naoEnviado.id);
  const fantasma = await prisma.attachment.updateMany({
    where: { id: { in: [naoEnviado.id] }, userId: ryan.id, prontoEm: { not: null }, messageId: null },
    data: { messageId: msg2.id },
  });
  fantasma.count === 0
    ? ok("anexo que nao chegou ao R2 NAO entra na mensagem")
    : falha("anexo que nao chegou ao R2 NAO entra na mensagem");

  // D) o MESMO anexo em duas mensagens
  const reuso = await prisma.attachment.updateMany({
    where: { id: { in: [anexo.id] }, userId: ryan.id, prontoEm: { not: null }, messageId: null },
    data: { messageId: msg2.id },
  });
  reuso.count === 0
    ? ok("o mesmo anexo NAO entra em duas mensagens")
    : falha("o mesmo anexo NAO entra em duas mensagens");

  console.log(`\n${passou} passaram, ${falhou} falharam`);
  if (falhou > 0) process.exitCode = 1;
}

main()
  .catch((erro) => {
    console.error("erro:", erro.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Faxina: o teste nao pode deixar mensagem nem objeto para tras.
    for (const chave of criados.chaves) {
      await s3
        .send(new DeleteObjectCommand({ Bucket: BUCKET, Key: chave }))
        .catch(() => undefined);
    }
    if (criados.anexos.length) {
      await prisma.attachment.deleteMany({ where: { id: { in: criados.anexos } } });
    }
    if (criados.mensagens.length) {
      await prisma.message.deleteMany({ where: { id: { in: criados.mensagens } } });
    }
    await prisma.$disconnect();
  });
