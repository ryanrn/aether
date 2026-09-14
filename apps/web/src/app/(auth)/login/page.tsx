import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PENDENTE_2FA_COOKIE, verifyPendente2faToken } from "@aether/access";
import { LoginForm } from "@/components/auth/login-form";
import { sanitizeNextPath } from "@/lib/next-path";
import { getSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  /**
   * Quem ja tem sessao (DB-checada, nao so o cookie assinado) pula direto pro
   * destino. ISTO MORAVA NO `middleware.ts` — saiu de la porque o middleware
   * (Edge) so confere a ASSINATURA do JWT, nunca revogacao no banco. Um
   * cookie assinado mas revogado (troca de senha, "sair de tudo") fazia o
   * middleware mandar de volta pra `/app`, o layout de `/app` (que ESSE sim
   * confere o banco) mandar de volta pra `/login`, e dai em diante:
   * ERR_TOO_MANY_REDIRECTS. Aqui a checagem ja fala com o banco mesmo (mesmo
   * `getSession()` que `/app/layout.tsx` usa), entao nao ha essa divergencia.
   */
  if (await getSession()) redirect(sanitizeNextPath(next));

  // `""` quando nao ha destino valido — o form omite o campo e a action cai
  // no padrao `/app`.
  const destino =
    next && sanitizeNextPath(next) !== "/app" ? sanitizeNextPath(next) : "";
  const registro = destino
    ? `/register?next=${encodeURIComponent(destino)}`
    : "/register";

  /**
   * Senha ja confirmada, aguardando o segundo fator — sobrevive a um reload
   * da pagina. Sem isto, recarregar no meio do 2FA perderia o estado (que
   * hoje vive so no React do `LoginForm`) e voltaria pro formulario de
   * senha, mesmo com o cookie pendente ainda valido.
   */
  const cookieStore = await cookies();
  const precisa2faInicial =
    (await verifyPendente2faToken(cookieStore.get(PENDENTE_2FA_COOKIE)?.value)) !==
    null;

  return (
    <>
      <h1 className="font-brand text-2xl font-semibold tracking-[-0.005em] text-ink-100">
        Bem-vindo de volta.
      </h1>
      <p className="mt-1.5 text-sm text-ink-400">
        Entre na sua conta para continuar.
      </p>

      <div className="mt-7">
        <LoginForm next={destino} precisa2faInicial={precisa2faInicial} />
      </div>

      <p className="mt-6 text-center text-[13px] text-ink-400">
        Não tem uma conta?{" "}
        <Link
          href={registro}
          className="text-accent-300 transition-colors hover:text-accent-400"
        >
          Crie sua conta
        </Link>
      </p>
    </>
  );
}
