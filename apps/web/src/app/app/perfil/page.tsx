import { redirect } from "next/navigation";
import { prisma } from "@aether/db";
import { getSession } from "@/server/auth/session";
import { bannerEquipado } from "@/server/services/cosmeticos";
import { PerfilScreen } from "@/components/perfil/perfil-screen";

/**
 * A tela de Perfil — "e assim que os outros te veem".
 *
 * Estagio 1b da loja: mostra o cartao de perfil (avatar + decoracao, banner,
 * nome, @, plano, membro desde, bio) e um atalho para editar. NAO reconstroi o
 * editor do mock — Configuracoes ja faz tudo (avatar, nome, bio, moldura,
 * seletor de cosmetico); "Editar perfil" abre aquele modal na aba Conta.
 *
 * Fica FORA de `/app/s/[serverId]` — perfil e da PESSOA, nao de um servidor.
 */
export const metadata = { title: "Perfil" };

export default async function PerfilPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [extra, banner] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { createdAt: true, bio: true },
    }),
    bannerEquipado(session.user.id, session.user.plano),
  ]);

  // Só o que a tela desenha — `email`, `equipe`, flags de privacidade e afins
  // ficam no servidor.
  const u = session.user;

  return (
    <PerfilScreen
      user={{
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        moldura: u.moldura,
        decoracao: u.decoracao,
        plano: u.plano,
        status: u.status,
      }}
      bio={extra?.bio?.trim() || null}
      membroDesde={extra?.createdAt.toISOString() ?? null}
      banner={banner}
    />
  );
}
