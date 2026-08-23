"use client";

import { useEffect, useState } from "react";
import type { PublicFriendship } from "@aether/shared";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import { GameArt } from "@/components/profile/game-art";
import { Avatar } from "@/components/ui/avatar";
import { duracaoGrossa, useElapsed } from "@/lib/use-elapsed";

/**
 * Painel direito — "Ativo agora", 260px fixos.
 *
 * So aparece quem esta REALMENTE jogando algo. Nao ha lista de "amigos online"
 * repetida aqui: isso ja e o painel do meio, e repetir a mesma informacao em
 * duas colunas gasta 260px para nao dizer nada novo.
 *
 * O que este painel tem de proprio e a ARTE: a capa do IGDB em tamanho que da
 * para ver, com o tempo de sessao correndo ao lado.
 */
export function ActivityPanel({ amigos }: { amigos: PublicFriendship[] }) {
  const activity = useRealtimeStore((estado) => estado.activity);

  const jogando = amigos.filter((amigo) => activity[amigo.user.id]?.game);

  return (
    <aside
      aria-label="Ativo agora"
      className="flex w-[260px] shrink-0 flex-col border-l border-white/[0.06] bg-base-900"
    >
      <h2 className="shrink-0 px-4 pb-2.5 pt-4 text-[13px] font-bold text-ink-100">
        Ativo agora
      </h2>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {jogando.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-white/[0.06] px-3 py-6 text-center text-[11px] leading-relaxed text-ink-500">
            Quando alguem da sua lista abrir um jogo, ele aparece aqui.
          </p>
        ) : (
          jogando.map((amigo) => (
            <CartaoAtividade key={amigo.id} amigo={amigo} />
          ))
        )}
      </div>
    </aside>
  );
}

function CartaoAtividade({ amigo }: { amigo: PublicFriendship }) {
  const jogo = useRealtimeStore((estado) => estado.activity[amigo.user.id]);
  const status = useRealtimeStore((estado) => estado.presence[amigo.user.id]);
  const decorrido = useElapsed(jogo?.since ?? null);

  /**
   * O "ha 1h" do resumo e o relogio preciso do lado do jogo contam a MESMA
   * coisa. Derivar os dois do mesmo instante evita que pisquem fora de sincronia
   * — um virando "2h" um segundo antes do outro.
   */
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const grosso = duracaoGrossa(jogo?.since ?? null, agora);

  if (!jogo?.game) return null;

  return (
    <article className="mb-2.5 rounded-[10px] border border-white/[0.06] bg-base-850 p-3">
      <header className="flex items-center gap-2.5">
        <Avatar
          userId={amigo.user.id}
          name={amigo.user.displayName}
          src={amigo.user.avatarUrl}
          status={status}
          size="sm"
          round
          // O cartao e `base-850`; o anel do ponto acompanha o fundo.
          ring="border-base-850"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-bold text-ink-100">
            {amigo.user.displayName}
          </p>
          <p className="truncate text-[11px] text-ink-300">
            Jogando {jogo.game}
            {grosso ? ` — ${grosso}` : ""}
          </p>
        </div>
      </header>

      <div className="mt-2.5 flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-base-950 p-2">
        <GameArt
          cover={jogo.cover}
          icon={jogo.icon}
          className="h-10 w-10 rounded-[6px]"
          iconClassName="h-[18px] w-[18px]"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-bold text-ink-100">
            {jogo.game}
          </p>
          {decorrido ? (
            <p className="truncate text-[11px] tabular-nums text-ink-500">
              {decorrido} jogado
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
