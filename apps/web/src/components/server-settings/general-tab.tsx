"use client";

import { useState, useTransition } from "react";
import type { PublicMember, ViewerContext } from "@aether/shared";
import { updateServerAction } from "@/server/actions/servers";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input } from "@/components/ui/field";
import { ServerIconField } from "./server-icon-field";
import { VitrineSection } from "./vitrine-section";
import { TransferOwnershipModal } from "./transfer-ownership-modal";
import { DeleteServerModal } from "./delete-server-modal";

export function GeneralTab({
  serverId,
  serverName,
  serverIconUrl,
  members,
  viewer,
}: {
  serverId: string;
  serverName: string;
  serverIconUrl: string | null;
  members: PublicMember[];
  viewer: ViewerContext;
}) {
  const [name, setName] = useState(serverName);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [transferring, setTransferring] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateServerAction({ serverId, name });
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  }

  return (
    <section className="flex max-w-[460px] flex-col gap-4">
      <ServerIconField
        serverId={serverId}
        serverName={serverName}
        serverIconUrl={serverIconUrl}
      />

      <Field label="Nome do servidor">
        <Input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setSaved(false);
          }}
          maxLength={48}
        />
      </Field>

      <FieldError>{error}</FieldError>

      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          onClick={save}
          disabled={pending || name.trim() === serverName}
        >
          {pending ? "Salvando..." : "Salvar"}
        </Button>
        {saved ? (
          <span className="text-[13px] text-signal-online">Salvo.</span>
        ) : null}
      </div>

      {/*
        SO O DONO DE VERDADE VE ISTO, nunca quem tem MANAGE_SERVER por cargo
        (um Administrador, por exemplo). `viewer.isOwner` vem de
        `Server.ownerId`, nao da permissao — as duas acoes daqui mudam ou
        acabam com o servidor inteiro, e isso e mais que "gerenciar".
      */}
      {viewer.isOwner ? (
        <div className="mt-2 flex flex-col gap-3 rounded-md border border-signal-dnd/30 bg-signal-dnd/5 p-3">
          <p className="text-[11px] uppercase tracking-[0.1em] text-signal-dnd">
            Zona de risco
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[13px] text-ink-200">Transferir posse</p>
              <p className="text-[12px] text-ink-500">
                Outra pessoa passa a ser a dona do servidor.
              </p>
            </div>
            <Button variant="outline" onClick={() => setTransferring(true)}>
              Transferir
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-signal-dnd/20 pt-3">
            <div>
              <p className="text-[13px] text-ink-200">Excluir servidor</p>
              <p className="text-[12px] text-ink-500">
                Apaga tudo para sempre. Nao tem volta.
              </p>
            </div>
            <Button variant="danger" onClick={() => setDeleting(true)}>
              Excluir
            </Button>
          </div>
        </div>
      ) : null}

      <VitrineSection serverId={serverId} />

      {transferring ? (
        <TransferOwnershipModal
          serverId={serverId}
          members={members.filter((member) => member.id !== viewer.memberId)}
          onClose={() => setTransferring(false)}
        />
      ) : null}

      {deleting ? (
        <DeleteServerModal
          serverId={serverId}
          serverName={serverName}
          onClose={() => setDeleting(false)}
        />
      ) : null}
    </section>
  );
}
