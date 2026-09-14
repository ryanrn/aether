import { cn } from "@/lib/utils";

/**
 * Bloco pulsante — o tijolo de qualquer estado de carregamento.
 *
 * Existe porque o painel da equipe inteiro (8 abas) carregava com um
 * `<p>Carregando…</p>` sozinho: funciona, mas nao da nenhuma pista da FORMA
 * do que esta vindo, e pisca vazio->cheio de uma vez quando a lista chega.
 * Um esqueleto do tamanho aproximado da linha real reduz esse salto.
 */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      style={style}
      className={cn("animate-pulse rounded-md bg-base-800", className)}
    />
  );
}

/** N cartoes quadrados — o formato do grid da loja/catalogo de cosmeticos. */
export function SkeletonGrid({
  count = 6,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4",
        className,
      )}
      aria-hidden
    >
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton
          key={i}
          className="aspect-square w-full"
          style={{ opacity: 1 - (i % 4) * 0.1 } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

/**
 * N linhas do tamanho de uma linha de lista (`rounded-lg border`, como
 * `chaves-tab`/`flags-tab`/`jogos-tab` etc. desenham a propria lista) — o
 * formato mais comum no painel da equipe.
 */
export function SkeletonRows({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg border border-line-soft px-4 py-3"
          style={{ opacity: 1 - i * 0.12 }}
        >
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="ml-auto h-3.5 w-14" />
        </div>
      ))}
    </div>
  );
}
