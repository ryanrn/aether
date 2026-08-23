"use client";

import { useRef, useState, useTransition } from "react";
import { SERVER_ICON_MAX_BYTES, SERVER_ICON_MIME_TYPES } from "@aether/shared";
import {
  removeServerIconAction,
  uploadServerIconAction,
} from "@/server/actions/servers";
import { Button } from "@/components/ui/button";
import { FieldError, Label } from "@/components/ui/field";
import { colorFromId, initials } from "@/lib/utils";

/**
 * Upload de icone do servidor.
 *
 * A validacao de tamanho/tipo aqui e so conveniencia de UX — o servidor
 * revalida os dois (tamanho, e o tipo real pelos bytes, nao pelo que o
 * navegador declarou) antes de gravar qualquer coisa no Storage.
 */
export function ServerIconField({
  serverId,
  serverName,
  serverIconUrl,
}: {
  serverId: string;
  serverName: string;
  serverIconUrl: string | null;
}) {
  const [iconUrl, setIconUrl] = useState(serverIconUrl);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function pickFile() {
    setError(null);
    inputRef.current?.click();
  }

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // permite escolher o mesmo arquivo de novo depois
    if (!file) return;

    setError(null);

    if (file.size > SERVER_ICON_MAX_BYTES) {
      setError("Imagem maior que 2MB");
      return;
    }
    if (!SERVER_ICON_MIME_TYPES.includes(file.type as never)) {
      setError("Envie PNG, JPEG ou WEBP");
      return;
    }

    const formData = new FormData();
    formData.set("icon", file);

    startTransition(async () => {
      const result = await uploadServerIconAction(serverId, formData);
      if (result.ok) setIconUrl(result.data.iconUrl);
      else setError(result.error);
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await removeServerIconAction(serverId);
      if (result.ok) setIconUrl(null);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label>Icone do servidor</Label>
      <div className="flex items-center gap-3">
        <div
          className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg text-lg font-semibold text-ink-100"
          style={iconUrl ? undefined : { backgroundColor: colorFromId(serverId) }}
        >
          {iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={iconUrl}
              alt={serverName}
              className="h-full w-full object-cover"
            />
          ) : (
            initials(serverName)
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={pickFile}
              disabled={pending}
            >
              {pending ? "Enviando..." : "Escolher imagem"}
            </Button>
            {iconUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={remove}
                disabled={pending}
              >
                Remover
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-ink-500">PNG, JPEG ou WEBP — ate 2MB.</p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={SERVER_ICON_MIME_TYPES.join(",")}
        onChange={onFileChange}
        className="hidden"
      />

      <FieldError>{error}</FieldError>
    </div>
  );
}
