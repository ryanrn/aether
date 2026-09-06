import type { Metadata } from "next";
import Link from "next/link";
import { consumirTokenDeVerificacao } from "@aether/access";
import { AetherIcon } from "@/components/ui/aether-icon";
import { getSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Confirmar e-mail" };

/**
 * O token vem na URL — pagina nao indexavel, nao cacheavel. O consumo do token
 * acontece aqui no servidor, na carga: nao ha input do usuario, so "confirmar".
 * E o mesmo padrao do link de redefinicao de senha.
 */
export const dynamic = "force-dynamic";

export default async function VerificarPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const resultado = await consumirTokenDeVerificacao(token ?? "");
  const session = await getSession();
  const destino = session ? "/app" : "/login";
  const rotuloDestino = session ? "Ir para o app" : "Entrar";

  const sucesso = resultado.ok;
  const titulo = sucesso
    ? resultado.jaEstava
      ? "E-mail já estava confirmado"
      : "E-mail confirmado"
    : "Não consegui confirmar";

  const detalhe = sucesso
    ? "Sua conta está liberada."
    : resultado.motivo === "expirado"
      ? "Esse link expirou. Entre na conta e peça um novo na tela de confirmação."
      : resultado.motivo === "usado"
        ? "Esse link já foi usado. Se ainda não confirmou, peça um novo dentro do app."
        : "Esse link não é válido. Confira se copiou o endereço inteiro.";

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <div
        className={`grid h-12 w-12 place-items-center rounded-full ${
          sucesso ? "bg-signal-online/15" : "bg-signal-dnd/15"
        }`}
      >
        <AetherIcon
          name={sucesso ? "check" : "x"}
          className={`h-5 w-5 ${sucesso ? "text-signal-online" : "text-signal-dnd"}`}
        />
      </div>

      <div>
        <h1 className="text-lg font-semibold text-ink-100">{titulo}</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-400">{detalhe}</p>
      </div>

      <Link
        href={destino}
        className="rounded-sm bg-accent-500 px-5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-accent-600"
      >
        {rotuloDestino}
      </Link>
    </div>
  );
}
