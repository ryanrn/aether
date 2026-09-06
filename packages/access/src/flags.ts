import { prisma } from "@aether/db";
import { log } from "@aether/shared/log";
import {
  CHAVES_DE_FLAG,
  FLAGS_CONHECIDAS,
  padraoDaFlag,
  type ChaveDeFlag,
  type FlagParaAdmin,
} from "@aether/shared";

export type { FlagParaAdmin };

/**
 * Leitura e escrita de feature flag / kill switch, de um lugar so.
 *
 * MORA EM `@aether/access` pela mesma razao das permissoes e do plano: web e
 * gateway precisam responder IGUAL. Um `voice:join` recusado de um lado e
 * liberado do outro seria a mesma classe de bug de uma permissao divergente.
 *
 * O REGISTRO DAS CHAVES esta em `@aether/shared/flags` (isomorfico, o cliente
 * usa para esconder botao). Aqui so mora o acesso ao banco e o cache.
 */

/** Quanto tempo um valor lido vale antes de reconsultar o banco. */
const TTL_CACHE_MS = 5_000;

interface EntradaDeCache {
  ligado: boolean;
  lidoEm: number;
}

const cache = new Map<ChaveDeFlag, EntradaDeCache>();

/**
 * O recurso desta chave esta ligado agora?
 *
 * CACHE DE 5s POR PROCESSO. Um kill switch com 5s de atraso e aceitavel: o
 * incidente que ele existe para conter (enxurrada de cadastro, raid) nao se
 * resolve em 5s de qualquer forma, e sem cache toda requisicao pagaria uma
 * consulta. No gateway (processo longo) o cache pega de verdade; no web
 * serverless ele so ajuda dentro de uma lambda quente — mas a correcao nao
 * depende disso.
 *
 * FALHA PARA O PADRAO, nao para "desligado". Um banco fora do ar nao pode, ele
 * proprio, derrubar o registro ou a voz em cima de tudo — a flag e resposta
 * DELIBERADA a incidente, nao uma dependencia de disponibilidade. Se a leitura
 * falha, devolve `padraoDaFlag(chave)` e loga.
 */
export async function flagLigada(chave: ChaveDeFlag): Promise<boolean> {
  const agora = Date.now();
  const emCache = cache.get(chave);
  if (emCache && agora - emCache.lidoEm < TTL_CACHE_MS) {
    return emCache.ligado;
  }

  try {
    const linha = await prisma.flag.findUnique({
      where: { chave },
      select: { ligado: true },
    });
    // Sem linha = ninguem mexeu = padrao do codigo.
    const ligado = linha ? linha.ligado : padraoDaFlag(chave);
    cache.set(chave, { ligado, lidoEm: agora });
    return ligado;
  } catch (error) {
    const padrao = padraoDaFlag(chave);
    log.error("flag.leitura_falhou", "não li a flag; usando o padrão", {
      err: error,
      chave,
      padrao,
    });
    return padrao;
  }
}

/**
 * Todas as flags conhecidas, para a tela da equipe — uma consulta, nao uma por
 * chave. Chave sem linha aparece com o padrao e `personalizada: false`.
 */
export async function lerFlagsParaAdmin(): Promise<FlagParaAdmin[]> {
  const linhas = await prisma.flag.findMany({
    select: {
      chave: true,
      ligado: true,
      atualizadoPor: true,
      atualizadoEm: true,
    },
  });
  const porChave = new Map(linhas.map((l) => [l.chave, l]));

  return CHAVES_DE_FLAG.map((chave) => {
    const linha = porChave.get(chave);
    const def = FLAGS_CONHECIDAS[chave];
    return {
      chave,
      rotulo: def.rotulo,
      descricao: def.descricao,
      padrao: def.padrao,
      ligado: linha ? linha.ligado : def.padrao,
      personalizada: Boolean(linha),
      atualizadoPor: linha?.atualizadoPor ?? null,
      atualizadoEm: linha?.atualizadoEm?.toISOString() ?? null,
    };
  });
}

/**
 * Vira uma flag. `upsert` porque a chave pode nunca ter tido linha.
 *
 * Invalida o cache DESTE processo na hora — o operador que acabou de virar o
 * switch na tela espera ver o efeito, nao esperar 5s. Os OUTROS processos
 * (outra lambda, outra maquina de gateway) ainda pegam pelo TTL.
 */
export async function definirFlag(
  chave: ChaveDeFlag,
  ligado: boolean,
  atualizadoPor: string | null,
): Promise<void> {
  await prisma.flag.upsert({
    where: { chave },
    create: { chave, ligado, atualizadoPor },
    update: { ligado, atualizadoPor },
  });
  cache.set(chave, { ligado, lidoEm: Date.now() });
  log.info("flag.alterada", "flag virada", { chave, ligado, atualizadoPor });
}

/** So para teste: zera o cache entre casos. */
export function _limparCacheDeFlags(): void {
  cache.clear();
}
