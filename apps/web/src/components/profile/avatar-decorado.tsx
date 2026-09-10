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
 * desenhada num canvas de 512 cujo miolo transparente (~Ø288 = 56%) e a foto,
 * entao a camada ocupa 178% da footprint e fica CENTRADA (transform). O miolo
 * da arte fica um pouco MENOR que a foto de proposito: a decoracao encosta e
 * entra ~alguns px na borda do avatar (abraca de verdade, como no Discord) e
 * ainda sobra ~39% de cada lado para fora.
 *
 * A arte que o OpenDesign entrega tende a ter a abertura central mais larga do
 * que a spec pede (e ovalada no topo); 178% e a escala que fecha essa folga com
 * as artes reais sem exigir novo re-export. Se a abertura for um circulo
 * apertado de verdade, a decoracao so cobre um pouco mais da foto — aceitavel
 * para arte ornamental.
 *
 * CENTRAGEM POR TRANSFORM, e nao `inset:-28%`: um `<img>` e elemento
 * SUBSTITUIDO. Com `position:absolute` e os quatro lados fixos mas sem
 * `width`/`height`, o navegador usa o TAMANHO INTRINSECO da imagem e ancora no
 * canto — a decoracao saia enorme e jogada para um lado (bug relatado). Com
 * `w`/`h` explicitos + `translate(-50%,-50%)` ela fica do tamanho certo e no
 * centro, sempre.
 *
 * Quem clipa (`overflow:hidden` num ancestral) corta a decoracao — os poucos
 * lugares assim precisam de folga (ver o cartao de perfil).
 */

/** A frente e (opcional) as costas de uma decoracao. URLs no R2/CDN. */
export interface DecoracaoDeAvatar {
  frenteUrl: string;
  trasUrl?: string | null;
}

/**
 * Quanto da largura da ARTE o miolo transparente (a foto) ocupa. ~Ø288 / 512.
 * O inverso (1 / 0,5618 ≈ 1,78) e a escala da camada — ver `camada` abaixo.
 * Menor que a spec teorica de Ø328 de proposito: a arte real vem com abertura
 * mais larga, e a decoracao tem que abracar a foto, nao flutuar em volta.
 */
export const FOTO_NA_DECORACAO = 0.5618;

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
   * 178% da footprint (= 1 / 0,5618), centrada no ponto medio. `object-contain`
   * mantem a proporcao da arte (quadrada, na spec) dentro dessa caixa.
   */
  const camada =
    "pointer-events-none absolute left-1/2 top-1/2 h-[178%] w-[178%] -translate-x-1/2 -translate-y-1/2 object-contain";

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: px, height: px, background: fundo }}
    >
      {decoracao.trasUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={decoracao.trasUrl} alt="" aria-hidden className={camada} />
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
      />
    </div>
  );
}
