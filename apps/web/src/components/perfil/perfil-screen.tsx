"use client";

import type { DecoracaoPublica, PlanTier, UserStatus } from "@aether/shared";
import { AetherIcon } from "@/components/ui/aether-icon";
import { Avatar } from "@/components/ui/avatar";
import { AvatarDecorado } from "@/components/profile/avatar-decorado";
import { SeloPlano } from "@/components/ui/selo-plano";
import { NavToggle } from "@/components/layout/nav-mobile";
import { useShellStore } from "@/lib/stores/shell-store";
import { cn } from "@/lib/utils";

/**
 * Cartao de perfil como os OUTROS te veem — o alvo do item "Perfil" do menu.
 *
 * "Editar perfil" abre o modal de Configuracoes (aba Conta) pelo `shell-store`:
 * a instancia que o menu do avatar no trilho ja monta. Sem duplicar o editor
 * inteiro numa segunda tela.
 */

const STATUS_COR: Record<UserStatus, string> = {
  ONLINE: "bg-signal-online",
  IDLE: "bg-signal-idle",
  DND: "bg-signal-dnd",
  OFFLINE: "bg-ink-600",
};

interface PerfilUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  moldura: string | null;
  decoracao: DecoracaoPublica | null;
  plano: PlanTier;
  status: UserStatus;
}

export function PerfilScreen({
  user,
  bio,
  membroDesde,
  banner,
}: {
  user: PerfilUser;
  bio: string | null;
  /** ISO — `createdAt` da conta */
  membroDesde: string | null;
  /** URL do banner equipado, já resolvida — ou null */
  banner: string | null;
}) {
  const abrirConfig = useShellStore((s) => s.abrirConfig);

  const desde = membroDesde
    ? new Date(membroDesde).toLocaleDateString("pt-BR", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-5">
        <NavToggle />
        <AetherIcon name="user" className="h-4 w-4 text-accent-400" />
        <h1 className="text-[15px] font-semibold text-ink-100">Perfil</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[520px] px-5 pb-16 pt-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-brand text-xl font-semibold tracking-[0.01em] text-ink-100">
                Perfil
              </h2>
              <p className="mt-1 text-[13px] text-ink-400">
                É assim que os outros veem você no AETHER.
              </p>
            </div>
            <button
              type="button"
              onClick={() => abrirConfig("conta")}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-base-800 px-3.5 text-[13px] font-medium text-ink-200 transition-colors hover:bg-base-700"
            >
              <AetherIcon name="pencil" className="h-3.5 w-3.5" />
              Editar perfil
            </button>
          </div>

          <button
            type="button"
            onClick={() => abrirConfig("conta")}
            aria-label="Editar perfil"
            className="mt-5 block w-full overflow-hidden rounded-2xl border border-line bg-base-850 text-left shadow-[var(--shadow-pop)] transition-colors hover:border-line-strong"
          >
            {/* faixa / banner */}
            <div
              className="h-24 bg-accent-500/15"
              style={
                banner
                  ? {
                      backgroundImage: `url(${banner})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : undefined
              }
            />

            <div className="-mt-11 px-6 pb-6">
              {/* avatar (a decoração transborda a footprint) */}
              <div className="mb-3 w-max">
                {user.decoracao ? (
                  <AvatarDecorado
                    userId={user.id}
                    name={user.displayName}
                    src={user.avatarUrl}
                    moldura={user.moldura}
                    px={88}
                    decoracao={{
                      frenteUrl: user.decoracao.frente,
                      trasUrl: user.decoracao.tras,
                    }}
                  />
                ) : (
                  <Avatar
                    userId={user.id}
                    name={user.displayName}
                    src={user.avatarUrl}
                    moldura={user.moldura}
                    px={88}
                  />
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="font-brand text-[22px] font-semibold text-ink-100">
                  {user.displayName}
                </span>
                <span
                  aria-label={user.status}
                  className={cn(
                    "h-2.5 w-2.5 rounded-full ring-2 ring-base-850",
                    STATUS_COR[user.status] ?? "bg-ink-600",
                  )}
                />
                <SeloPlano tier={user.plano} />
              </div>
              <p className="mt-0.5 text-[13px] text-ink-400">@{user.username}</p>

              {desde ? (
                <div className="mt-5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-500">
                    Membro desde
                  </span>
                  <p className="mt-0.5 text-[13px] text-ink-200">{desde}</p>
                </div>
              ) : null}

              <div className="mt-4">
                <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-500">
                  Sobre
                </span>
                <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-300">
                  {bio ?? (
                    <span className="text-ink-500">
                      Você ainda não escreveu nada. Toque para editar.
                    </span>
                  )}
                </p>
              </div>
            </div>
          </button>

          <p className="mt-3 text-center text-[12px] text-ink-500">
            Clique no cartão ou em “Editar perfil” para mudar avatar, nome, bio,
            moldura e cosméticos.
          </p>
        </div>
      </div>
    </div>
  );
}
