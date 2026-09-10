import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { AetherIcon } from "@/components/ui/aether-icon";
import { NavToggle } from "@/components/layout/nav-mobile";

/**
 * A loja de cosmeticos de perfil.
 *
 * Placeholder por enquanto: o catalogo, as moedas e o fluxo de compra sao um
 * estagio proprio. O cadastro (equipe) e o equipar (em "Minha conta") ja
 * existem; esta tela e so o destino do item "Loja" do menu-home.
 *
 * Fica FORA de `/app/s/[serverId]` pela mesma razao da tela de amigos e do
 * Olimpo: cosmetico e da PESSOA, nao de um servidor.
 */
export const metadata = { title: "Loja" };

export default async function LojaPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-5">
        <NavToggle />
        <AetherIcon name="sparkle" className="h-4 w-4 text-accent-400" />
        <h1 className="text-[15px] font-semibold text-ink-100">Loja</h1>
      </header>

      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent-500/12 text-accent-300">
            <AetherIcon name="sparkle" className="h-6 w-6" />
          </div>
          <h2 className="text-[17px] font-semibold text-ink-100">
            A loja abre em breve
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-400">
            Decorações de avatar e banners de perfil, para o seu perfil ter a sua
            cara. Ainda estamos montando as primeiras peças.
          </p>
        </div>
      </div>
    </div>
  );
}
