import type { UserStatus } from "@aether/shared";
import { cn, colorFromId, initials } from "@/lib/utils";
import {
  MOLDURA_ESPESSURA,
  MOLDURA_ESTILO,
  MOLDURA_RAIO,
} from "./molduras";

const STATUS_COLOR: Record<UserStatus, string> = {
  ONLINE: "bg-signal-online",
  IDLE: "bg-signal-idle",
  DND: "bg-signal-dnd",
  OFFLINE: "bg-signal-offline",
};

const SIZES = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-[11px]",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-lg",
} as const;

export function Avatar({
  userId,
  name,
  src,
  status,
  size = "sm",
  speaking = false,
  round = false,
  moldura = null,
  ring = "border-base-900",
  className,
}: {
  userId: string;
  name: string;
  src?: string | null;
  status?: UserStatus;
  size?: keyof typeof SIZES;
  /** anel de "falando" — usado a partir da fase 4 */
  speaking?: boolean;
  /**
   * Redondo em vez do quadrado-arredondado padrao.
   *
   * A tela de amigos usa redondo; o resto do app usa `rounded-md`. Nao e
   * capricho de um lugar so: e uma divergencia que ainda precisa ser decidida
   * para o app inteiro, e ficar como propriedade deixa isso visivel em vez de
   * escondido numa classe solta.
   */
  round?: boolean;
  /**
   * A moldura JA RESOLVIDA contra o plano — vem do `PublicUser`.
   *
   * O componente NAO consulta plano nenhum: recebe um id que ja passou pela
   * regra no servidor. Se ele decidisse aqui, a regra existiria em dois
   * lugares e um deles ficaria para tras.
   *
   * Id sem estilo conhecido nao desenha nada, em vez de quebrar: uma moldura
   * retirada do catalogo some da tela e o avatar continua inteiro.
   */
  moldura?: string | null;
  /**
   * Cor do anel do ponto de status.
   *
   * O anel existe para SEPARAR o ponto do que esta atras dele, entao precisa
   * ser da cor do fundo — nao de uma cor fixa. Com valor fixo, todo avatar
   * fora de `base-900` ganhava um halo mais claro em volta do ponto: na lista
   * de amigos (fundo `base-950`) e nos cartoes de atividade (`base-850`).
   */
  ring?: string;
  className?: string;
}) {
  const estiloDaMoldura = moldura ? MOLDURA_ESTILO[moldura] : undefined;

  return (
    <div className={cn("relative shrink-0", className)}>
      {estiloDaMoldura ? (
        /*
         * ANTES do avatar no DOM, e por isso atras dele na pintura. Sem
         * z-index: no mesmo contexto de empilhamento, quem vem depois cobre
         * quem veio antes, e o avatar e opaco (imagem ou cor de fundo). So a
         * beirada do anel sobra a vista.
         */
        <span
          aria-hidden
          className={cn(
            "absolute",
            MOLDURA_ESPESSURA[size],
            round ? MOLDURA_RAIO.redondo : MOLDURA_RAIO.quadrado[size],
            estiloDaMoldura,
          )}
        />
      ) : null}
      <div
        className={cn(
          "relative flex items-center justify-center overflow-hidden font-medium text-ink-100 transition-shadow duration-100",
          round ? "rounded-full" : "rounded-md",
          SIZES[size],
          speaking && "speaking-ring",
        )}
        style={src ? undefined : { backgroundColor: colorFromId(userId) }}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={name} className="h-full w-full object-cover" />
        ) : (
          initials(name)
        )}
      </div>
      {status ? (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 z-10 rounded-full border-2",
            ring,
            size === "lg" ? "h-4 w-4" : "h-3 w-3",
            STATUS_COLOR[status],
          )}
          aria-label={status}
        />
      ) : null}
    </div>
  );
}
