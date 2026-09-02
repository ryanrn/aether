"use client";

import { useEffect, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { AetherIcon } from "@/components/ui/aether-icon";
import { useShellStore } from "@/lib/stores/shell-store";
import { isDesktopApp } from "@/lib/voice/screen-share";
import {
  aoFicarPronta,
  atualizacaoPendente,
  instalarAtualizacao,
} from "@/lib/desktop/update";
import { cn, colorFromId, initials } from "@/lib/utils";

/**
 * Barra de titulo do app de desktop.
 *
 * SO existe no desktop. No navegador a janela ja tem a barra dele, e desenhar
 * outra seria uma faixa morta ocupando altura.
 *
 * O Electron esconde a barra do sistema mas mantem os BOTOES nativos num
 * overlay a direita — por isso aqui nao ha minimizar, maximizar nem fechar.
 * Reimplementa-los custaria o Snap Layouts do Windows, o duplo clique para
 * maximizar e a area de clique correta; o overlay entrega os tres de graca.
 *
 * As variaveis `titlebar-area-*` dizem QUANTO espaco sobra ao lado dos botoes.
 * Sem elas, o conteudo passaria por baixo deles — e o centro ficaria
 * visualmente torto, porque o eixo da janela nao e o eixo da area livre.
 */
export function TitleBar() {
  /**
   * `window.aetherDesktop` nao existe no servidor, entao a primeira renderizacao
   * precisa ser igual nos dois lados. Decidir depois de montar evita o erro de
   * hidratacao — e, no navegador, o componente simplesmente nunca aparece.
   */
  const [noDesktop, setNoDesktop] = useState(false);
  useEffect(() => setNoDesktop(isDesktopApp()), []);

  /**
   * Versao nova ja baixada e esperando reinicio.
   *
   * Duas fontes, e as duas sao necessarias: `atualizacaoPendente` cobre o
   * download que terminou ANTES de a pagina existir (o caso mais provavel, no
   * boot), e `aoFicarPronta` cobre o que termina com o app aberto — a
   * verificacao roda de 6 em 6 horas.
   */
  const [versaoNova, setVersaoNova] = useState<string | null>(null);
  const [instalando, setInstalando] = useState(false);

  useEffect(() => {
    void atualizacaoPendente().then(setVersaoNova);
    return aoFicarPronta(setVersaoNova);
  }, []);

  const pathname = usePathname();
  const params = useParams<{ serverId?: string }>();
  const servers = useShellStore((estado) => estado.servers);

  if (!noDesktop) return null;

  const serverId = params?.serverId ?? null;
  const server = serverId
    ? (servers.find((item) => item.id === serverId) ?? null)
    : null;

  const emAmigos = pathname === "/app/amigos";

  return (
    <header
      /**
       * A faixa INTEIRA arrasta a janela. O conteudo dentro dela nao precisa
       * de nada: so quem for clicavel marca `no-drag`, e hoje nao ha nada
       * clicavel aqui.
       */
      className="app-drag flex shrink-0 items-center border-b border-white/[0.06] bg-base-950"
      style={{
        height: "var(--altura-barra)",
        paddingLeft: "env(titlebar-area-x, 0px)",
        width: "env(titlebar-area-width, 100%)",
      }}
    >
      <span className="shrink-0 px-4 font-brand text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-500">
        Aether
      </span>

      {/*
        O contexto fica CENTRADO na area livre, e nao na janela.
        `flex-1` + `justify-center` fazem isso sozinhos, porque o proprio
        elemento pai ja termina onde os botoes comecam.
      */}
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
        {server ? (
          <>
            <span
              className={cn(
                "grid h-[18px] w-[18px] shrink-0 place-items-center overflow-hidden",
                "rounded-[5px] text-[9px] font-bold text-ink-100",
              )}
              style={
                server.iconUrl
                  ? undefined
                  : { backgroundColor: colorFromId(server.id) }
              }
            >
              {server.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- icone pequeno, sem ganho em otimizar
                <img
                  src={server.iconUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                initials(server.name)
              )}
            </span>
            <span className="truncate text-[12px] font-medium text-ink-200">
              {server.name}
            </span>
          </>
        ) : emAmigos ? (
          <>
            <AetherIcon
              name="users"
              className="h-[15px] w-[15px] shrink-0 text-ink-400"
              strokeWidth={1.75}
            />
            <span className="truncate text-[12px] font-medium text-ink-200">
              Amigos
            </span>
          </>
        ) : null}
      </div>

      {/*
        Atualizacao pronta. So aparece quando ha uma — o resto do tempo esta
        faixa nao tem nada aqui, e o contrapeso abaixo cuida do equilibrio.

        Fica na BARRA DE TITULO e nao na de controles porque aquela so existe
        dentro de um servidor: quem estivesse na tela de Amigos nunca veria o
        aviso.

        `app-no-drag` porque a faixa inteira arrasta a janela — sem isso, o
        clique viraria um arrasto e o botao nao responderia.
      */}
      {versaoNova ? (
        <button
          type="button"
          onClick={async () => {
            setInstalando(true);
            const ok = await instalarAtualizacao();
            // Se o processo principal recusar, devolve o botao em vez de
            // deixar "Reiniciando..." para sempre numa janela que nao fechou.
            if (!ok) setInstalando(false);
          }}
          disabled={instalando}
          title={`Instalar a versao ${versaoNova}`}
          className={cn(
            "app-no-drag mr-2 flex shrink-0 items-center gap-1.5 rounded-full",
            "px-2.5 py-1 text-[11px] font-semibold text-white",
            "transition-opacity duration-150 hover:opacity-90 disabled:opacity-60",
          )}
          style={{ backgroundColor: "#68af64" }}
        >
          <AetherIcon name="download" className="h-3 w-3" strokeWidth={2.25} />
          {instalando ? "Reiniciando..." : "Atualizar"}
        </button>
      ) : null}

      {/*
        Contrapeso da largura da marca a esquerda. Sem ele o centro pende para
        a direita, porque "Aether" ocupa espaco de um lado so.
      */}
      <span aria-hidden className="w-[88px] shrink-0" />
    </header>
  );
}
