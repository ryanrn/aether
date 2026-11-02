/**
 * Carencia que o gateway espera antes de anunciar OFFLINE (G-1). Os scripts
 * que esperam esse anuncio somam este valor ao prazo deles.
 *
 * MESMA regra de `apps/realtime/src/carencia-offline.ts`: padrao de 5 s,
 * `PRESENCA_CARENCIA_MS` muda, valor invalido cai no padrao. O script nao
 * importa o modulo do gateway (TypeScript) para continuar rodando com `node`
 * puro; se um mudar, o outro muda junto.
 */
export function carenciaMs() {
  const bruto = Number(process.env.PRESENCA_CARENCIA_MS ?? 5000);
  return Number.isFinite(bruto) && bruto >= 0 ? bruto : 5000;
}
