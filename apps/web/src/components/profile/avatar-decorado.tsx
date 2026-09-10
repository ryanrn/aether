import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { UserStatus } from "@aether/shared";

/**
 * O AVATAR COM UMA DECORACAO por cima — e, quando a arte tem duas partes, uma
 * por tras.
 *
 * NAO mexe no `<Avatar>`: envolve. A FOOTPRINT de layout continua sendo `px`
 * (igual a um `<Avatar px>` normal), entao trocar `<Avatar>` por este nao mexe
 * em espacamento nenhum. A arte da decoracao TRANSBORDA esse quadrado: ela e
 * desenhada num canvas de 512 cujo miolo (Ø328 = 64,06%) e a foto, entao a
 * camada ocupa 156% da footprint (`-28%` de cada lado) para o miolo cair
 * exatamente sobre a foto.
 *
 * Quem clipa (`overflow:hidden` num ancestral) corta a decoracao — os poucos
 * lugares assim precisam de folga (ver o cartao de perfil).
 */

/** A frente e (opcional) as costas de uma decoracao. URLs no R2/CDN. */
export interface DecoracaoDeAvatar {
  frenteUrl: string;
  trasUrl?: string | null;
}

/** Quanto da largura da ARTE a foto ocupa — a spec (Ø328 / 512). */
export const FOTO_NA_DECORACAO = 0.6406;
/** Quanto a arte transborda a footprint de cada lado, para o miolo bater. */
const TRANSBORDO = "-28%";

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
  speaking = false,
}: {
  decoracao: DecoracaoDeAvatar;
  /** a footprint — o mesmo `px` que um `<Avatar>` normal teria */
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
  speaking?: boolean;
}) {
  const camada = "pointer-events-none absolute object-contain";
  const inset = { inset: TRANSBORDO } as const;

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: px, height: px, background: fundo }}
    >
      {decoracao.trasUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={decoracao.trasUrl} alt="" aria-hidden className={camada} style={inset} />
      ) : null}

      <Avatar
        userId={userId}
        name={name}
        src={src}
        status={status}
        moldura={moldura}
        round={round}
        ring={ring}
        speaking={speaking}
        px={px}
      />

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={decoracao.frenteUrl}
        alt=""
        aria-hidden
        className={cn(camada, "z-20")}
        style={inset}
      />
    </div>
  );
}
