"use client";

import type { CSSProperties } from "react";
import type { UserStatus } from "@aether/shared";
import { cn, colorFromId, initials } from "@/lib/utils";
import { usePerfilAoVivo } from "@/lib/stores/perfis-store";
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

/**
 * A ESCALA DE AVATAR DO APP — fonte unica de verdade.
 *
 * Um numero por variante, em px. Todo tamanho de avatar do produto sai daqui;
 * nao existe mais `h-10 w-10` solto num componente. Quando um contexto precisa
 * de um valor fora da escala (hoje so o chat, cujo avatar e um slider), passa
 * `px` — mas isso e a excecao, nao o caminho normal.
 *
 * A escala foi redimensionada para dar PRESENCA ao avatar: ele e a base visual
 * dos cosmeticos (moldura, decoracao, efeito), e cosmetico sobre um icone de
 * 32px nao se le. Cada degrau tem um papel:
 *
 *   xs  24  listas densas embutidas — rostos empilhados numa call, sublistas
 *   sm  32  linhas de lista e barras — membros, conversas, userbar
 *   md  44  cabecalhos e cartoes de menu — conversa aberta, menu do trilho
 *   lg  72  cartoes de identidade — cartao de atividade, conta, tela de login
 *   xl  96  o cartao de perfil — o maior da interface, onde a decoracao
 *           aparece inteira e o indicador de presenca fica confortavel
 *
 * O sistema de cosmeticos le `--avatar-size` (px do circulo) no wrapper e
 * `data-avatar-size` (o degrau) para saber a area util sem medir o DOM. Quando
 * ha uma DECORACAO, quem compõe as camadas em volta e o `<AvatarDecorado>`
 * (`components/profile/avatar-decorado.tsx`) — ele envolve este componente e
 * encolhe a foto para o miolo Ø64% que a arte reserva.
 */
export const AVATAR_PX = {
  xs: 24,
  sm: 32,
  md: 44,
  lg: 72,
  xl: 96,
} as const;

export type TamanhoAvatar = keyof typeof AVATAR_PX;

/**
 * O ponto de status cresce em degraus, nao proporcional ao pixel: num avatar
 * grande um ponto proporcional viraria uma bola exagerada.
 */
function tamanhoDoPonto(box: number): string {
  if (box >= 88) return "h-[18px] w-[18px]";
  if (box >= 56) return "h-4 w-4";
  return "h-3 w-3";
}

export function Avatar({
  userId,
  name,
  src,
  status,
  size = "sm",
  /**
   * Tamanho exato em px, quando o chamador precisa de um valor fora da escala
   * `xs..xl` — hoje so o chat, cujo avatar e configuravel. Sobrepoe `size` na
   * largura/altura; o resto (espessura da moldura) continua seguindo `size`,
   * entao passe o `size` mais proximo junto.
   */
  px,
  speaking = false,
  round = true,
  moldura = null,
  ring = "border-base-900",
  className,
}: {
  userId: string;
  name: string;
  src?: string | null;
  status?: UserStatus;
  size?: TamanhoAvatar;
  /** tamanho exato em px; sobrepoe `size` na largura/altura do avatar */
  px?: number;
  /** anel de "falando" — usado a partir da fase 4 */
  speaking?: boolean;
  /**
   * Formato do avatar. REDONDO e o padrao do app inteiro.
   *
   * A divergencia antiga (amigos redondo, resto `rounded-md`) foi resolvida
   * para redondo quando o sistema de decoracao de perfil (Avatar Cosmetics)
   * entrou: decoracao circular sobre avatar quadrado nunca encaixa. `round`
   * segue como prop caso algum lugar futuro precise do quadrado, mas o default
   * e `true`.
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
  /**
   * Foto e moldura mais recentes, se a pessoa trocou depois que esta tela
   * carregou (`user:profile`, ver `perfis-store`). Aqui, e nao em cada um dos
   * ~40 lugares que desenham avatar: um ponto so cobre chat, membros, amigos,
   * DMs e call de uma vez.
   *
   * O `name` NAO e trocado: em varios lugares ele e o APELIDO no servidor, e o
   * evento so conhece o nome de exibicao. Ele so aparece como iniciais quando
   * nao ha foto.
   */
  const aoVivo = usePerfilAoVivo(userId);
  if (aoVivo) {
    src = aoVivo.avatarUrl;
    moldura = aoVivo.moldura;
  }

  const box = px ?? AVATAR_PX[size];
  const estiloDaMoldura = moldura ? MOLDURA_ESTILO[moldura] : undefined;

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={
        { "--avatar-size": `${box}px`, width: box, height: box } as CSSProperties
      }
      data-avatar-size={size}
    >
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
          "relative flex h-full w-full items-center justify-center overflow-hidden font-medium text-ink-100 transition-shadow duration-100",
          round ? "rounded-full" : "rounded-md",
          speaking && "speaking-ring",
        )}
        style={{
          fontSize: Math.round(box * 0.36),
          ...(src ? null : { backgroundColor: colorFromId(userId) }),
        }}
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
            "absolute -bottom-0.5 -right-0.5 z-30 rounded-full border-2",
            ring,
            tamanhoDoPonto(box),
            STATUS_COLOR[status],
          )}
          aria-label={status}
        />
      ) : null}
    </div>
  );
}
