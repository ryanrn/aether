export { PremiumShowcaseScreen } from "./premium-showcase-screen";

/**
 * So a tela de vitrine sai por aqui. `ComparisonTable` e `ResgatarChave` sao
 * importados direto do modulo de origem por quem precisa deles
 * (`premium-showcase-screen`, `settings/plano-tab`) — nao ha consumidor do
 * reexport, e um barril que lista tudo so cria a duvida de qual caminho usar.
 */
