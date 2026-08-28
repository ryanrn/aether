export { PremiumShowcaseScreen } from "./premium-showcase-screen";
export {
  ComparisonTable,
  RECURSOS_PLANEJADOS,
  type RecursoPlanejado,
} from "./comparison-table";
export { ResgatarChave } from "./resgatar-chave";

/**
 * `ModalDeAssinatura` NAO e exportado: ele leva a um checkout que nao existe.
 *
 * O arquivo continua no repositorio porque o desenho dele serve para quando
 * houver provedor de pagamento — mas exportar seria convidar alguem a
 * pendura-lo num botao, e a pessoa que clicasse escolheria um plano que nunca
 * seria cobrado.
 */
