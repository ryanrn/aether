import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { DECORACAO_ESCALA, type UserStatus } from "@aether/shared";

/**
 * O AVATAR COM UMA DECORACAO por cima — e, quando a arte tem duas partes, uma
 * por tras.
 *
 * NAO mexe no `<Avatar>`: envolve. A FOOTPRINT de layout continua sendo `px`
 * (igual a um `<Avatar px>` normal), entao trocar `<Avatar>` por este nao mexe
 * em espacamento nenhum.
 *
 * ESCALA UNICA. Toda decoracao chega normalizada pelo upload
 * (`normalizarDecoracao`): PNG 512 que sangra nas bordas, furo central em
 * `DECORACAO_ALVO_FURO` (~50%). Por isso aqui basta UMA escala fixa
 * (`DECORACAO_ESCALA`, ~180% da footprint): a camada de arte fica centrada, a
 * borda da foto cai um pouco dentro do furo (a arte abraca ~10% da foto) e
 * sobra ~40% de cada lado para fora. Nao ha calculo por arte.
 *
 * CENTRAGEM POR TRANSFORM, e nao `inset`: um `<img>` e elemento SUBSTITUIDO.
 * Com `position:absolute` e os quatro lados fixos mas sem `width`/`height`, o
 * navegador usa o TAMANHO INTRINSECO e ancora no canto — a decoracao saia
 * enorme e jogada para um lado (bug relatado). Com `w`/`h` explicitos +
 * `translate(-50%,-50%)` ela fica do tamanho certo e no centro, sempre.
 *
 * Quem clipa (`overflow:hidden` num ancestral) corta a decoracao — os poucos
 * lugares assim precisam de folga (ver o cartao de perfil).
 */

/** A frente e (opcional) as costas de uma decoracao. URLs no R2/CDN. */
export interface DecoracaoDeAvatar {
  frenteUrl: string;
  trasUrl?: string | null;
}

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
  /**
   * `DECORACAO_ESCALA` da footprint, centrada no ponto medio via transform.
   * `object-contain` mantem a proporcao da arte (quadrada) dentro da caixa.
   * Escala inline (nao classe Tailwind) para o unico valor vir do `@aether/shared`.
   */
  const camada =
    "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 object-contain";
  const tamanho = `${DECORACAO_ESCALA * 100}%`;
  const camadaStyle = { width: tamanho, height: tamanho } as const;

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
          className={camada}
          style={camadaStyle}
        />
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
        style={camadaStyle}
      />
    </div>
  );
}
