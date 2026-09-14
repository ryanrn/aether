import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cifrar, decifrar, prisma } from "@aether/db";
import { log } from "@aether/shared/log";
import {
  gerarSegredoTotp,
  uriDeProvisionamento,
  verificarTotp,
} from "@aether/shared/totp";

/**
 * Autenticacao de dois fatores (TOTP, RFC 6238) — implementacao propria, sem
 * biblioteca de terceiros (a matematica mora em `@aether/shared/totp`).
 *
 * TRES ESTADOS na mesma dupla de colunas, sem boolean separado (mesmo
 * desenho de `emailVerificadoEm`):
 *  - nunca configurado:  totpSecretCifrado = null,      totpHabilitadoEm = null
 *  - configuracao pendente (QR mostrado, aguardando confirmar): secretCifrado preenchido, habilitadoEm = null
 *  - ativo:               os dois preenchidos
 *
 * O SEGREDO E CIFRADO, NAO SO HASHEADO — precisa ser lido de volta a cada
 * login para recalcular o codigo, ao contrario de senha/codigo de backup
 * (que so precisam ser CONFERIDOS, nunca lidos). Mesma cifra que ja protege
 * o token OAuth das Conexoes (`@aether/db/secret-box`, AES-256-GCM).
 *
 * CODIGO DE BACKUP segue a doutrina do `PlanKey` (`services/planos.ts`): o
 * codigo em claro so existe no momento em que e gerado e mostrado; o banco
 * guarda so o sha256. Nao e hash lento (bcrypt/argon2) de proposito — um
 * codigo de backup tem entropia de token (32^10), nao de senha de humano;
 * hash lento so importa quando o segredo pode ser adivinhado.
 */

/** Alfabeto sem 0/O/1/I/L — mesmo motivo do `PlanKey`: menos erro de digitação. */
const ALFABETO_BACKUP = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** 5 a 10 códigos é a faixa recomendada; 10 dá mais fôlego pra quem demora a notar. */
const QUANTIDADE_CODIGOS_BACKUP = 10;
/** ±1 passo de 30s = até 90s de tolerância de relógio, o padrão do RFC 6238. */
const JANELA_TOTP = 1;

export class TotpNaoConfigurado extends Error {
  override name = "TotpNaoConfigurado";
}
export class TotpJaAtivo extends Error {
  override name = "TotpJaAtivo";
}
export class TotpCodigoInvalido extends Error {
  override name = "TotpCodigoInvalido";
}

function gerarCodigoDeBackup(): string {
  const bytes = randomBytes(10);
  let corpo = "";
  for (let i = 0; i < 10; i++) {
    corpo += ALFABETO_BACKUP[bytes[i]! % ALFABETO_BACKUP.length];
    if (i === 4) corpo += "-";
  }
  return corpo;
}

function normalizarCodigoDeBackup(codigo: string): string {
  return codigo.trim().toUpperCase().replace(/[\s-]/g, "");
}

function hashDoCodigoDeBackup(codigo: string): string {
  return createHash("sha256").update(normalizarCodigoDeBackup(codigo)).digest("hex");
}

/** Gera, hasheia e grava um lote novo — SUBSTITUI qualquer lote anterior. */
async function substituirCodigosDeBackup(userId: string): Promise<string[]> {
  const codigos = Array.from({ length: QUANTIDADE_CODIGOS_BACKUP }, gerarCodigoDeBackup);
  await prisma.$transaction([
    prisma.totpBackupCode.deleteMany({ where: { userId } }),
    prisma.totpBackupCode.createMany({
      data: codigos.map((codigo) => ({
        userId,
        codigoHash: hashDoCodigoDeBackup(codigo),
      })),
    }),
  ]);
  return codigos;
}

export interface EstadoTotp {
  /** Existe segredo gravado — pendente ou ativo. */
  configurado: boolean;
  /** So `true` quando o login de fato passou a exigir o segundo fator. */
  habilitado: boolean;
  /** Quantos codigos de backup ainda nao foram usados. */
  codigosDeBackupRestantes: number;
}

export async function estadoTotp(userId: string): Promise<EstadoTotp> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { totpSecretCifrado: true, totpHabilitadoEm: true },
  });
  const codigosDeBackupRestantes = await prisma.totpBackupCode.count({
    where: { userId, usadoEm: null },
  });
  return {
    configurado: user.totpSecretCifrado !== null,
    habilitado: user.totpSecretCifrado !== null && user.totpHabilitadoEm !== null,
    codigosDeBackupRestantes,
  };
}

/**
 * Comeca (ou recomeca) a configuracao: gera um segredo novo, cifra e grava
 * como PENDENTE (habilitadoEm continua nulo at o `confirmarConfiguracao`).
 * Chamar de novo antes de confirmar sobrescreve o segredo pendente anterior
 * — nao ha nada confirmado para perder.
 */
export async function iniciarConfiguracao(
  userId: string,
  contaParaExibir: string,
): Promise<{ segredoBase32: string; otpauthUri: string }> {
  const jaAtivo = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { totpHabilitadoEm: true },
  });
  if (jaAtivo.totpHabilitadoEm !== null) throw new TotpJaAtivo();

  const segredoBase32 = gerarSegredoTotp();
  await prisma.user.update({
    where: { id: userId },
    data: { totpSecretCifrado: cifrar(segredoBase32), totpUltimoPassoUsado: null },
  });

  return {
    segredoBase32,
    otpauthUri: uriDeProvisionamento({
      segredoBase32,
      conta: contaParaExibir,
      emissor: "AETHER",
    }),
  };
}

/**
 * Confirma a configuracao pendente com o codigo que o autenticador mostrou.
 * So aqui o 2FA passa a valer — e so aqui os codigos de backup nascem.
 */
export async function confirmarConfiguracao(
  userId: string,
  codigo: string,
): Promise<string[]> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { totpSecretCifrado: true, totpHabilitadoEm: true },
  });
  if (user.totpSecretCifrado === null) throw new TotpNaoConfigurado();
  if (user.totpHabilitadoEm !== null) throw new TotpJaAtivo();

  const segredoBase32 = decifrar(user.totpSecretCifrado);
  const contador = verificarTotp(codigo, segredoBase32, { janela: JANELA_TOTP });
  if (contador === null) throw new TotpCodigoInvalido();

  await prisma.user.update({
    where: { id: userId },
    data: { totpHabilitadoEm: new Date(), totpUltimoPassoUsado: contador },
  });

  return substituirCodigosDeBackup(userId);
}

/** Desativa por completo: some o segredo e todos os codigos de backup. */
export async function desativar(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        totpSecretCifrado: null,
        totpHabilitadoEm: null,
        totpUltimoPassoUsado: null,
      },
    }),
    prisma.totpBackupCode.deleteMany({ where: { userId } }),
  ]);
}

/** Novo lote de codigos de backup — os antigos somem, mesmo que nunca usados. */
export async function regenerarCodigosDeBackup(userId: string): Promise<string[]> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { totpHabilitadoEm: true },
  });
  if (user.totpHabilitadoEm === null) throw new TotpNaoConfigurado();
  return substituirCodigosDeBackup(userId);
}

/**
 * O segundo fator do LOGIN — chamado com o que a pessoa digitou, seja o
 * codigo de 6 digitos do autenticador ou um codigo de backup. Tenta TOTP
 * primeiro (formato reconhecivel: so digito); qualquer outra coisa tenta
 * como codigo de backup.
 *
 * Falha de decifrar o segredo (AUTH_SECRET rotacionado) nao lanca pra fora:
 * vira recusa registrada em log, do mesmo jeito que uma Conexao OAuth morta
 * — ver `packages/access/src/conexoes/armazenamento.ts`.
 */
export async function verificarCodigoDeLogin(
  userId: string,
  codigoDigitado: string,
): Promise<{ ok: true; usouCodigoDeBackup: boolean } | { ok: false; error: string }> {
  const limpo = codigoDigitado.trim();

  if (/^\d{6}$/.test(limpo)) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { totpSecretCifrado: true, totpHabilitadoEm: true, totpUltimoPassoUsado: true },
    });
    if (user.totpSecretCifrado === null || user.totpHabilitadoEm === null) {
      return { ok: false, error: "2FA nao esta ativo nesta conta." };
    }

    let segredoBase32: string;
    try {
      segredoBase32 = decifrar(user.totpSecretCifrado);
    } catch (erro) {
      log.error("web.totp.decifrar", "nao consegui decifrar o segredo TOTP", {
        err: erro,
        userId,
      });
      return { ok: false, error: "Algo deu errado. Tente de novo ou use um codigo de backup." };
    }

    const contador = verificarTotp(limpo, segredoBase32, { janela: JANELA_TOTP });
    const ultimoUsado = user.totpUltimoPassoUsado;
    if (contador === null || (ultimoUsado !== null && contador <= ultimoUsado)) {
      return { ok: false, error: "Codigo invalido." };
    }

    await prisma.user.update({
      where: { id: userId },
      data: { totpUltimoPassoUsado: contador },
    });
    return { ok: true, usouCodigoDeBackup: false };
  }

  // Nao tem formato de TOTP: tenta como codigo de backup.
  const atualizado = await prisma.totpBackupCode.updateMany({
    where: { userId, codigoHash: hashDoCodigoDeBackup(limpo), usadoEm: null },
    data: { usadoEm: new Date() },
  });
  if (atualizado.count === 0) return { ok: false, error: "Codigo invalido." };
  return { ok: true, usouCodigoDeBackup: true };
}
