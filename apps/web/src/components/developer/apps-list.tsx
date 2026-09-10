"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AetherIcon } from "@/components/ui/aether-icon";
import { Modal } from "@/components/ui/modal";
import { initials, colorFromId } from "@/lib/utils";
import { criarAppAction } from "@/server/actions/developer";
import { PortalFrame } from "./portal-frame";

interface AppItem {
  id: string;
  name: string;
  avatarUrl: string | null;
  botHabilitado: boolean;
  instalacoes: number;
}

export function AppsList({ apps }: { apps: AppItem[] }) {
  const router = useRouter();
  const [criando, setCriando] = useState(false);

  return (
    <PortalFrame>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-brand text-xl font-semibold text-ink-100">
            Aplicativos
          </h1>
          <p className="mt-1 text-[13px] text-ink-400">
            Crie um aplicativo, habilite o bot e instale nos seus servidores.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCriando(true)}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-accent-500 px-3.5 text-[13px] font-bold text-white transition-colors hover:bg-accent-400"
        >
          <AetherIcon name="plus" className="h-4 w-4" />
          Novo aplicativo
        </button>
      </div>

      {apps.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-line-strong bg-base-900 px-6 py-12 text-center">
          <p className="text-[13px] text-ink-400">
            Você ainda não tem nenhum aplicativo.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {apps.map((a) => (
            <Link
              key={a.id}
              href={`/app/developers/${a.id}`}
              className="group flex flex-col rounded-xl border border-line bg-base-850 p-4 transition-colors hover:border-line-strong"
            >
              <div
                className="grid h-14 w-14 place-items-center overflow-hidden rounded-2xl text-[16px] font-semibold text-ink-100"
                style={
                  a.avatarUrl ? undefined : { backgroundColor: colorFromId(a.id) }
                }
              >
                {a.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.avatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  initials(a.name)
                )}
              </div>
              <p className="mt-3 truncate text-[13px] font-semibold text-ink-100">
                {a.name}
              </p>
              <p className="mt-0.5 text-[11px] text-ink-500">
                {a.botHabilitado
                  ? a.instalacoes === 1
                    ? "Bot · 1 servidor"
                    : `Bot · ${a.instalacoes} servidores`
                  : "Sem bot"}
              </p>
            </Link>
          ))}
        </div>
      )}

      <CriarAppModal
        open={criando}
        onClose={() => setCriando(false)}
        onCriado={(id) => {
          setCriando(false);
          router.push(`/app/developers/${id}`);
        }}
      />
    </PortalFrame>
  );
}

function CriarAppModal({
  open,
  onClose,
  onCriado,
}: {
  open: boolean;
  onClose: () => void;
  onCriado: (id: string) => void;
}) {
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function criar() {
    setErro(null);
    start(async () => {
      const r = await criarAppAction(nome);
      if (r.ok) {
        setNome("");
        onCriado(r.data.id);
      } else {
        setErro(r.error);
      }
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Novo aplicativo">
      <div className="flex flex-col gap-3 p-1">
        <label className="text-[12px] font-medium text-ink-300">
          Nome do aplicativo
          <input
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && nome.trim() && criar()}
            maxLength={48}
            placeholder="AETHER Music"
            className="mt-1.5 w-full rounded-md border border-line-strong bg-base-900 px-3 py-2 text-[13px] text-ink-100 outline-none focus:border-accent-500"
          />
        </label>
        {erro ? (
          <p className="text-[12px] text-signal-dnd">{erro}</p>
        ) : null}
        <button
          type="button"
          onClick={criar}
          disabled={pending || !nome.trim()}
          className="mt-1 inline-flex h-9 items-center justify-center rounded-md bg-accent-500 px-4 text-[13px] font-bold text-white transition-colors hover:bg-accent-400 disabled:opacity-60"
        >
          {pending ? "Criando…" : "Criar"}
        </button>
      </div>
    </Modal>
  );
}
