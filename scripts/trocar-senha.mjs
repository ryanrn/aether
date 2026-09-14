/**
 * Troca a senha de uma conta, direto no banco — para quando o "esqueci minha
 * senha" por e-mail nao e uma opcao (fora do ar, sem dominio verificado no
 * Resend, conta com e-mail de seed tipo `@local.test`...).
 *
 * A SENHA NUNCA PASSA PELO CHAT NEM POR ARGUMENTO DE LINHA DE COMANDO — os
 * dois ficam no historico do terminal, e um argumento de CLI tambem aparece
 * na lista de processos do sistema enquanto roda. Este script PERGUNTA a
 * senha de forma interativa, com o eco desligado (nada aparece na tela
 * enquanto voce digita) — ela so existe na memoria deste processo, o tempo
 * de calcular o hash.
 *
 * O hash e EXATAMENTE o mesmo formato de `apps/web/src/server/auth/password.ts`
 * (scrypt$N$r$p$saltB64$hashB64) — nao pode divergir, ou a conta nao consegue
 * mais logar com a senha nova.
 *
 * Uso (interativo, pede a senha duas vezes para confirmar):
 *   npx dotenv -e .env -- node scripts/trocar-senha.mjs ryan
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
const prisma = new PrismaClient();

// Mesmos parametros de apps/web/src/server/auth/password.ts — NAO mude aqui
// sem mudar la tambem, ou os dois lados do login divergem.
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;

const TECLA_CTRL_C = String.fromCharCode(3);
const TECLA_BACKSPACE_DEL = String.fromCharCode(127);
const TECLA_BACKSPACE_ANTIGA = String.fromCharCode(8);

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEYLEN, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), derived.toString("base64")].join("$");
}

/**
 * Pergunta um valor no terminal SEM ecoar o que a pessoa digita — modo raw do
 * stdin, lendo tecla por tecla, em vez do `readline` padrao (que so sabe
 * ecoar tudo ou nada, e nenhuma opcao oficial de mascarar). Enter termina,
 * Backspace apaga, Ctrl+C cancela o processo como qualquer outro programa.
 */
function perguntarSenha(pergunta) {
  return new Promise((resolve, reject) => {
    process.stdout.write(pergunta);
    if (!process.stdin.isTTY) {
      reject(new Error("precisa rodar num terminal interativo, nao redirecionado"));
      return;
    }
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    let valor = "";
    function aoDigitar(char) {
      if (char === TECLA_CTRL_C) {
        process.stdin.setRawMode(false);
        process.stdout.write("\n");
        process.exit(130);
      } else if (char === "\r" || char === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", aoDigitar);
        process.stdout.write("\n");
        resolve(valor);
      } else if (char === TECLA_BACKSPACE_DEL || char === TECLA_BACKSPACE_ANTIGA) {
        valor = valor.slice(0, -1);
      } else {
        valor += char;
      }
    }
    process.stdin.on("data", aoDigitar);
  });
}

async function main() {
  const alvo = process.argv[2];
  if (!alvo) {
    console.log("uso: node scripts/trocar-senha.mjs <usuario|email>");
    process.exitCode = 1;
    return;
  }

  const usuario = await prisma.user.findFirst({
    where: { OR: [{ username: alvo }, { email: alvo }] },
    select: { id: true, username: true, displayName: true, email: true },
  });
  if (!usuario) {
    console.log(`nao achei ninguem com usuario ou email "${alvo}"`);
    process.exitCode = 1;
    return;
  }

  console.log(`Trocando a senha de ${usuario.displayName} (@${usuario.username}, ${usuario.email}).`);
  const senha1 = await perguntarSenha("Nova senha (8-200 caracteres, nao aparece na tela): ");
  if (senha1.length < 8 || senha1.length > 200) {
    console.log("senha precisa ter entre 8 e 200 caracteres.");
    process.exitCode = 1;
    return;
  }
  const senha2 = await perguntarSenha("Digite de novo para confirmar: ");
  if (senha1 !== senha2) {
    console.log("as duas nao bateram. Nada foi alterado.");
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(senha1);

  /**
   * Troca a senha E revoga toda sessao viva, na mesma transacao — mesma
   * doutrina do reset por e-mail (`resetPasswordAction`): quem troca senha
   * costuma estar tirando alguem de dentro, e uma sessao antiga sobrevivendo
   * a troca anularia o proposito dela.
   */
  const [, sessoes] = await prisma.$transaction([
    prisma.user.update({ where: { id: usuario.id }, data: { passwordHash } }),
    prisma.session.updateMany({
      where: { userId: usuario.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  console.log(`Senha trocada. ${sessoes.count} sessao(oes) antiga(s) revogada(s) — login de novo em todo lugar.`);
}

main()
  .catch((erro) => {
    console.error("falhou:", erro.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
