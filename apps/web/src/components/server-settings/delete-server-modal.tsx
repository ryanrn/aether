"use client";

import { useState, useTransition } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { deleteServerAction } from "@/server/actions/servers";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input } from "@/components/ui/field";

/**
 * Excluir o servidor. Sem volta — o cascade do banco leva membros, cargos,
 * canais, mensagens, convites, banimentos e o proprio log de auditoria.
 *
 * So pede a senha, sem "digite o nome do servidor": a conta ja e dona, a
 * senha ja prova que e ela na frente da tela, e um segundo campo de texto
 * livre so repetiria a mesma pergunta de um jeito mais lento de errar.
 */
export function DeleteServerModal({
  serverId,
  serverName,
  onClose,
}: {
  serverId: string;
  serverName: string;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!password) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteServerAction({ serverId, password });
      // Sucesso redireciona por dentro da action (redirect()); so chega aqui
      // se algo deu errado.
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <Modal open onClose={onClose} title={`Excluir ${serverName}`}>
      <div className="flex flex-col gap-4">
        <p className="text-[13px] leading-relaxed text-signal-dnd">
          Isto apaga o servidor para SEMPRE: todos os canais, mensagens, cargos,
          membros, convites e banimentos somem junto. Nao ha como desfazer.
        </p>

        <Field label="Sua senha" required>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Confirme com a senha da sua conta"
          />
        </Field>

        {error ? <FieldError>{error}</FieldError> : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={submit}
            disabled={pending || !password}
          >
            <AetherIcon name="trash" className="h-3.5 w-3.5" />
            {pending ? "Excluindo..." : "Excluir servidor"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
