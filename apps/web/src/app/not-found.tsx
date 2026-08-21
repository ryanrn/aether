import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-500">
          404
        </p>
        <h1 className="mt-3 text-base font-semibold text-ink-100">
          Nao encontramos esta pagina
        </h1>
        <p className="mt-2 max-w-[360px] text-[13px] text-ink-400">
          O recurso nao existe ou voce nao tem acesso a ele.
        </p>
        <Link
          href="/app"
          className="mt-5 inline-block text-[13px] text-accent-400 transition-colors hover:text-accent-300"
        >
          Voltar para o app
        </Link>
      </div>
    </div>
  );
}
