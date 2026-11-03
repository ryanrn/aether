"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { VozDeAmigo } from "@aether/shared";
import { Avatar } from "@/components/ui/avatar";
import { AetherIcon } from "@/components/ui/aether-icon";
import { useElapsed } from "@/lib/use-elapsed";
import { useEntrarNaVoz } from "@/lib/voice/use-entrar-na-voz";

/** Quantos rostos cabem empilhados antes do "+N". */
const ROSTOS = 4;

export function caminhoDoCanal(voz: Pick<VozDeAmigo, "serverId" | "channelId">): string {
  return `/app/s/${voz.serverId}/c/${voz.channelId}`;
}

/**
 * A call de um amigo, dentro do cartao do "Ativo agora".
 *
 * Tudo o que esta aqui ja chegou filtrado pelo gateway (`friend:voice`): se o
 * cartao existe, voce pode VER o canal. Poder ENTRAR e outra pergunta, que so
 * o `voice:join` responde — falta de `CONNECT` e canal cheio voltam de la e
 * aparecem no banner de conexao, como em qualquer outra entrada.
 *
 * O "Cheio" daqui e so um aviso antecipado com o numero que temos; o botao
 * some para nao convidar a um clique que vai ser recusado.
 */
export function ChamadaDoAmigo({
  voz,
  membrosAbertosDeInicio = false,
}: {
  voz: VozDeAmigo;
  /** "Ver membros da call" do menu do amigo abre ja com a lista aberta. */
  membrosAbertosDeInicio?: boolean;
}) {
  const router = useRouter();
  const { entrar, canalAtual } = useEntrarNaVoz();
  const [membrosAbertos, setMembrosAbertos] = useState(membrosAbertosDeInicio);
  const decorrido = useElapsed(voz.desde);

  const jaEstou = canalAtual === voz.channelId;
  const cheio = voz.userLimit !== null && voz.total >= voz.userLimit && !jaEstou;
  const extras = voz.total - Math.min(voz.participantes.length, ROSTOS);

  function entrarNoCanal() {
    entrar(voz.channelId);
    router.push(caminhoDoCanal(voz));
  }

  return (
    <div className="mt-3 rounded-lg border border-line bg-base-950 p-2.5">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[8px] bg-base-800">
          {voz.serverIconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={voz.serverIconUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <AetherIcon name="voice" className="h-4 w-4 text-ink-300" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-[13px] font-bold text-ink-100">
            <AetherIcon name="volume" className="h-3.5 w-3.5 shrink-0 text-signal-online" />
            <span className="truncate">{voz.channelName}</span>
          </p>
          <p className="truncate text-[12px] text-ink-500">
            {voz.serverName}
            {decorrido ? <span className="tabular-nums"> · {decorrido}</span> : null}
          </p>
        </div>
        {voz.transmitindo ? (
          <span
            title="Transmitindo a tela"
            className="flex shrink-0 items-center gap-1 rounded bg-signal-live/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-signal-live"
          >
            <AetherIcon name="screen-share" className="h-3 w-3" />
            Ao vivo
          </span>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setMembrosAbertos((aberto) => !aberto)}
        aria-expanded={membrosAbertos}
        className="mt-2.5 flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors duration-150 hover:bg-base-800"
        title={membrosAbertos ? "Esconder quem esta na call" : "Ver quem esta na call"}
      >
        <span className="flex -space-x-1.5">
          {voz.participantes.slice(0, ROSTOS).map((u) => (
            <Avatar
              key={u.id}
              userId={u.id}
              name={u.displayName}
              src={u.avatarUrl}
              size="xs"
              round
              ring="border-base-950"
            />
          ))}
        </span>
        {extras > 0 ? (
          <span className="text-[12px] font-bold text-ink-300">+{extras}</span>
        ) : null}
        <span className="ml-auto text-[12px] tabular-nums text-ink-500">
          {voz.userLimit !== null ? `${voz.total}/${voz.userLimit}` : `${voz.total} na call`}
        </span>
        <AetherIcon
          name="chevron"
          className={`h-3.5 w-3.5 text-ink-500 transition-transform duration-150 ${membrosAbertos ? "rotate-180" : ""}`}
        />
      </button>

      {membrosAbertos ? (
        <ul className="mt-1.5 space-y-0.5" aria-label={`Em ${voz.channelName}`}>
          {voz.participantes.map((u) => (
            <li key={u.id} className="flex items-center gap-2 rounded-md px-1 py-1">
              <Avatar
                userId={u.id}
                name={u.displayName}
                src={u.avatarUrl}
                size="xs"
                round
                ring="border-base-950"
              />
              <span className="truncate text-[12px] text-ink-200">{u.displayName}</span>
            </li>
          ))}
          {voz.total > voz.participantes.length ? (
            <li className="px-1 py-1 text-[12px] text-ink-500">
              e mais {voz.total - voz.participantes.length}
            </li>
          ) : null}
        </ul>
      ) : null}

      <div className="mt-2.5 flex gap-1.5">
        {jaEstou ? (
          <span className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-[12px] font-bold text-signal-online">
            <AetherIcon name="check" className="h-3.5 w-3.5" />
            Voce esta aqui
          </span>
        ) : cheio ? (
          <span className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-[12px] font-bold text-ink-500">
            <AetherIcon name="lock" className="h-3.5 w-3.5" />
            Canal cheio
          </span>
        ) : (
          <button
            type="button"
            onClick={entrarNoCanal}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-ink-100 px-2 py-1.5 text-[12px] font-bold text-base-950 transition-opacity duration-150 hover:opacity-90"
          >
            <AetherIcon name="headset" className="h-3.5 w-3.5" />
            Entrar no canal
          </button>
        )}
        <button
          type="button"
          onClick={() => router.push(caminhoDoCanal(voz))}
          title={`Ir para ${voz.serverName}`}
          aria-label={`Ir para ${voz.serverName}`}
          className="grid w-9 shrink-0 place-items-center rounded-md border border-line text-ink-300 transition-colors duration-150 hover:bg-base-800 hover:text-ink-100"
        >
          <AetherIcon name="server" className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
