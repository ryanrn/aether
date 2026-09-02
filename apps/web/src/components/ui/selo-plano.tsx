import { AetherIcon, type AetherIconName } from "@/components/ui/aether-icon";
import { limitesDoPlano, type PlanTier } from "@aether/shared";
import { cn } from "@/lib/utils";

/**
 * O selo que diz que a conta e paga.
 *
 * POR QUE ELE IMPORTA MAIS DO QUE PARECE: quem paga precisa que os OUTROS
 * vejam. Metade do valor de um plano cosmetico e social — sem o selo, o
 * assinante paga e ninguem nota, e a proxima pessoa nao tem motivo para
 * assinar. Por isso ele nasce junto com o plano, e nao "depois, quando der".
 *
 * GRATUITO NAO TEM SELO, e isso e deliberado: marcar quem NAO paga com um
 * rotulo de ausencia e humilhacao de graca, e afasta em vez de atrair.
 *
 * O visual e proposital tambem — dourado no topo, arroxeado no meio. Quando
 * existirem moldura animada e banner, eles seguem esta mesma escada de cor,
 * para que a hierarquia seja legivel sem ler.
 */
export function SeloPlano({
  tier,
  tamanho = "md",
  className,
}: {
  tier: PlanTier | null | undefined;
  tamanho?: "sm" | "md";
  className?: string;
}) {
  if (!tier || tier === "FREE") return null;

  const limites = limitesDoPlano(tier);
  const nomeIcone: AetherIconName = tier === "PRO" ? "crown" : "sparkle";

  return (
    <span
      /**
       * `title` alem do texto visivel: no tamanho pequeno so aparece o
       * simbolo, e sem isto ele viraria um enfeite que ninguem sabe o que e.
       */
      title={`Assinante ${limites.rotulo}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-[4px] border font-bold uppercase tracking-[0.06em] align-middle",
        tier === "PRO"
          ? "border-amber-400/40 bg-amber-400/12 text-amber-300"
          : "border-accent-400/40 bg-accent-400/12 text-accent-300",
        tamanho === "sm"
          ? "px-1 py-[1px] text-[9px]"
          : "px-1.5 py-0.5 text-[10px]",
        className,
      )}
    >
      <AetherIcon
        name={nomeIcone}
        className={tamanho === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"}
        strokeWidth={2.5}
      />
      {/* No tamanho pequeno o texto sai: ao lado de um nome, o simbolo basta. */}
      {tamanho === "md" ? limites.rotulo : null}
    </span>
  );
}
