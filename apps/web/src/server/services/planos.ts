import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@aether/db";
import { PLAN_ORDER, planoEfetivo, type PlanTier } from "@aether/shared";

/**
 * Chaves de plano: criar e resgatar.
 *
 * O CODIGO NUNCA E GUARDADO. Guardamos o sha256, do mesmo jeito que o token de
 * recuperacao de senha — uma chave e credencial ao portador, e quem lesse a
 * tabela num vazamento teria plano de graca. O codigo aparece uma vez, na
 * criacao, e depois so existe com quem recebeu.
 *
 * O RESGATE E ATOMICO pelo mesmo motivo que o convite: duas pessoas resgatando
 * a mesma chave de uso unico no mesmo instante leriam `usos = 0` as duas, e as
 * duas passariam. A condicao vai no WHERE do `updateMany`, onde o banco a
 * avalia sob trava de linha.
 */

/** Quantos caracteres do codigo ficam em claro, so para reconhecer a chave. */
const TAMANHO_DO_PREFIXO = 4;

/**
 * Cada recusa e um tipo, e cada tipo carrega o proprio `name`.
 *
 * O `name` nao e enfeite: sem ele, `String(erro)` de qualquer uma delas sai
 * como "Error", e um log de resgate recusado nao diz qual foi o motivo. Ja
 * custou uma leitura errada de teste aqui.
 */
export class ChaveInvalida extends Error {
  override name = "ChaveInvalida";
}
export class ChaveEsgotada extends Error {
  override name = "ChaveEsgotada";
}
export class ChaveVencida extends Error {
  override name = "ChaveVencida";
}
export class ChaveRevogada extends Error {
  override name = "ChaveRevogada";
}
export class ChaveJaResgatada extends Error {
  override name = "ChaveJaResgatada";
}

/**
 * O codigo como a pessoa ve: `AETHER-XXXX-XXXX-XXXX`.
 *
 * Alfabeto sem `0`, `O`, `1`, `I` e `L` de proposito: chave se le em voz alta e
 * se digita a mao, e esses cinco sao onde o erro acontece. Perder 5 simbolos
 * custa pouca entropia (ainda sao 31^12, ~10^17 combinacoes) e evita o suporte
 * de "digitei certo e nao funciona".
 */
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function gerarCodigo(): string {
  const bytes = randomBytes(12);
  let corpo = "";
  for (let i = 0; i < 12; i++) {
    // `%` sobre 256 enviesa levemente para o inicio do alfabeto. Aceitavel
    // aqui: nao e chave criptografica, e a entropia sobra com folga.
    corpo += ALFABETO[bytes[i]! % ALFABETO.length];
    if (i % 4 === 3 && i < 11) corpo += "-";
  }
  return `AETHER-${corpo}`;
}

function hashDoCodigo(codigo: string): string {
  return createHash("sha256").update(normalizar(codigo)).digest("hex");
}

/**
 * Aceita o codigo do jeito que a pessoa digitou.
 *
 * Maiusculas, sem espaco e sem hifen: quem cola de um chat traz espaco no fim,
 * quem digita a mao erra o hifen, e recusar por isso seria recusar quem tem a
 * chave certa.
 */
function normalizar(codigo: string): string {
  return codigo.trim().toUpperCase().replace(/[\s-]/g, "");
}

export interface ChaveCriada {
  id: string;
  /** O codigo em claro. So existe AQUI, e nao da para recuperar depois. */
  codigo: string;
  tier: PlanTier;
  dias: number | null;
  maxUsos: number;
}

export async function criarChave(params: {
  tier: PlanTier;
  dias?: number | null;
  maxUsos?: number;
  /** ate quando a chave aceita resgate */
  validaPorDias?: number | null;
  criadaPor?: string;
  motivo?: string;
}): Promise<ChaveCriada> {
  const codigo = gerarCodigo();
  const chave = await prisma.planKey.create({
    data: {
      codigoHash: hashDoCodigo(codigo),
      prefixo: normalizar(codigo).slice(6, 6 + TAMANHO_DO_PREFIXO),
      tier: params.tier,
      dias: params.dias ?? null,
      maxUsos: params.maxUsos ?? 1,
      expiraEm: params.validaPorDias
        ? new Date(Date.now() + params.validaPorDias * 24 * 60 * 60 * 1000)
        : null,
      criadaPor: params.criadaPor ?? null,
      motivo: params.motivo ?? null,
    },
    select: { id: true },
  });

  return {
    id: chave.id,
    codigo,
    tier: params.tier,
    dias: params.dias ?? null,
    maxUsos: params.maxUsos ?? 1,
  };
}

export type EstadoDaChave = "ativa" | "revogada" | "vencida" | "esgotada";

export interface ChaveNaLista {
  id: string;
  prefixo: string;
  tier: PlanTier;
  dias: number | null;
  usos: number;
  maxUsos: number;
  expiraEm: string | null;
  motivo: string | null;
  criadaPor: string | null;
  criadaEm: string;
  estado: EstadoDaChave;
}

/** As chaves ja criadas — sem o codigo, que so existiu na criacao. */
export async function listarChaves(limite = 60): Promise<ChaveNaLista[]> {
  const linhas = await prisma.planKey.findMany({
    orderBy: { createdAt: "desc" },
    take: limite,
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
      criadaPor: true,
      createdAt: true,
    },
  });

  const agora = Date.now();
  return linhas.map((c) => ({
    id: c.id,
    prefixo: c.prefixo,
    tier: c.tier,
    dias: c.dias,
    usos: c.usos,
    maxUsos: c.maxUsos,
    expiraEm: c.expiraEm ? c.expiraEm.toISOString() : null,
    motivo: c.motivo,
    criadaPor: c.criadaPor,
    criadaEm: c.createdAt.toISOString(),
    estado: c.revogadaEm
      ? "revogada"
      : c.expiraEm && c.expiraEm.getTime() <= agora
        ? "vencida"
        : c.usos >= c.maxUsos
          ? "esgotada"
          : "ativa",
  }));
}

/**
 * Cancela uma chave. Marca `revogadaEm` em vez de apagar — quem JA resgatou
 * continua com o plano; revogar so impede novos resgates, e o historico
 * segue dizendo que a chave existiu.
 *
 * Devolve o que foi revogado (ou `null` se a chave nao existia ou ja estava
 * revogada) — sem isto a action nao tinha o que logar, e essa era a UNICA
 * acao destrutiva do painel sem rastro nenhum, nem informal, de quem fez.
 */
export async function revogarChave(
  id: string,
): Promise<{ prefixo: string; tier: PlanTier } | null> {
  const linha = await prisma.planKey.findUnique({
    where: { id },
    select: { prefixo: true, tier: true, revogadaEm: true },
  });
  if (!linha || linha.revogadaEm) return null;

  const feito = await prisma.planKey.updateMany({
    where: { id, revogadaEm: null },
    data: { revogadaEm: new Date() },
  });
  if (feito.count === 0) return null;

  return { prefixo: linha.prefixo, tier: linha.tier };
}

export interface ResgateFeito {
  tier: PlanTier;
  expiraEm: Date | null;
}

/**
 * Troca um codigo pelo plano.
 *
 * Devolve o que a conta passou a ter — que nao e necessariamente o que a chave
 * dava, porque quem ja tinha plano MELHOR nao e rebaixado.
 */
export async function resgatarChave(
  userId: string,
  codigoBruto: string,
): Promise<ResgateFeito> {
  const codigo = normalizar(codigoBruto);
  if (codigo.length === 0) throw new ChaveInvalida();

  const chave = await prisma.planKey.findUnique({
    where: { codigoHash: hashDoCodigo(codigo) },
    select: {
      id: true,
      tier: true,
      dias: true,
      maxUsos: true,
      usos: true,
      expiraEm: true,
      revogadaEm: true,
    },
  });

  /**
   * Codigo que nao existe e codigo revogado dao erros DIFERENTES de proposito.
   *
   * Aqui nao ha risco de enumeracao como em login: uma chave e aleatoria entre
   * 10^17, e ninguem descobre a existencia dela por tentativa. Dizer "esta
   * revogada" poupa a pessoa de achar que digitou errado e tentar dez vezes.
   */
  if (!chave) throw new ChaveInvalida();
  if (chave.revogadaEm) throw new ChaveRevogada();
  if (chave.expiraEm && chave.expiraEm.getTime() <= Date.now()) {
    throw new ChaveVencida();
  }
  if (chave.usos >= chave.maxUsos) throw new ChaveEsgotada();

  const agora = new Date();
  const validade = chave.dias
    ? new Date(agora.getTime() + chave.dias * 24 * 60 * 60 * 1000)
    : null;

  return prisma.$transaction(async (tx) => {
    /**
     * A RESERVA VEM PRIMEIRO, e a condicao vai no WHERE.
     *
     * A checagem la em cima le fora da transacao e serve so para dar erro
     * bonito. Quem de fato impede o uso a mais e este `updateMany`: duas
     * chamadas simultaneas passariam pela leitura com `usos = 0`, e so uma sai
     * daqui com `count = 1`. Mesmo raciocinio, e mesmo formato, do resgate de
     * convite.
     */
    const { count } = await tx.planKey.updateMany({
      where: {
        id: chave.id,
        usos: { lt: chave.maxUsos },
        revogadaEm: null,
      },
      data: { usos: { increment: 1 } },
    });
    if (count === 0) throw new ChaveEsgotada();

    /**
     * O registro do resgate tem par unico `(chave, pessoa)`. E ele que impede
     * a mesma pessoa de consumir uma chave de campanha varias vezes — sem
     * isso, uma chave de 100 usos viraria 100 meses para uma conta so.
     */
    try {
      await tx.planKeyRedemption.create({
        data: {
          keyId: chave.id,
          userId,
          tierConcedido: chave.tier,
          expiraEm: validade,
        },
      });
    } catch (erro) {
      // P2002 = par unico violado: esta pessoa ja resgatou esta chave.
      if (
        typeof erro === "object" &&
        erro !== null &&
        (erro as { code?: string }).code === "P2002"
      ) {
        throw new ChaveJaResgatada();
      }
      throw erro;
    }

    const atual = await tx.subscription.findUnique({
      where: { userId },
      select: { tier: true, expiraEm: true },
    });
    const tierAtual = planoEfetivo(atual, agora);

    /**
     * COMO SOMA COM O QUE JA EXISTE.
     *
     * Duas regras, e as duas erram para o lado do cliente de proposito:
     *
     *  - o TIER fica o mais alto entre o que ele tinha e o que a chave da.
     *    Resgatar uma chave menor nunca rebaixa ninguem;
     *  - os DIAS somam ao que restava, em vez de substituir. Quem tinha 20
     *    dias e resgata 30 fica com 50, e nao com 30.
     *
     * A generosidade e deliberada: numa troca que a pessoa fez de propria
     * vontade, errar para menos gera reclamacao e desconfianca, e errar para
     * mais custa alguns dias. O caso torto que isso aceita — ter PRO e resgatar
     * uma chave PLUS, ganhando dias de PRO — e raro e barato perto de explicar
     * a alguem por que perdeu o que tinha.
     */
    const tierNovo =
      PLAN_ORDER.indexOf(chave.tier) > PLAN_ORDER.indexOf(tierAtual)
        ? chave.tier
        : tierAtual;

    let expiraEmNovo: Date | null;
    if (!chave.dias) {
      // Chave sem validade zera a data: virou permanente.
      expiraEmNovo = null;
    } else if (tierAtual !== "FREE" && atual?.expiraEm === null) {
      // Ja era permanente; dias nao tiram isso.
      expiraEmNovo = null;
    } else {
      const base =
        atual?.expiraEm && atual.expiraEm.getTime() > agora.getTime()
          ? atual.expiraEm
          : agora;
      expiraEmNovo = new Date(
        base.getTime() + chave.dias * 24 * 60 * 60 * 1000,
      );
    }

    await tx.subscription.upsert({
      where: { userId },
      create: {
        userId,
        tier: tierNovo,
        expiraEm: expiraEmNovo,
        motivo: `chave ${chave.id}`,
      },
      update: {
        tier: tierNovo,
        expiraEm: expiraEmNovo,
        motivo: `chave ${chave.id}`,
        // Resgate de chave desfaz o vinculo com provedor de cobranca, pelo
        // mesmo motivo da concessao a mao.
        provedor: null,
        idExterno: null,
      },
    });

    return { tier: tierNovo, expiraEm: expiraEmNovo };
  });
}
