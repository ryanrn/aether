import { cn } from "@/lib/utils";

/**
 * Conjunto de icones do AETHER — familia unica, vinda do redesign OpenDesign.
 *
 * UMA grade (24), UM traco (1.75), cantos e terminacoes redondos. O desenho
 * (stroke/fill/caps) mora na classe `.ic` de `globals.css`; os <symbol> so
 * carregam os <path>. A COR vem do elemento pai por `currentColor` — um
 * <AetherIcon> dentro de um `text-signal-dnd` sai vermelho sem mais nada.
 *
 * POR QUE SPRITE INLINE, e nao um <use href="/arquivo.svg#id"> externo: o
 * sprite externo depende de um segundo request, pisca no primeiro paint (FOUC)
 * e, em parte dos navegadores, nao herda `currentColor` de forma confiavel
 * quando vem de outra origem. Inline no <body> uma vez, tudo isso some.
 *
 * <AetherIconSprite /> e montado UMA vez em `app/app/layout.tsx` (cobre toda a
 * area logada). Fora de `/app` — marketing, login — o app segue com lucide.
 *
 * Onde o sprite ainda nao tem um icone (lapis, lixeira, etc. — vocabulario
 * fora do redesign, que focou na area de voz), o componente que precisa segue
 * importando de `lucide-react`. A migracao da cauda longa e um passo proprio.
 */

export type AetherIconName =
  // --- voz ---
  | "mic"
  | "mic-off"
  | "headset"
  | "headset-off"
  | "headset-monitor"
  | "volume"
  | "volume-off"
  | "camera"
  | "camera-off"
  | "screen-share"
  | "screen-stop"
  | "noise"
  | "settings"
  | "disconnect"
  | "signal"
  // --- navegacao / estrutura ---
  | "users"
  | "hash"
  | "voice"
  | "server"
  | "message"
  | "bell"
  | "chevron"
  | "search"
  | "plus"
  | "crown"
  | "shield"
  | "lock"
  | "pin"
  | "sparkle"
  // --- utilitarios desenhados no mesmo padrao (gaps do sprite do lab) ---
  | "x"
  | "check"
  | "play"
  | "stop"
  | "activity"
  | "wifi-off"
  | "loader"
  | "clipboard-check"
  | "copy"
  | "bug";

const SIZE = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-[22px] w-[22px]",
} as const;

export function AetherIcon({
  name,
  size = "md",
  className,
  "aria-label": ariaLabel,
}: {
  name: AetherIconName;
  size?: keyof typeof SIZE;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <svg
      className={cn("ic", SIZE[size], className)}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
    >
      <use href={`#ic-${name}`} />
    </svg>
  );
}

/**
 * O sprite. `hidden` (nao `display:none` inline) para o React nao brigar com a
 * folha de estilo; `[hidden]` ja e neutralizado pela base do Tailwind so onde
 * precisa. Fica no topo do <body> da area logada.
 */
export function AetherIconSprite() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "none" }}
      aria-hidden="true"
    >
      <defs>
        {/* ── voz: microfone ─────────────────────────────────────────── */}
        <symbol id="ic-mic" viewBox="0 0 24 24">
          <path d="M12 2.75a3 3 0 0 0-3 3v6.5a3 3 0 0 0 6 0v-6.5a3 3 0 0 0-3-3z" />
          <path d="M18.5 10.5v1.5a6.5 6.5 0 0 1-13 0v-1.5" />
          <path d="M12 18.5v2.75" />
          <path d="M8.75 21.25h6.5" />
        </symbol>
        <symbol id="ic-mic-off" viewBox="0 0 24 24">
          <path d="M9.5 5.4a3 3 0 0 1 5.5 1.6v4.5" />
          <path d="M15 15a3 3 0 0 1-6-.4V9" />
          <path d="M18.5 10.5v1.5a6.4 6.4 0 0 1-.5 2.5" />
          <path d="M15.7 17.2A6.5 6.5 0 0 1 5.5 12v-1.5" />
          <path d="M12 18.5v2.75" />
          <path d="M8.75 21.25h6.5" />
          <path d="M3.5 3.5 20.5 20.5" />
        </symbol>

        {/* ── voz: fone / headset ────────────────────────────────────── */}
        <symbol id="ic-headset" viewBox="0 0 24 24">
          <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
          <path d="M20 15.5a2 2 0 0 1 2 2v1.5a2 2 0 0 1-2 2h-1a1 1 0 0 1-1-1v-4.5a1 1 0 0 1 1-1z" />
          <path d="M4 15.5a2 2 0 0 0-2 2v1.5a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-4.5a1 1 0 0 0-1-1z" />
        </symbol>
        <symbol id="ic-headset-off" viewBox="0 0 24 24">
          <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
          <path d="M20 15.5a2 2 0 0 1 2 2v1.5a2 2 0 0 1-2 2h-1a1 1 0 0 1-1-1v-4.5a1 1 0 0 1 1-1z" />
          <path d="M4 15.5a2 2 0 0 0-2 2v1.5a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-4.5a1 1 0 0 0-1-1z" />
          <path d="M3.25 3.25 20.75 20.75" />
        </symbol>
        <symbol id="ic-headset-monitor" viewBox="0 0 24 24">
          <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
          <path d="M20 15.5a2 2 0 0 1 2 2v1.5a2 2 0 0 1-2 2h-1a1 1 0 0 1-1-1v-4.5a1 1 0 0 1 1-1z" />
          <path d="M4 15.5a2 2 0 0 0-2 2v1.5a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-4.5a1 1 0 0 0-1-1z" />
          <path d="M10.5 9v6M13.5 10.5v3" />
        </symbol>

        {/* ── voz: volume / saida de audio ───────────────────────────── */}
        <symbol id="ic-volume" viewBox="0 0 24 24">
          <path d="M11 5 6.5 8.75H3.5a1 1 0 0 0-1 1v4.5a1 1 0 0 0 1 1h3L11 19a1 1 0 0 0 1.6-.8V5.8A1 1 0 0 0 11 5z" />
          <path d="M16 9.5a4 4 0 0 1 0 5" />
          <path d="M18.7 6.8a8 8 0 0 1 0 10.4" />
        </symbol>
        <symbol id="ic-volume-off" viewBox="0 0 24 24">
          <path d="M11 5 6.5 8.75H3.5a1 1 0 0 0-1 1v4.5a1 1 0 0 0 1 1h3L11 19a1 1 0 0 0 1.6-.8V5.8A1 1 0 0 0 11 5z" />
          <path d="M16.5 9.75 21.5 14.25M21.5 9.75 16.5 14.25" />
        </symbol>

        {/* ── voz: camera ────────────────────────────────────────────── */}
        <symbol id="ic-camera" viewBox="0 0 24 24">
          <path d="M15.5 12 21 8.5a.9.9 0 0 1 1.5.75v5.5A.9.9 0 0 1 21 15.5L15.5 12z" />
          <rect x="1.75" y="6" width="13.75" height="12" rx="3" />
        </symbol>
        <symbol id="ic-camera-off" viewBox="0 0 24 24">
          <path d="M15.5 15.7a3 3 0 0 1-2.8 2.3H4.5a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3h1.2" />
          <path d="M9.5 6h3.2a3 3 0 0 1 2.8 3v3.2l.5.5L21 8.5a.9.9 0 0 1 1.5.75v5.5" />
          <path d="M3.5 3.5 20.5 20.5" />
        </symbol>

        {/* ── voz: compartilhar tela ─────────────────────────────────── */}
        <symbol id="ic-screen-share" viewBox="0 0 24 24">
          <rect x="2.5" y="3.5" width="19" height="13" rx="2.75" />
          <path d="M8.5 20.5h7M12 16.5v4" />
          <path d="M12 13.25V7.5M9.5 10 12 7.5 14.5 10" />
        </symbol>
        <symbol id="ic-screen-stop" viewBox="0 0 24 24">
          <rect x="2.5" y="3.5" width="19" height="13" rx="2.75" />
          <path d="M8.5 20.5h7M12 16.5v4" />
          <rect x="9.25" y="7.25" width="5.5" height="5.5" rx="1.4" />
        </symbol>

        {/* ── voz: supressao de ruido + configuracoes + desconectar ──── */}
        <symbol id="ic-noise" viewBox="0 0 24 24">
          <path d="M3.75 10.5v3M7.25 7.5v9M10.75 4.5v15M14.25 8.75v6.5M17.75 11v2" />
          <path d="M20.2 3.4c.28 1.7 1 2.42 2.7 2.7-1.7.28-2.42 1-2.7 2.7-.28-1.7-1-2.42-2.7-2.7 1.7-.28 2.42-1 2.7-2.7z" />
        </symbol>
        <symbol id="ic-settings" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3.25" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </symbol>
        <symbol id="ic-disconnect" viewBox="0 0 24 24">
          <path d="M10.7 13.3a15.6 15.6 0 0 0 3.4 2.6l1.3-1.3a2 2 0 0 1 2.1-.45 12.5 12.5 0 0 0 2.8.7 2 2 0 0 1 1.7 2v2.9a2 2 0 0 1-2.2 2 19.7 19.7 0 0 1-8.6-3.05A19.4 19.4 0 0 1 8 15" />
          <path d="M8 15A19.7 19.7 0 0 1 5 6.4 2 2 0 0 1 7 4.2h2.9a2 2 0 0 1 2 1.7c.13 1 .35 1.9.66 2.8a2 2 0 0 1-.45 2.1L10.7 13.3" />
          <path d="M3.5 3.5 20.5 20.5" />
        </symbol>

        {/* ── navegacao / estrutura ──────────────────────────────────── */}
        <symbol id="ic-users" viewBox="0 0 24 24">
          <path d="M16 20.5v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1.5" />
          <circle cx="9" cy="7.5" r="3.75" />
          <path d="M22 20.5v-1.5a4 4 0 0 0-3-3.85M16 3.9a3.75 3.75 0 0 1 0 7.2" />
        </symbol>
        <symbol id="ic-hash" viewBox="0 0 24 24">
          <path d="M4.5 9h15M4 15h15M10.25 3.5 8.25 20.5M15.75 3.5l-2 17" />
        </symbol>
        <symbol id="ic-voice" viewBox="0 0 24 24">
          <path d="M11 5 6.5 8.75H3.5a1 1 0 0 0-1 1v4.5a1 1 0 0 0 1 1h3L11 19a1 1 0 0 0 1.6-.8V5.8A1 1 0 0 0 11 5z" />
          <path d="M16 9.5a4 4 0 0 1 0 5" />
        </symbol>
        <symbol id="ic-server" viewBox="0 0 24 24">
          <rect x="2.5" y="3" width="19" height="7.5" rx="2.5" />
          <rect x="2.5" y="13.5" width="19" height="7.5" rx="2.5" />
          <path d="M6.5 6.75h.01M6.5 17.25h.01" />
        </symbol>
        <symbol id="ic-message" viewBox="0 0 24 24">
          <path d="M21 14.5a2 2 0 0 1-2 2H8l-4.5 4v-15a2 2 0 0 1 2-2h13.5a2 2 0 0 1 2 2z" />
        </symbol>
        <symbol id="ic-bell" viewBox="0 0 24 24">
          <path d="M18 8.5a6 6 0 0 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5z" />
          <path d="M13.75 19.5a2 2 0 0 1-3.5 0" />
        </symbol>
        <symbol id="ic-chevron" viewBox="0 0 24 24">
          <path d="M6 9.25 12 15l6-5.75" />
        </symbol>
        <symbol id="ic-search" viewBox="0 0 24 24">
          <circle cx="10.75" cy="10.75" r="7.25" />
          <path d="m16.5 16.5 4 4" />
        </symbol>
        <symbol id="ic-plus" viewBox="0 0 24 24">
          <path d="M12 4.75v14.5M4.75 12h14.5" />
        </symbol>
        <symbol id="ic-signal" viewBox="0 0 24 24">
          <path d="M6 20.5v-4.5M12 20.5V9.5M18 20.5v-17" />
        </symbol>
        <symbol id="ic-crown" viewBox="0 0 24 24">
          <path d="M3.5 8.5 7 12l4.2-6.2a1 1 0 0 1 1.6 0L17 12l3.5-3.5-1.6 10.2a1 1 0 0 1-1 .8H6.1a1 1 0 0 1-1-.8z" />
        </symbol>
        <symbol id="ic-shield" viewBox="0 0 24 24">
          <path d="M12 21.5c4.5-1.7 7.5-4.7 7.5-9.5V5.5L12 2.5 4.5 5.5V12c0 4.8 3 7.8 7.5 9.5z" />
        </symbol>
        <symbol id="ic-lock" viewBox="0 0 24 24">
          <rect x="3.5" y="10.75" width="17" height="10.5" rx="2.75" />
          <path d="M7.25 10.75V7.5a4.75 4.75 0 0 1 9.5 0v3.25" />
        </symbol>
        <symbol id="ic-pin" viewBox="0 0 24 24">
          <path d="M12 16.5v4.75" />
          <path d="M9 10.4a2 2 0 0 1-1.1 1.8l-1.6.85A2 2 0 0 0 5.2 14.8v.7a1 1 0 0 0 1 1h11.6a1 1 0 0 0 1-1v-.7a2 2 0 0 0-1.1-1.75l-1.6-.85A2 2 0 0 1 15 10.4V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
        </symbol>
        <symbol id="ic-sparkle" viewBox="0 0 24 24">
          <path d="M12 3 13.9 8.1 19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
        </symbol>

        {/* ── utilitarios (mesma grade/traco; gaps do sprite do lab) ─── */}
        <symbol id="ic-x" viewBox="0 0 24 24">
          <path d="M6 6 18 18M18 6 6 18" />
        </symbol>
        <symbol id="ic-check" viewBox="0 0 24 24">
          <path d="M5 12.5 10 17.5 19.5 7" />
        </symbol>
        <symbol id="ic-play" viewBox="0 0 24 24">
          <path d="M7.5 5.5a1 1 0 0 1 1.5-.87l10 6.5a1 1 0 0 1 0 1.74l-10 6.5A1 1 0 0 1 7.5 18.5z" />
        </symbol>
        <symbol id="ic-stop" viewBox="0 0 24 24">
          <rect x="6.5" y="6.5" width="11" height="11" rx="2.25" />
        </symbol>
        <symbol id="ic-activity" viewBox="0 0 24 24">
          <path d="M3 12h4l2.5 7 5-16 2.5 9h4" />
        </symbol>
        <symbol id="ic-wifi-off" viewBox="0 0 24 24">
          <path d="M3.5 3.5 20.5 20.5" />
          <path d="M8.5 15.5a5 5 0 0 1 7 0" />
          <path d="M5 12.2a10 10 0 0 1 3.6-2.4M19 12.2a10 10 0 0 0-6.2-2.9" />
          <path d="M2 8.75A15 15 0 0 1 6 6.3M22 8.75a15 15 0 0 0-9-2.7" />
          <path d="M12 19.25h.01" />
        </symbol>
        <symbol id="ic-loader" viewBox="0 0 24 24">
          <path d="M12 3v4M12 17v4M5.6 5.6l2.85 2.85M15.55 15.55l2.85 2.85M3 12h4M17 12h4M5.6 18.4l2.85-2.85M15.55 8.45l2.85-2.85" />
        </symbol>
        <symbol id="ic-clipboard-check" viewBox="0 0 24 24">
          <rect x="6" y="5" width="12" height="16" rx="2.5" />
          <path d="M9 5V4a3 3 0 0 1 6 0v1" />
          <path d="M9.5 13 11.5 15 15 10.75" />
        </symbol>
        <symbol id="ic-copy" viewBox="0 0 24 24">
          <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
          <path d="M5.5 15.5A2 2 0 0 1 4.5 13.75V6a2 2 0 0 1 2-2h7.75a2 2 0 0 1 1.75 1" />
        </symbol>
        <symbol id="ic-bug" viewBox="0 0 24 24">
          <path d="M9 8.5V7.5a3 3 0 0 1 6 0v1" />
          <path d="M6.5 13h11" />
          <path d="M12 8.5v10" />
          <path d="M9.5 20a5 5 0 0 1-4-4.9v-2A4.5 4.5 0 0 1 10 8.5h4a4.5 4.5 0 0 1 4.5 4.6v2a5 5 0 0 1-4 4.9" />
          <path d="M4.5 9.5 7 11M19.5 9.5 17 11M4 16h2.5M17.5 16H20" />
        </symbol>
      </defs>
    </svg>
  );
}
