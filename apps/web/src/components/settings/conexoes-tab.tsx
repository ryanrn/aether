"use client";

import { SpotifySection } from "./spotify-section";

/**
 * Conexoes — contas de outros servicos ligadas a sua.
 *
 * POR QUE SAIU DE "ATIVIDADE": la e sobre O QUE OS AMIGOS VEEM voce fazendo.
 * O Spotify aparecia ali porque ALIMENTA o cartao de atividade — mas ligar
 * uma conta e uma coisa (autorizacao, OAuth, revogar), e o que ela mostra e
 * outra. Misturar as duas fazia a aba de atividade crescer para os lados a
 * cada servico novo, e escondia a pergunta que a pessoa faz de verdade
 * quando abre aqui: "quais contas minhas estao ligadas neste app?".
 *
 * Aba propria e o lugar de crescer: Steam, Twitch e Riot entram aqui como
 * irmaos do Spotify, cada um com as chaves que fazem sentido para ele.
 *
 * Funciona no navegador E no desktop — OAuth e do lado do servidor, nao
 * depende de casca nenhuma.
 */
export function ConexoesTab() {
  return (
    <section className="flex flex-col gap-6">
      <SpotifySection />

      {/*
        O que ainda nao existe fica ESCRITO, e nao insinuado com um icone
        cinza que nao clica. A pessoa merece saber que a lista vai crescer
        sem ficar tentando adivinhar por que o botao nao responde.
      */}
      <div className="rounded-md border border-line bg-base-900 p-3">
        <p className="text-[11px] uppercase tracking-[0.1em] text-ink-500">
          Ainda nao disponivel
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-400">
          Steam, Twitch e Riot Games. Cada um exige um cadastro proprio de
          aplicativo e um jeito diferente de entrar — vao chegar um de cada
          vez, nao todos juntos.
        </p>
      </div>
    </section>
  );
}
