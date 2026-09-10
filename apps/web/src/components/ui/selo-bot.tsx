import type { UserKind } from "@aether/shared";
import { cn } from "@/lib/utils";

/**
 * O selo que diz que quem falou nao e gente.
 *
 * Sai ao lado do nome no chat e na lista de membros, no mesmo lugar do
 * `SeloPlano`. Requisito da Developer Platform: mensagem de bot tem de ser
 * reconhecivel na hora — sem isto o bot se passa por usuario.
 *
 * `HUMAN` -> nada (marcar quem NAO e bot seria ruido em toda mensagem).
 * `WEBHOOK` -> "via webhook" (nao e uma identidade, e um cano).
 * `BOT` -> "BOT".
 */
export function SeloBot({
  kind,
  className,
}: {
  kind: UserKind | null | undefined;
  className?: string;
}) {
  if (kind !== "BOT" && kind !== "WEBHOOK") return null;

  return (
    <span
      title={kind === "BOT" ? "Conta de bot" : "Mensagem enviada por webhook"}
      className={cn(
        "inline-flex shrink-0 items-center rounded-[4px] border px-1 py-[1px] align-middle text-[9px] font-bold uppercase tracking-[0.06em]",
        "border-ink-500/40 bg-ink-500/12 text-ink-300",
        className,
      )}
    >
      {kind === "BOT" ? "Bot" : "Webhook"}
    </span>
  );
}
