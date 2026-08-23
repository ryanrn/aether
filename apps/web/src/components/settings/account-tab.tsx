"use client";

import { useRef, useState, useTransition } from "react";
import { SERVER_ICON_MAX_BYTES, SERVER_ICON_MIME_TYPES } from "@aether/shared";
import {
  removeAvatarAction,
  setNicknameAction,
  updateDisplayNameAction,
  uploadAvatarAction,
} from "@/server/actions/profile";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input } from "@/components/ui/field";

/**
 * Minha conta: foto, nome de exibicao e apelido no servidor atual.
 *
 * Era um modal proprio (aberto pelo avatar na barra inferior). Virou aba
 * porque agora existe uma tela de configuracoes do app, e ter dois lugares
 * para editar a mesma coisa e como ter duas engrenagens de servidor — mais
 * caminho para manter, sem nada a mais para a pessoa.
 *
 * A validacao de tamanho e tipo aqui e so conveniencia: o servidor revalida os
 * dois, e o tipo ele confere pelos BYTES do arquivo, nao pelo que o navegador
 * declarou.
 */
export function AccountTab({
  user,
  server,
}: {
  user: {
    id: string;
    displayName: string;
    username: string;
    avatarUrl: string | null;
  };
  /** servidor aberto agora — o apelido vale so nele */
  server: { id: string; memberId: string; nickname: string | null };
}) {
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [nickname, setNickname] = useState(server.nickname ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // permite reescolher o mesmo arquivo depois
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
    formData.set("avatar", file);

    startTransition(async () => {
      const result = await uploadAvatarAction(formData);
      if (result.ok) setAvatarUrl(result.data.avatarUrl);
      else setError(result.error);
    });
  }

  function removeAvatar() {
    setError(null);
    startTransition(async () => {
      const result = await removeAvatarAction();
      if (result.ok) setAvatarUrl(null);
      else setError(result.error);
    });
  }

  function saveName() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateDisplayNameAction(displayName);
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  }

  function saveNickname() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await setNicknameAction(server.id, {
        memberId: server.memberId,
        nickname,
      });
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar
          userId={user.id}
          name={displayName || user.username}
          src={avatarUrl}
          size="lg"
        />
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setError(null);
                inputRef.current?.click();
              }}
              disabled={pending}
            >
              {pending ? "Enviando..." : "Escolher foto"}
            </Button>
            {avatarUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={removeAvatar}
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

      <Field
        label="Nome de exibicao"
        hint={`Vale em todos os servidores. Seu usuario @${user.username} nao muda.`}
      >
        <Input
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.target.value);
            setSaved(false);
          }}
          maxLength={32}
        />
      </Field>

      <div className="border-t border-base-800 pt-5">
        <Field
          label="Apelido neste servidor"
          hint="Vale so aqui. Vazio volta ao seu nome de exibicao."
        >
          <Input
            value={nickname}
            onChange={(event) => {
              setNickname(event.target.value);
              setSaved(false);
            }}
            placeholder={displayName}
            maxLength={32}
          />
        </Field>
      </div>

      <FieldError>{error}</FieldError>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          onClick={saveName}
          disabled={pending || displayName.trim() === user.displayName}
        >
          {pending ? "Salvando..." : "Salvar nome"}
        </Button>
        <Button
          variant="secondary"
          onClick={saveNickname}
          disabled={pending || nickname.trim() === (server.nickname ?? "")}
        >
          Salvar apelido
        </Button>
        {saved ? (
          <span className="text-[13px] text-signal-online">Salvo.</span>
        ) : null}
      </div>
    </section>
  );
}
