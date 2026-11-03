"use client";

import { useEffect, useState } from "react";
import {
  adaptadorDoJogo,
  COMO_ENTRAR_MAX,
  limparComoEntrar,
  type ConviteDeJogo,
} from "@aether/shared";
import { AetherIcon } from "@/components/ui/aether-icon";
import { Avatar } from "@/components/ui/avatar";
import { GameArt } from "@/components/profile/game-art";
import { useConvitesStore } from "@/lib/stores/convites-store";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import { toast } from "@/lib/stores/toast-store";
import { copiarTexto } from "@/lib/clipboard";
import { useConvites } from "@/lib/use-convites";

/** Mais que isso empilhado vira ruido; o resto espera a vez. */
const VISIVEIS = 3;

function useAgora(intervaloMs: number): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), intervaloMs);
    return () => clearInterval(t);
  }, [intervaloMs]);
  return agora;
}

/**
 * Convites de jogo na tela — em qualquer lugar do app, como a chamada direta.
 *
 * Dois tipos de cartao:
 * - RECEBIDO e pendente: aceitar/recusar. Num PEDIDO voce e o anfitriao, entao
 *   o cartao pergunta "como entrar" (opcional) — e o que o outro vai ver.
 * - RESULTADO aceito que importa a voce: o "como entrar" para copiar, ou o
 *   aviso de que o amigo topou e agora e com voce no jogo. Fica ate fechar.
 *
 * Recusa e expiracao viram aviso curto no provider; nao precisam de cartao.
 * Nenhuma entrada automatica no jogo: nao ha integracao oficial para isso
 * (docs/ativo-agora.md) e o cartao diz o que fazer em vez de fingir. O campo,
 * o exemplo e a instrucao vem do adaptador do jogo
 * (`adaptadores-de-jogo.ts`); o gateway valida o mesmo formato.
 */
export function ConvitesOverlay() {
  const eu = useRealtimeStore((estado) => estado.selfUserId);
  const porId = useConvitesStore((estado) => estado.porId);
  const dispensados = useConvitesStore((estado) => estado.dispensados);
  const agora = useAgora(15_000);

  if (!eu) return null;

  const cartoes = Object.values(porId)
    .filter((c) => {
      if (dispensados[c.id]) return false;
      if (c.estado === "pendente") {
        return c.para.id === eu && new Date(c.expiraEm).getTime() > agora;
      }
      return c.estado === "aceito";
    })
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
    .slice(0, VISIVEIS);

  if (cartoes.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 left-4 z-[69] flex w-[min(340px,calc(100vw-32px))] flex-col gap-2"
    >
      {cartoes.map((c) =>
        c.estado === "pendente" ? (
          <CartaoRecebido key={c.id} convite={c} agora={agora} />
        ) : (
          <CartaoAceito key={c.id} convite={c} eu={eu} />
        ),
      )}
    </div>
  );
}

function Moldura({ convite, children }: { convite: ConviteDeJogo; children: React.ReactNode }) {
  return (
    <div
      role="alertdialog"
      className="animate-rise rounded-xl border border-line bg-base-850 p-3 shadow-2xl"
    >
      <div className="flex items-center gap-2.5">
        <GameArt
          cover={convite.jogoCapa}
          icon={null}
          className="h-10 w-10 shrink-0 rounded-[6px]"
          iconClassName="h-5 w-5"
        />
        {children}
      </div>
    </div>
  );
}

function CartaoRecebido({ convite, agora }: { convite: ConviteDeJogo; agora: number }) {
  const { responder, ocupado } = useConvites();
  const [comoEntrar, setComoEntrar] = useState("");
  const souAnfitriao = convite.tipo === "pedir";
  const adaptador = adaptadorDoJogo(convite.jogo);
  // Mesma limpeza e mesmo formato do gateway, para avisar antes de enviar.
  const limpo = limparComoEntrar(comoEntrar);
  const erro = limpo ? adaptador.comoEntrar.validar(limpo) : null;
  const minutos = Math.max(1, Math.ceil((new Date(convite.expiraEm).getTime() - agora) / 60_000));

  return (
    <Moldura convite={convite}>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[13px] text-ink-100">
          <Avatar
            userId={convite.de.id}
            name={convite.de.displayName}
            src={convite.de.avatarUrl}
            size="xs"
            round
            ring="border-base-850"
          />
          <span className="truncate font-bold">{convite.de.displayName}</span>
        </p>
        <p className="mt-0.5 text-[12px] text-ink-300">
          {souAnfitriao
            ? `quer entrar no seu ${convite.jogo}`
            : `te chamou para jogar ${convite.jogo}`}
          <span className="text-ink-500"> · expira em {minutos} min</span>
        </p>

        {souAnfitriao ? (
          <label className="mt-2 block">
            <span className="text-[11px] text-ink-500">
              Seu {adaptador.comoEntrar.rotulo} (opcional) — so {convite.de.displayName} ve
            </span>
            <input
              value={comoEntrar}
              onChange={(e) => setComoEntrar(e.target.value)}
              maxLength={COMO_ENTRAR_MAX}
              placeholder={adaptador.comoEntrar.exemplo}
              aria-invalid={erro ? true : undefined}
              className={`mt-1 w-full rounded-md border bg-base-950 px-2 py-1.5 text-[12px] text-ink-100 placeholder:text-ink-500 focus:outline-none ${erro ? "border-signal-dnd" : "border-line focus:border-ink-500"}`}
            />
            {erro ? <span className="mt-1 block text-[11px] text-signal-dnd">{erro}</span> : null}
          </label>
        ) : convite.comoEntrar ? (
          <p className="mt-2 truncate rounded-md bg-base-950 px-2 py-1.5 text-[12px] text-ink-200">
            <span className="text-ink-500">{adaptador.comoEntrar.rotulo}: </span>
            <span className="font-mono">{convite.comoEntrar}</span>
          </p>
        ) : null}

        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            disabled={ocupado || erro !== null}
            onClick={() => responder(convite.id, true, souAnfitriao ? comoEntrar : undefined)}
            className="flex-1 rounded-md bg-ink-100 px-2 py-1.5 text-[12px] font-bold text-base-950 transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Aceitar
          </button>
          <button
            type="button"
            disabled={ocupado}
            onClick={() => responder(convite.id, false)}
            className="flex-1 rounded-md border border-line px-2 py-1.5 text-[12px] font-bold text-ink-300 transition-colors hover:bg-base-800 disabled:opacity-50"
          >
            Recusar
          </button>
        </div>
      </div>
    </Moldura>
  );
}

/**
 * Aceito. O que mostrar depende de QUEM le:
 * - quem vai ENTRAR (remetente do pedido / destinatario do convite): o "como
 *   entrar" do anfitriao, com copiar; sem ele, a orientacao generica;
 * - o ANFITRIAO: "topou — chame no jogo".
 */
function CartaoAceito({ convite, eu }: { convite: ConviteDeJogo; eu: string }) {
  const dispensar = useConvitesStore((estado) => estado.dispensar);
  const souAnfitriao = convite.anfitriaoId === eu;
  const outro = convite.de.id === eu ? convite.para : convite.de;
  const adaptador = adaptadorDoJogo(convite.jogo);

  async function copiar() {
    if (!convite.comoEntrar) return;
    if (await copiarTexto(convite.comoEntrar)) toast.sucesso("Copiado.");
    else toast.erro("Nao deu para copiar.");
  }

  return (
    <Moldura convite={convite}>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-[13px] text-ink-100">
            <span className="font-bold">{outro.displayName}</span>{" "}
            {souAnfitriao
              ? convite.tipo === "convidar"
                ? `topou jogar ${convite.jogo}.`
                : `vai entrar no seu ${convite.jogo}.`
              : `aceitou. Bora de ${convite.jogo}!`}
          </p>
          <button
            type="button"
            onClick={() => dispensar(convite.id)}
            aria-label="Fechar"
            title="Fechar"
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-ink-500 hover:bg-base-800 hover:text-ink-100"
          >
            <AetherIcon name="x" className="h-3.5 w-3.5" />
          </button>
        </div>

        {souAnfitriao ? (
          <p className="mt-1 text-[12px] text-ink-400">
            Chame {outro.displayName} pela lista de amigos do jogo.
          </p>
        ) : convite.comoEntrar ? (
          <div className="mt-2 flex items-center gap-1.5">
            <p className="min-w-0 flex-1 truncate rounded-md bg-base-950 px-2 py-1.5 text-[12px] text-ink-200">
              <span className="text-ink-500">{adaptador.comoEntrar.rotulo}: </span>
              <span className="font-mono">{convite.comoEntrar}</span>
            </p>
            <button
              type="button"
              onClick={copiar}
              title="Copiar"
              aria-label="Copiar como entrar"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line text-ink-300 hover:bg-base-800 hover:text-ink-100"
            >
              <AetherIcon name="copy" className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
        {souAnfitriao ? null : (
          <p className="mt-1.5 text-[11px] leading-snug text-ink-500">
            {adaptador.comoEntrar.instrucao}
          </p>
        )}
      </div>
    </Moldura>
  );
}
