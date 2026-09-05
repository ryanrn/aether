import {
  atividadeDaConexao,
  estadoSpotify,
  spotifyConfigurado,
} from "@aether/access";
import { setListening } from "../state";
import { anunciarMudancaDePresenca } from "../handlers/presence";
import type { AetherServer } from "../types";

/**
 * Poller do Spotify — descobre o que cada pessoa CONECTADA esta ouvindo e
 * anuncia pela presenca.
 *
 * Por que o gateway e nao o app web: o poller precisa rodar continuamente
 * enquanto a pessoa esta online, sem uma aba aberta segurando um `setInterval`.
 * O gateway ja e o dono de "quem esta online agora".
 *
 * O Spotify NAO tem webhook de playback — a unica forma e consultar. Intervalo
 * de 15s: a barra de progresso (fase B) e extrapolada no cliente, entao 15s
 * de defasagem na TROCA de faixa e acceptable, e o limite da API (~180/min)
 * cobre um grupo de amigos com folga.
 *
 * Cada instancia de gateway observa so os usuarios conectados A ELA. Com duas
 * maquinas, cada uma cuida dos seus — e o anuncio (`presence:update` /
 * `friend:presence`) ja atravessa instancia pelo adapter de Redis.
 */

const INTERVALO_MS = 15_000;
/** espaca as consultas dentro do ciclo para nao bater todas no mesmo instante */
const PASSO_MS = 400;

export interface SpotifyPoller {
  observar(userId: string): void;
  esquecer(userId: string): void;
  parar(): void;
}

export function iniciarSpotifyPoller(io: AetherServer): SpotifyPoller {
  const observados = new Set<string>();
  let ciclo: NodeJS.Timeout | null = null;

  /** Zera a musica desta pessoa no estado e anuncia, se havia algo. */
  async function limpar(userId: string): Promise<void> {
    const limpou = await setListening(userId, null);
    if (limpou) await anunciarMudancaDePresenca(io, userId, limpou.servers);
  }

  async function consultar(userId: string): Promise<void> {
    if (!observados.has(userId)) return;

    const conta = await estadoSpotify(userId).catch(() => null);
    if (!conta) {
      // Nunca conectou, ou desconectou nesse meio tempo.
      observados.delete(userId);
      await limpar(userId);
      return;
    }
    // "Exibir no perfil" desligado: a musica nao sai do gateway.
    if (!conta.showOnProfile) {
      await limpar(userId);
      return;
    }

    /**
     * UMA CHAMADA. Renovar o token, distinguir "revogou o acesso" de "a rede
     * caiu", apagar a linha morta e ler a atividade sao trabalho do REGISTRO
     * (`@aether/access`), igual para todo provedor — o poller so pergunta.
     *
     * `null` cobre os dois desfechos que interessam aqui: nada tocando, ou a
     * conexao deixou de existir. A diferenca entre eles esta em `estadoSpotify`
     * no proximo ciclo, e ate la limpar a musica e a resposta certa nos dois.
     */
    let atividade;
    try {
      atividade = await atividadeDaConexao(userId, "SPOTIFY");
    } catch {
      // Erro de rede: tenta de novo no proximo ciclo, sem mexer no estado.
      return;
    }

    const mudou = await setListening(
      userId,
      atividade?.tipo === "musica" ? atividade.musica : null,
    );
    if (mudou) await anunciarMudancaDePresenca(io, userId, mudou.servers);
  }

  function tick(): void {
    let i = 0;
    for (const userId of observados) {
      setTimeout(() => void consultar(userId), i * PASSO_MS);
      i += 1;
    }
  }

  return {
    observar(userId) {
      if (!spotifyConfigurado()) return;
      if (observados.has(userId)) return;
      observados.add(userId);
      // Primeira consulta ja, sem esperar o ciclo — musica na tela em segundos.
      setTimeout(() => void consultar(userId), 1500);
      if (!ciclo) ciclo = setInterval(tick, INTERVALO_MS);
    },
    esquecer(userId) {
      observados.delete(userId);
      if (observados.size === 0 && ciclo) {
        clearInterval(ciclo);
        ciclo = null;
      }
    },
    parar() {
      observados.clear();
      if (ciclo) clearInterval(ciclo);
      ciclo = null;
    },
  };
}
