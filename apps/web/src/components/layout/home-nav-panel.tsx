"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { AetherIcon, type AetherIconName } from "@/components/ui/aether-icon";
import { Avatar } from "@/components/ui/avatar";
import {
  rotuloDeRevisoes,
  totalDeRevisoes,
  type RevisoesPendentes,
} from "@aether/shared";
import { contarRevisoesAction } from "@/server/actions/revisao";
import { useConversasDm } from "@/lib/stores/realtime-store";
import { useShellStore } from "@/lib/stores/shell-store";
import {
  NAV_ESCONDIDA,
  NAV_GAVETA,
  NAV_VISIVEL,
} from "@/components/layout/nav-mobile";
import { cn } from "@/lib/utils";

/**
 * A "home" do app — o painel esquerdo que aparece FORA de um servidor.
 *
 * Substituiu os icones soltos do trilho (que viraram uma marca so) e o antigo
 * `friends-nav`. Ocupa a mesma coluna que a arvore de canais ocupa dentro de um
 * servidor: some no servidor, aparece nas telas de app (Amigos, Loja, Grupos,
 * Olimpo, Explorar, painel da equipe e as conversas diretas).
 *
 * Montado uma vez no layout de `/app`; ele proprio decide se renderiza, pela
 * rota. Assim os hooks (store, contagem) nao precisam de um pai que monte e
 * desmonte a cada navegacao.
 */

const ROTAS_HOME = new Set([
  "/app",
  "/app/amigos",
  "/app/perfil",
  "/app/loja",
  "/app/grupos",
  "/app/olimpo",
  "/app/explorar",
  "/app/equipe",
]);

export function ehRotaHome(pathname: string): boolean {
  return ROTAS_HOME.has(pathname) || pathname.startsWith("/app/dm/");
}

interface ItemHome {
  href: string;
  label: string;
  icone: AetherIconName;
  tom?: string;
  pill?: string | null;
}

export function HomeNavPanel({
  pendingRequests = 0,
  equipe = false,
}: {
  pendingRequests?: number;
  equipe?: boolean;
}) {
  const pathname = usePathname();
  const navAberta = useShellStore((e) => e.navAberta);
  const conversas = useConversasDm();
  const params = useParams<{ dmId?: string }>();
  const dmAtiva = params?.dmId;
  const [revisoes, setRevisoes] = useState<RevisoesPendentes | null>(null);
  const esperandoRevisao = totalDeRevisoes(revisoes);

  const naHome = ehRotaHome(pathname);

  useEffect(() => {
    if (!naHome || !equipe) return;
    let vivo = true;
    const buscar = () =>
      contarRevisoesAction()
        .then((r) => {
          if (vivo && r.ok) setRevisoes(r.data);
        })
        .catch(() => {});
    buscar();
    window.addEventListener("focus", buscar);
    return () => {
      vivo = false;
      window.removeEventListener("focus", buscar);
    };
  }, [naHome, equipe]);

  if (!naHome) return null;

  const itens: ItemHome[] = [
    {
      href: "/app/amigos",
      label: "Amigos",
      icone: "users",
      pill: pendingRequests > 0 ? (pendingRequests > 9 ? "9+" : String(pendingRequests)) : null,
    },
    { href: "/app/perfil", label: "Perfil", icone: "user" },
    { href: "/app/loja", label: "Loja", icone: "sparkle" },
    { href: "/app/grupos", label: "Grupos", icone: "gamepad" },
    { href: "/app/olimpo", label: "Olimpo", icone: "crown", tom: "text-amber-300" },
    { href: "/app/explorar", label: "Explorar comunidades", icone: "compass" },
    { href: "/app/developers", label: "Desenvolvedores", icone: "key" },
  ];

  return (
    <aside
      aria-label="Navegação do AETHER"
      className={cn(
        "flex w-[248px] shrink-0 flex-col border-r border-line bg-base-900",
        NAV_GAVETA,
        "max-md:left-[68px]",
        navAberta ? NAV_VISIVEL : NAV_ESCONDIDA,
      )}
    >
      <header className="flex h-12 shrink-0 items-center border-b border-line-soft px-4">
        <h2 className="text-[13px] font-bold uppercase tracking-[0.18em] text-ink-100">
          AETHER
        </h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <nav className="flex flex-col gap-0.5">
          {itens.map((it) => (
            <LinhaHome
              key={it.href}
              item={it}
              ativo={pathname === it.href}
            />
          ))}

          {equipe ? (
            <>
              <span className="my-1.5 mx-2 block h-px bg-line-soft" />
              <LinhaHome
                item={{
                  href: "/app/equipe",
                  label: "Painel da equipe",
                  icone: "shield",
                  tom: "text-signal-dnd",
                  pill:
                    esperandoRevisao > 0
                      ? rotuloDeRevisoes(esperandoRevisao)
                      : null,
                }}
                ativo={pathname === "/app/equipe"}
              />
            </>
          ) : null}
        </nav>

        {conversas.length > 0 ? (
          <>
            <p className="mt-4 flex items-center justify-between px-2 pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">
              Mensagens diretas
            </p>
            <div className="flex flex-col gap-0.5">
              {conversas.map(({ dmId, outro, naoLidas }) => (
                <Link
                  key={dmId}
                  href={`/app/dm/${dmId}`}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors",
                    dmId === dmAtiva
                      ? "bg-accent-500/[0.12] text-ink-100"
                      : "text-ink-300 hover:bg-base-800 hover:text-ink-100",
                  )}
                >
                  <Avatar
                    userId={outro.id}
                    name={outro.displayName}
                    src={outro.avatarUrl}
                    moldura={outro.moldura}
                    status={outro.status}
                    size="sm"
                    ring="border-base-900"
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[13px]",
                      naoLidas > 0 && "font-semibold text-ink-100",
                    )}
                  >
                    {outro.displayName}
                  </span>
                  {naoLidas > 0 ? (
                    <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-signal-dnd px-1 text-[10px] font-bold leading-none text-white">
                      {naoLidas > 9 ? "9+" : naoLidas}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
}

function LinhaHome({ item, ativo }: { item: ItemHome; ativo: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={ativo ? "page" : undefined}
      draggable={false}
      className={cn(
        "relative flex items-center gap-3 rounded-md px-2.5 py-2 text-[14px] font-medium transition-colors",
        ativo
          ? "bg-base-800 text-ink-100"
          : "text-ink-300 hover:bg-base-800/60 hover:text-ink-100",
      )}
    >
      {ativo ? (
        <span className="absolute -left-2 top-1.5 bottom-1.5 w-1 rounded-r-full bg-accent-500" />
      ) : null}
      <AetherIcon
        name={item.icone}
        className={cn("h-[22px] w-[22px] shrink-0", ativo ? "" : item.tom)}
      />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.pill ? (
        <span className="shrink-0 rounded-full bg-signal-dnd px-1.5 text-[10px] font-bold leading-[16px] text-white">
          {item.pill}
        </span>
      ) : null}
    </Link>
  );
}
