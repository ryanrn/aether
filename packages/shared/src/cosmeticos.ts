import { planoAtende, type PlanTier } from "./plans";

/**
 * Cosmeticos de perfil — hoje molduras de avatar; amanha badges e efeitos.
 *
 * O CATALOGO MORA EM CODIGO, e nao no banco. Uma moldura e uma definicao
 * visual, e linha de banco guardaria uma string de CSS — ai o visual do app
 * virava dado editavel, com tudo que isso traz (injecao, migracao, revisao).
 * O banco guarda apenas QUAL a pessoa escolheu.
 *
 * E o mesmo desenho de `plans.ts`: a escada e codigo, a assinatura e banco.
 *
 * AQUI FICA SO O QUE O SERVIDOR PRECISA SABER: que a moldura existe e qual
 * plano a libera. O visual (cor, gradiente, espessura) mora em
 * `apps/web/src/components/ui/molduras.ts`, porque o Tailwind so gera classe
 * que ele encontra escrita nos arquivos que varre — e ele nao varre este
 * pacote. Classe declarada aqui simplesmente nao existiria no CSS final.
 *
 * PARA ADICIONAR UMA MOLDURA: uma entrada aqui e uma no mapa de estilo. A
 * regra de plano ja e generica e nao muda.
 */

export interface Moldura {
  id: string;
  /** o nome que a pessoa le na tela */
  nome: string;
  /** plano MINIMO que libera. `FREE` = todo mundo tem. */
  tier: PlanTier;
}

/**
 * As molduras, da mais simples para a mais chamativa.
 *
 * A ESCADA DE COR SEGUE A DO SELO, de proposito: arroxeado no Olimpo, dourado
 * no Olimpo Pro. Quem olha entende a hierarquia sem ler o nome — foi a
 * promessa feita no comentario do `SeloPlano` quando ele nasceu.
 *
 * Ha UMA moldura gratuita de proposito. Quem nao paga precisa poder mexer no
 * proprio perfil e ver o recurso existir; catalogo inteiro trancado nao vende,
 * so avisa que voce nao pertence.
 */
export const MOLDURAS: readonly Moldura[] = [
  { id: "bronze", nome: "Bronze", tier: "FREE" },
  { id: "eter", nome: "Eter", tier: "PLUS" },
  { id: "aurora", nome: "Aurora", tier: "PLUS" },
  { id: "louro", nome: "Louro", tier: "PRO" },
  { id: "olimpo", nome: "Olimpo", tier: "PRO" },
] as const;

const POR_ID = new Map(MOLDURAS.map((m) => [m.id, m]));

export function molduraPorId(id: string | null | undefined): Moldura | null {
  if (!id) return null;
  return POR_ID.get(id) ?? null;
}

/**
 * A moldura que de fato vale AGORA, dado o plano de quem a escolheu.
 *
 * Resolvida na LEITURA, como `planoEfetivo`. Quem deixa de pagar para de
 * exibir a moldura paga, mas a ESCOLHA continua guardada: reativando, ela volta
 * sozinha, sem a pessoa precisar lembrar qual era.
 *
 * A alternativa — seguir exibindo — abriria assinar um mes, escolher a moldura
 * e cancelar. Cosmetico que nao expira nao e cosmetico de assinatura: e compra
 * unica com o nome errado.
 *
 * Id desconhecido devolve `null` em vez de lancar: uma moldura retirada do
 * catalogo nao pode quebrar a tela de quem a tinha escolhido.
 */
export function molduraEfetiva(
  id: string | null | undefined,
  plano: PlanTier,
): Moldura | null {
  const moldura = molduraPorId(id);
  if (!moldura) return null;
  return planoAtende(plano, moldura.tier) ? moldura : null;
}

/** As molduras que este plano pode escolher — o que a tela mostra destravado. */
export function moldurasDoPlano(plano: PlanTier): Moldura[] {
  return MOLDURAS.filter((m) => planoAtende(plano, m.tier));
}

/**
 * Avatar animado (GIF) e exclusivo do plano de cima.
 *
 * Funcao, e nao comparacao solta espalhada: quando entrar "banner animado" ou
 * "efeito de avatar", a regra de quem pode enviar movimento fica num lugar so.
 */
export function podeAvatarAnimado(plano: PlanTier): boolean {
  return planoAtende(plano, "PRO");
}

/* ---------------------------------------------------------------------------
 * Cosmeticos com asset (cadastrados pela equipe, arquivo no R2)
 *
 * Escopo: DECORACAO em volta do avatar e BANNER do perfil. So isso.
 *
 * Diferente das MOLDURAS acima (aneis em gradiente CSS, catalogo em codigo,
 * fixas): estes a equipe cria e publica pelo painel, sem deploy — o binario e
 * uma imagem no Cloudflare R2 e o banco (`model Cosmetic`) guarda so os
 * metadados.
 *
 * O que fica AQUI e o que os dois lados (painel e app) precisam concordar sem
 * consultar o banco: as categorias, a escada de raridade, a pasta de cada tipo
 * no bucket e as regras de dimensao de cada um.
 * ------------------------------------------------------------------------- */

/**
 * A CATEGORIA de um cosmetico. Espelha o enum `CosmeticType` do Prisma — o
 * shared nao importa `@aether/db` (direcao de dependencia), entao a uniao e
 * declarada aqui, do mesmo jeito que `MessageRow` em `types.ts`.
 */
export const COSMETIC_TYPES = ["DECORATION", "BANNER"] as const;
export type CosmeticType = (typeof COSMETIC_TYPES)[number];

export function ehCosmeticType(valor: unknown): valor is CosmeticType {
  return (
    typeof valor === "string" &&
    (COSMETIC_TYPES as readonly string[]).includes(valor)
  );
}

/** O rotulo em portugues de cada categoria, para o painel e a loja. */
export const ROTULO_COSMETIC_TYPE: Record<CosmeticType, string> = {
  DECORATION: "Decoracao do avatar",
  BANNER: "Banner do perfil",
};

/**
 * A PASTA de cada tipo dentro do bucket — `cosmetics/<pasta>/...`.
 *
 * Fixa e plural, como o exemplo da spec (`cosmetics/decorations/`). O storage
 * monta a chave a partir disto; nao inventa caminho por conta propria.
 */
export const PASTA_DO_COSMETICO: Record<CosmeticType, string> = {
  DECORATION: "decorations",
  BANNER: "banners",
};

/**
 * As regras de DIMENSAO de cada tipo, checadas no envio (com `sharp`) e
 * mostradas no painel antes.
 *
 *  - DECORATION: perto de quadrada. Ela abraca um circulo — arte alongada nao
 *    encaixa. A spec pede ~512x512 (ou 640 com sangria), miolo transparente.
 *  - BANNER: 3:1, como o resto do mercado. ~1500x500.
 *
 * `ladoMin` evita arte que some na tela; `ladoMax` evita peso a toa (o R2
 * serve isto com CDN, mas 8000px de PNG ainda e download pesado).
 */
export interface RegraDeDimensao {
  ratioMin: number;
  ratioMax: number;
  ladoMin: number;
  ladoMax: number;
  /** o alvo, em texto, para o painel dizer o que enviar */
  alvo: string;
}

export const COSMETIC_REGRAS: Record<CosmeticType, RegraDeDimensao> = {
  DECORATION: {
    ratioMin: 0.9,
    ratioMax: 1.11,
    ladoMin: 256,
    ladoMax: 4096,
    /**
     * A geometria vem do renderer (`<AvatarDecorado>`): a camada e desenhada a
     * 178% da footprint. Com um miolo transparente de Ø288 (56% do lado) a arte
     * encosta na borda da foto e entra alguns px nela (abraca), e sobra ~39%
     * para fora de cada lado. Abertura MAIOR que isso -> a decoracao flutua com
     * folga; a arte tem que SANGRAR ate as 4 bordas do canvas.
     */
    alvo:
      "quadrada 512x512, PNG/WEBP RGBA. Miolo circular central de Ø288 (56% " +
      "do lado, centrado) 100% transparente — e onde entra a foto. A decoracao " +
      "vai desse circulo ate SANGRAR nas 4 bordas do canvas (sem margem " +
      "transparente em volta). Sem sombra projetada para fora.",
  },
  BANNER: {
    ratioMin: 2.6,
    ratioMax: 3.4,
    ladoMin: 600,
    ladoMax: 4096,
    alvo: "3:1, ~1500x500, PNG ou WEBP",
  },
};

/**
 * A escada de raridade — catalogo em codigo, guardada como id de texto na
 * coluna `Cosmetic.raridade` (ganha degrau sem migracao).
 *
 * Os nomes e a ordem seguem o mock da Loja (`common`..`mythic`). A cor e
 * CATEGORICA e dessaturada — sempre acompanha um rotulo, nunca aparece
 * sozinha —, para nao competir com o accent nem com o `SeloPlano`.
 *
 * `peso` so ordena (raro por cima); nao governa drop nem preco.
 */
export interface Raridade {
  id: string;
  nome: string;
  peso: number;
  /** hex, para o chip/rotulo. Igual as vars `--r-*` do mock. */
  cor: string;
}

export const RARIDADES: readonly Raridade[] = [
  { id: "common", nome: "Comum", peso: 1, cor: "#8b929c" },
  { id: "rare", nome: "Raro", peso: 2, cor: "#5e9cc9" },
  { id: "epic", nome: "Epico", peso: 3, cor: "#b98cf0" },
  { id: "legendary", nome: "Lendario", peso: 4, cor: "#e5a94e" },
  { id: "mythic", nome: "Mitico", peso: 5, cor: "#e5626b" },
] as const;

const RARIDADE_POR_ID = new Map(RARIDADES.map((r) => [r.id, r]));

export function raridadePorId(id: string | null | undefined): Raridade | null {
  if (!id) return null;
  return RARIDADE_POR_ID.get(id) ?? null;
}

export function ehRaridade(valor: unknown): valor is string {
  return typeof valor === "string" && RARIDADE_POR_ID.has(valor);
}

/**
 * O cosmetico como o APP o consome: metadados + a URL do asset no CDN. Nunca
 * carrega chave de bucket nem nada de admin (quem criou, rascunhos, preco
 * interno). Montado no servidor a partir de `Cosmetic`, para o app so
 * renderizar.
 */
export interface PublicCosmetic {
  id: string;
  slug: string;
  nome: string;
  descricao: string | null;
  tipo: CosmeticType;
  raridade: string;
  precoMoedas: number | null;
  tierMinimo: PlanTier;
  /**
   * A camada PRINCIPAL. Banner: e o banner. Decoracao de uma camada: a peca
   * inteira. Decoracao de duas camadas: a da FRENTE (sobre o avatar).
   */
  assetUrl: string;
  /**
   * A camada de TRAS de uma decoracao (atras do avatar) — so quando a arte
   * tem duas partes, como uma coroa cujo aro passa por tras da cabeca. `null`
   * em banner e em decoracao de uma camada.
   */
  assetTrasUrl: string | null;
  thumbUrl: string | null;
  largura: number | null;
  altura: number | null;
}

/**
 * O cosmetico como o PAINEL DA EQUIPE o ve — tudo, inclusive rascunho, quem
 * criou e os carimbos de tempo. Nunca vai para o app do usuario.
 */
export interface CosmeticoNoPainel {
  id: string;
  slug: string;
  nome: string;
  descricao: string | null;
  tipo: CosmeticType;
  raridade: string;
  precoMoedas: number | null;
  tierMinimo: PlanTier;
  ativo: boolean;
  ordem: number;
  assetUrl: string;
  assetTrasUrl: string | null;
  thumbUrl: string | null;
  largura: number | null;
  altura: number | null;
  criadoPor: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

/**
 * O cosmetico como a LOJA / o seletor do perfil o ve: o publico + o estado
 * desta pessoa.
 *
 *  - `bloqueado`: o plano nao alcanca o `tierMinimo` — nao da para equipar.
 *  - `possui`: da para equipar. Peca gratis com o plano ok ja conta como
 *    possuida; peca paga precisa de uma linha em `UserCosmetic` (loja ou
 *    concessao da equipe).
 *  - `equipado`: e o que esta valendo agora.
 */
export interface CosmeticoDeLoja extends PublicCosmetic {
  possui: boolean;
  bloqueado: boolean;
  equipado: boolean;
}

/**
 * A DECORACAO que viaja no `PublicUser` — so as duas URLs, ja RESOLVIDAS contra
 * o plano e contra `Cosmetic.ativo`. Nada de slug, nome ou raridade: a tela so
 * precisa renderizar as camadas, e isto acompanha a pessoa em toda mensagem.
 */
export interface DecoracaoPublica {
  frente: string;
  tras: string | null;
}

/** O que o `select` traz da relacao `User.decoracao` — linha crua. */
export interface DecoracaoRow {
  assetUrl: string;
  assetTrasUrl: string | null;
  tierMinimo: PlanTier;
  ativo: boolean;
}

/**
 * A decoracao que de fato VALE agora — resolvida na leitura, como
 * `molduraEfetiva`. Desativada no catalogo, ou acima do plano de quem a
 * escolheu: some da tela, a escolha continua no banco.
 */
export function decoracaoEfetiva(
  row: DecoracaoRow | null | undefined,
  plano: PlanTier,
): DecoracaoPublica | null {
  if (!row || !row.ativo) return null;
  if (!planoAtende(plano, row.tierMinimo)) return null;
  return { frente: row.assetUrl, tras: row.assetTrasUrl };
}
