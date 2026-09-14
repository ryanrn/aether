import { redirect } from "next/navigation";
import { consumirCodigoLoginDesktop } from "@/server/auth/desktop-handoff";
import { createSession } from "@/server/auth/session";

/**
 * Ultimo passo do login Google no app desktop.
 *
 * `deep-link.js` resolveu `aether://login-callback/<codigo>` pra
 * `/desktop-login/<codigo>` e mandou a JANELA JA ABERTA (client-side, via
 * `desktop:deep-link`) navegar pra ca — por isso esta requisicao roda no
 * `session.defaultSession` do Electron, o cookie jar que a janela principal
 * usa. Trocar o codigo por uma sessao AQUI e o que faz a sessao aparecer
 * onde precisa: na janela do app, nao no navegador do sistema onde o Google
 * respondeu.
 */
export default async function DesktopLoginPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const userId = await consumirCodigoLoginDesktop(code);
  if (!userId) redirect("/login?erro=google&motivo=handoff_invalido");

  await createSession(userId);
  redirect("/app");
}
