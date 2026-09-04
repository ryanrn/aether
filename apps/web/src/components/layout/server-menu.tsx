"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AetherIcon } from "@/components/ui/aether-icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { leaveServerAction } from "@/server/actions/servers";
import { cn } from "@/lib/utils";

/**
 * O nome do servidor no cabecalho da coluna, com o menu que faltava.
 *
 * POR QUE EXISTE: `leaveServerAction` estava pronta desde a fase 6 e nunca
 * chegou a ter botao. Quem entrava num servidor e nao era dono nem tinha
 * permissao de gerir NAO VIA nenhuma acao no cabecalho — so o nome. Nao havia
 * como sair, e ficar preso num servidor por falta de UI e falha de produto.
 *
 * O DONO NAO GANHA MENU. Ele nao pode sair (a action recusa: o servidor
 * ficaria sem dono), e sai transferindo a posse ou excluindo — as duas coisas
 * em Configuracoes do servidor. Um menu com um item desabilitado seria pior do
 * que nao ter menu, entao para ele o cabecalho fica exatamente como era.
 */
const CLASSE_TITULO =
  "min-w-0 flex-1 truncate text-[14px] font-bold uppercase tracking-[0.04em] text-ink-100";

export function ServerMenu({
  serverId,
  serverName,
  isOwner,
}: {
  serverId: string;
  serverName: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [saindo, startTransition] = useTransition();

  useEffect(() => {
    if (!aberto) return;
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") setAberto(false);
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto]);

  if (isOwner) return <h2 className={CLASSE_TITULO}>{serverName}</h2>;

  function sair() {
    setErro(null);
    startTransition(async () => {
      const resultado = await leaveServerAction(serverId);
      if (!resultado.ok) {
        setErro(resultado.error);
        return;
      }
      setConfirmando(false);
      /**
       * Sai da rota do servidor ANTES de qualquer coisa: a pagina atual acabou
       * de deixar de ser acessivel para esta pessoa, e ficar nela renderizaria
       * um 404 no lugar do app.
       */
      router.push("/app");
      router.refresh();
    });
  }

  return (
    <div className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        title={serverName}
        className="group flex w-full min-w-0 items-center gap-1.5 rounded-md text-left transition-colors hover:text-ink-100"
      >
        <span className={CLASSE_TITULO}>{serverName}</span>
        <AetherIcon
          name="chevron"
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-ink-500 transition-transform duration-150",
            "group-hover:text-ink-300",
            aberto && "rotate-180",
          )}
        />
      </button>

      {aberto ? (
        <>
          {/* Clique fora fecha. Cobre a tela inteira, atras do menu. */}
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setAberto(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            className="absolute left-0 top-[calc(100%+6px)] z-50 w-[216px] animate-rise rounded-lg border border-line bg-base-800 p-1 shadow-[var(--shadow-pop)]"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setAberto(false);
                setConfirmando(true);
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-signal-dnd transition-colors hover:bg-signal-dnd/10"
            >
              <AetherIcon name="disconnect" className="h-3.5 w-3.5 shrink-0" />
              Sair do servidor
            </button>
          </div>
        </>
      ) : null}

      <ConfirmDialog
        open={confirmando}
        onClose={() => {
          setConfirmando(false);
          setErro(null);
        }}
        title="Sair do servidor"
        confirmLabel="Sair do servidor"
        pendingLabel="Saindo..."
        pending={saindo}
        onConfirm={sair}
      >
        Voce vai deixar de ver os canais e as mensagens de{" "}
        <strong className="font-semibold text-ink-100">{serverName}</strong>. Da
        para voltar com um convite novo — o historico do servidor nao e apagado.
        {erro ? (
          <span className="mt-2 block text-signal-dnd">{erro}</span>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
