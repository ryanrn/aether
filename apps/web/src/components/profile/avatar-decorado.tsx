import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { UserStatus } from "@aether/shared";

/**
 * O AVATAR COM UMA DECORACAO por cima — e, quando a arte tem duas partes, uma
 * por tras.
 *
 * NAO mexe no `<Avatar>`: envolve. A arte da decoracao e desenhada num quadro
 * de 512px cujo miolo (Ø328 = 64,06%) fica reservado para a foto — entao a
 * foto entra num `<Avatar>` MENOR, centrado, e as camadas ocupam o quadro
 * inteiro. O ponto de status e o anel de moldura vem do proprio `<Avatar>` e
 * ficam colados na foto, como devem.
 *
 * `px` e o lado do QUADRO (a decoracao). Sem decoracao, use `<Avatar>` direto.
 */

/** A frente e (opcional) as costas de uma decoracao. URLs no R2/CDN. */
export interface DecoracaoDeAvatar {
  frenteUrl: string;
  trasUrl?: string | null;
}

/** Quanto da largura do quadro a foto ocupa — a spec da arte (Ø328 / 512). */
export const FOTO_NA_DECORACAO = 0.6406;

export function AvatarDecorado({
  decoracao,
  px,
  fundo,
  className,
  userId,
  name,
  src,
  status,
  moldura = null,
  round = true,
  ring,
}: {
  decoracao: DecoracaoDeAvatar;
  /** o lado do quadro da decoracao, em px */
  px: number;
  /** cor atras da decoracao — util no preview de arte transparente */
  fundo?: string;
  className?: string;
  userId: string;
  name: string;
  src?: string | null;
  status?: UserStatus;
  moldura?: string | null;
  round?: boolean;
  ring?: string;
}) {
  const foto = Math.round(px * FOTO_NA_DECORACAO);

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: px, height: px, background: fundo }}
    >
      {decoracao.trasUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={decoracao.trasUrl}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
        />
      ) : null}

      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <Avatar
          userId={userId}
          name={name}
          src={src}
          status={status}
          moldura={moldura}
          round={round}
          px={foto}
          ring={ring}
        />
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={decoracao.frenteUrl}
        alt=""
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full object-contain"
      />
    </div>
  );
}
