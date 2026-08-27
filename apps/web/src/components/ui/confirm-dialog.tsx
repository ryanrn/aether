"use client";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

/**
 * Confirmacao de acao destrutiva, na linguagem do app.
 *
 * POR QUE EXISTE: tres lugares ainda usavam `window.confirm` — excluir canal,
 * excluir categoria e excluir cargo. No app de desktop aquilo abre a caixa
 * NATIVA do Windows, com a fonte do sistema, o titulo "@aether/desktop" e os
 * botoes OK/Cancelar em ingles. Fora o visual, ela mente sobre o que esta
 * acontecendo: parece um aviso do sistema operacional, e nao do aplicativo.
 *
 * O projeto ja tinha decidido isso uma vez — `member-moderation-modal.tsx`
 * carrega o comentario "a confirmacao nao e `window.confirm`". Estes tres so
 * ficaram para tras. Virou componente para nao ficar uma quarta copia da mesma
 * decisao na proxima vez.
 *
 * A DIFERENCA PRATICA em relacao ao `confirm` nativo: ele e SINCRONO e
 * bloqueia a aba inteira; este e estado. Quem chama guarda o que esta prestes
 * a apagar e limpa quando termina — um pouco mais de codigo em troca de a
 * janela nao congelar e de o botao poder dizer "Excluindo..." enquanto age.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  /** O texto do meio. Aceita nodes para poder destacar o nome do que sera apagado. */
  children,
  confirmLabel,
  pendingLabel,
  pending = false,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} className="max-w-[420px]">
      <p className="text-[13px] leading-relaxed text-ink-300">{children}</p>

      <div className="mt-5 flex justify-end gap-2">
        {/*
          Cancelar vem PRIMEIRO e sem cor, e confirmar por ultimo em vermelho.
          A ordem importa: em caixa de acao destrutiva, o botao que a pessoa
          alcanca por engano deve ser o que nao apaga nada.
        */}
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        {/*
          Sem sobrescrita de cor: a variante `danger` JA e vermelho solido.
          
          Ate a troca de paleta ela era discreta (fundo translucido, texto
          colorido) e este componente a sobrescrevia para gritar. Agora o
          global mudou, e manter a sobrescrita seria pior do que redundante:
          ela apagava a sombra e o estado `active:` que a variante nova traz.
          
          A justificativa antiga — "a `danger` vive dentro de listas e gritar
          cansaria" — nao se sustentava: `variant="danger"` aparece em tres
          lugares, todos confirmacao deliberada. Quem vive em lista e o
          `IconAction`, que nunca usou esta variante.
        */}
        <Button variant="danger" onClick={onConfirm} disabled={pending}>
          {pending ? (pendingLabel ?? "Excluindo...") : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
