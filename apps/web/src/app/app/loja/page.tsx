import { redirect } from "next/navigation";
import { flagLigada } from "@aether/access";
import { COSMETIC_TYPES } from "@aether/shared";
import { getSession } from "@/server/auth/session";
import { catalogoParaUsuario } from "@/server/services/cosmeticos";
import { carteiraDe } from "@/server/services/moedas";
import { missoesDe } from "@/server/services/missoes";
import { AetherIcon } from "@/components/ui/aether-icon";
import { NavToggle } from "@/components/layout/nav-mobile";
import { LojaScreen } from "@/components/loja/loja-screen";

/**
 * A loja de cosmeticos de perfil.
 *
 * Estagio 1: a TELA em si — decoracoes de avatar e banners, gratis ou
 * plano-gated. Sem economia de moedas: item pago que a pessoa nao possui
 * aparece com o preco e "em breve", nao equipa. O cadastro (equipe) e o
 * render no app ja existem; aqui e a vitrine + o equipar.
 *
 * Cai no placeholder quando a flag `loja_de_cosmeticos` esta desligada ou
 * ainda nao ha nenhuma peca publicada.
 *
 * Fica FORA de `/app/s/[serverId]` pela mesma razao da tela de amigos e do
 * Olimpo: cosmetico e da PESSOA, nao de um servidor.
 */
export const metadata = { title: "Loja" };

export default async function LojaPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const aberta = await flagLigada("loja_de_cosmeticos");
  // Um catalogo por tipo; cada um degrada sozinho para vazio se falhar.
  const itens = aberta
    ? (
        await Promise.all(
          COSMETIC_TYPES.map((tipo) =>
            catalogoParaUsuario(session.user.id, session.user.plano, tipo),
          ),
        )
      ).flat()
    : [];

  if (itens.length === 0) {
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
              Decorações de avatar e banners de perfil, para o seu perfil ter a
              sua cara. Ainda estamos montando as primeiras peças.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <LojaScreen
      itens={itens}
      carteira={await carteiraDe(session.user.id)}
      missoes={await missoesDe(session.user.id)}
      plano={session.user.plano}
      user={{
        id: session.user.id,
        displayName: session.user.displayName,
        avatarUrl: session.user.avatarUrl,
        moldura: session.user.moldura,
      }}
    />
  );
}
