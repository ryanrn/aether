import { EmptyState } from "@/components/layout/empty-state";

export default function ServerHomePage() {
  return (
    <EmptyState
      title="Selecione um canal"
      description="Canais de texto abrem o historico de mensagens; canais de voz conectam voce ao audio do grupo."
    />
  );
}
