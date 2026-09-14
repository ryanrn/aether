import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@aether/db";

/**
 * A ponte entre "o login Google terminou no navegador do sistema" e "a janela
 * do Electron precisa da sessao" — ver o comment de `CodigoLoginDesktop` no
 * schema pra entender POR QUE essa ponte existe (o Google recusa OAuth numa
 * webview embutida).
 *
 * Mesma doutrina do `criarTokenDeVerificacao`/`consumirTokenDeVerificacao`
 * (`@aether/access/verificacao`): o codigo em claro so existe no momento em
 * que sai daqui pro redirect — o banco guarda so o sha256. Vida de 60s: a
 * unica janela de uso legitima e o tempo do proprio navegador redirecionar
 * pro `aether://login-callback/<codigo>`.
 */

const VALIDADE_MS = 60_000;

function hashDoCodigo(codigo: string): string {
  return createHash("sha256").update(codigo).digest("hex");
}

/** Cria um codigo de uso unico pra este usuario. Devolve o valor EM CLARO. */
export async function criarCodigoLoginDesktop(userId: string): Promise<string> {
  const codigo = randomBytes(24).toString("base64url");
  await prisma.codigoLoginDesktop.create({
    data: {
      userId,
      codeHash: hashDoCodigo(codigo),
      expiresAt: new Date(Date.now() + VALIDADE_MS),
    },
  });
  return codigo;
}

/**
 * Consome o codigo — uso unico, curto. `null` quando invalido, expirado ou ja
 * usado (a pagina de destino trata os tres do mesmo jeito: manda pro login de
 * novo, sem distinguir o motivo pra quem esta so tentando entrar).
 */
export async function consumirCodigoLoginDesktop(
  codigo: string,
): Promise<string | null> {
  if (!codigo || typeof codigo !== "string") return null;

  const linha = await prisma.codigoLoginDesktop.findUnique({
    where: { codeHash: hashDoCodigo(codigo) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });
  if (!linha || linha.usedAt || linha.expiresAt.getTime() < Date.now()) {
    return null;
  }

  await prisma.codigoLoginDesktop.update({
    where: { id: linha.id },
    data: { usedAt: new Date() },
  });
  return linha.userId;
}
