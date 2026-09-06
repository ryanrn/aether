/**
 * `register()` roda uma vez quando o servidor do Next sobe (Next 15, estavel).
 *
 * Aqui so ligamos o sink do Sentry no log estruturado, no runtime Node — o
 * mesmo `@aether/shared/sentry` que o gateway usa. `import` dinamico atras do
 * guard de runtime para o Edge nao tentar carregar `node:async_hooks`.
 *
 * Sem `SENTRY_DSN`, `criarSinkSentry` devolve `null` e nada acontece.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configurarLog, log } = await import("@aether/shared/log");
  const { criarSinkSentry } = await import("@aether/shared/sentry");

  const sink = criarSinkSentry({ servico: "web" });
  if (sink) configurarLog({ sink });

  log.info("web.observabilidade", "log estruturado ativo", {
    sentry: Boolean(sink),
  });
}
