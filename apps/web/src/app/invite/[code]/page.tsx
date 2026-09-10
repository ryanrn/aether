import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { BRAND, inviteCodeSchema } from "@aether/shared";
import { getSession } from "@/server/auth/session";
import { invitePreview } from "@/server/services/invites";
import { clientKey, rateLimit } from "@/server/auth/rate-limit";
import { initials, colorFromId } from "@/lib/utils";
import { AetherIcon } from "@/components/ui/aether-icon";
import { AcceptInviteButton } from "@/components/invite/accept-invite-button";
import { OpenInDesktop } from "@/components/invite/open-in-desktop";

export const metadata: Metadata = {
  title: "Convite",
  // Convite e link privado — nao entra em indice de busca.
  robots: { index: false, follow: false },
};

/**
 * Pagina de convite — `/invite/<codigo>`.
 *
 * NAO fica sob `/app`: precisa abrir para quem nao esta logado (Cenario 4). O
 * `middleware` nao cobre esta rota; a checagem de sessao e feita aqui.
 *
 * Mostra a PREVIA do servidor (nome, icone, contagem) antes de aceitar — ter
 * o codigo valido e a autorizacao para ver isso, igual ao Discord. Aceitar
 * chama a action, que revalida convite/ban/duplicidade/limite no servidor:
 * o link nunca e bypass de autorizacao.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: rawCode } = await params;
  const parsed = inviteCodeSchema.safeParse(rawCode);
  const session = await getSession();

  if (!parsed.success) {
    return <Shell><Erro titulo="Convite invalido" texto="Esse link nao parece um convite do AETHER." /></Shell>;
  }
  const code = parsed.data;

  // Freio leve contra enumeracao de codigos. O espaco e de ~49 bits, entao
  // isto e defesa em profundidade, nao a linha de frente.
  const limite = await rateLimit(await clientKey("invite-preview"), 40, 60_000);
  if (!limite.ok) {
    return (
      <Shell>
        <Erro
          titulo="Muitas tentativas"
          texto={`Aguarde ${limite.retryAfter}s e recarregue a pagina.`}
        />
      </Shell>
    );
  }

  const preview = await invitePreview(code, session?.user.id);

  if (!preview.ok) {
    const titulo =
      preview.motivo === "expirado"
        ? "Convite expirado"
        : preview.motivo === "revogado"
          ? "Convite indisponivel"
          : preview.motivo === "esgotado"
            ? "Convite esgotado"
            : "Convite invalido";
    return (
      <Shell>
        <Erro titulo={titulo} texto={preview.error} />
      </Shell>
    );
  }

  const { server, jaMembro, banido } = preview.data;

  return (
    <Shell>
      <div className="rounded-xl border border-line bg-base-850 p-6 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-500">
          {jaMembro ? "Voce ja participa de" : "Voce foi convidado para entrar em"}
        </p>

        <div className="mx-auto mt-4 grid h-16 w-16 place-items-center overflow-hidden rounded-2xl text-lg font-semibold text-ink-100"
          style={server.iconUrl ? undefined : { backgroundColor: colorFromId(server.id) }}
        >
          {server.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={server.iconUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            initials(server.name)
          )}
        </div>

        <h1 className="mt-3 font-brand text-xl font-semibold tracking-[-0.005em] text-ink-100">
          {server.name}
        </h1>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-[12px] text-ink-400">
          <AetherIcon name="users" className="h-3.5 w-3.5" />
          {server.memberCount}{" "}
          {server.memberCount === 1 ? "membro" : "membros"}
        </p>

        <div className="mt-6">
          {banido ? (
            <p className="rounded-md border border-signal-dnd/30 bg-signal-dnd/10 px-3 py-2.5 text-[13px] text-signal-dnd">
              Voce nao pode entrar neste servidor.
            </p>
          ) : jaMembro ? (
            <Link
              href={`/app/s/${server.id}`}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-accent-500 px-4 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-accent-400"
            >
              <AetherIcon name="arrow-left" className="h-4 w-4 rotate-180" />
              Abrir servidor
            </Link>
          ) : session ? (
            <AcceptInviteButton code={code} />
          ) : (
            <div className="flex flex-col gap-2">
              <Link
                href={`/login?next=${encodeURIComponent(`/invite/${code}`)}`}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-accent-500 px-4 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-accent-400"
              >
                Entrar ou criar conta
              </Link>
              <p className="text-[11px] text-ink-500">
                Depois de entrar, voce volta direto para este convite.
              </p>
            </div>
          )}
        </div>

        {!banido ? <OpenInDesktop code={code} /> : null}
      </div>
    </Shell>
  );
}

/** Moldura comum: marca do AETHER + card centralizado, funciona no celular. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center bg-base-950 px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(600px 380px at 50% 0%, color-mix(in oklch, var(--color-accent-500) 14%, transparent), transparent 70%)",
        }}
      />
      <div className="relative w-full max-w-[380px]">
        <Link
          href="/"
          aria-label={`${BRAND.name} — inicio`}
          className="mb-7 flex items-center justify-center gap-2.5"
        >
          <Image src="/marca.png" alt="" width={30} height={30} className="rounded-[8px]" />
          <span className="font-brand text-base font-bold tracking-[0.22em] text-ink-100">
            {BRAND.name}
          </span>
        </Link>
        {children}
      </div>
    </div>
  );
}

function Erro({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="rounded-xl border border-line bg-base-850 p-6 text-center">
      <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-full bg-signal-dnd/12">
        <AetherIcon name="x" className="h-5 w-5 text-signal-dnd" />
      </div>
      <h1 className="text-sm font-semibold text-ink-100">{titulo}</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-400">{texto}</p>
      <Link
        href="/app"
        className="mt-5 inline-block text-[13px] text-accent-400 transition-colors hover:text-accent-300"
      >
        Ir para o AETHER
      </Link>
    </div>
  );
}
