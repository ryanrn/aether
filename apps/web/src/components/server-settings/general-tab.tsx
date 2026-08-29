"use client";

import { useState, useTransition } from "react";
import { updateServerAction } from "@/server/actions/servers";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input } from "@/components/ui/field";
import { ServerIconField } from "./server-icon-field";
import { VitrineSection } from "./vitrine-section";

export function GeneralTab({
  serverId,
  serverName,
  serverIconUrl,
}: {
  serverId: string;
  serverName: string;
  serverIconUrl: string | null;
}) {
  const [name, setName] = useState(serverName);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

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

      <div className="mt-2 rounded-md border border-base-700 bg-base-900 p-3">
        <p className="text-[11px] uppercase tracking-[0.1em] text-ink-500">
          Ainda nao disponivel
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-400">
          Transferencia de posse e exclusao do servidor ainda nao existem.
        </p>
      </div>
      <VitrineSection serverId={serverId} />
    </section>
  );
}
