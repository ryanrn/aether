/**
 * O VISUAL de cada moldura de avatar.
 *
 * Separado do catalogo em `@aether/shared` de proposito, e nao por gosto de
 * dividir arquivo: o Tailwind so gera a classe que encontra ESCRITA nos
 * arquivos que varre, e ele nao varre `packages/shared`. Uma classe declarada
 * la simplesmente nao existiria no CSS final — e o defeito apareceria como
 * "a moldura nao aparece", sem erro nenhum para seguir.
 *
 * O shared responde "quais molduras existem e quem pode usar" (o servidor
 * precisa disso para autorizar). Este arquivo responde "como cada uma se
 * parece". Uma moldura nova precisa de uma entrada nos dois.
 *
 * COMO O ANEL FUNCIONA: e um elemento ATRAS do avatar e um pouco maior. O
 * miolo fica coberto pela propria imagem, entao so a borda aparece. Assim a
 * moldura nunca corta nem deforma a foto — ela nao passa por cima de nada.
 * Gradiente sai de graca, porque o elemento inteiro e pintado e so a beirada
 * fica visivel.
 */
export const MOLDURA_ESTILO: Record<string, string> = {
  bronze: "bg-[linear-gradient(135deg,#a97142,#d8a06a)]",
  eter: "bg-accent-400",
  aurora: "bg-[linear-gradient(135deg,var(--color-accent-400),#38bdf8)]",
  louro: "bg-[linear-gradient(135deg,#fcd34d,#f59e0b)]",
  /**
   * A unica conica: e a moldura do topo, e precisa parecer diferente de longe,
   * nao so mais bonita de perto.
   */
  olimpo:
    "bg-[conic-gradient(from_180deg,#fcd34d,var(--color-accent-400),#fcd34d)]",
};

/**
 * O quanto o anel escapa do avatar, por tamanho.
 *
 * Proporcional de proposito: 3px em volta de um avatar de 24px domina a
 * imagem, e o mesmo 3px em volta de um de 64px quase nao se ve.
 */
export const MOLDURA_ESPESSURA = {
  xs: "-inset-[2px]",
  sm: "-inset-[2px]",
  md: "-inset-[3px]",
  lg: "-inset-[4px]",
} as const;

/**
 * O arredondamento do anel, um degrau acima do avatar.
 *
 * Como o anel e MAIOR que o avatar, repetir o mesmo raio deixaria os cantos
 * visivelmente mais quadrados que os da foto. Redondo continua redondo.
 */
export const MOLDURA_RAIO = {
  quadrado: { xs: "rounded-[8px]", sm: "rounded-[8px]", md: "rounded-[9px]", lg: "rounded-[10px]" },
  redondo: "rounded-full",
} as const;
