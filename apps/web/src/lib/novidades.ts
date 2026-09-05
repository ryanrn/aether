"use client";

import dados from "./novidades.json";

/**
 * "Veja o que mudou" — o texto de cada versao e a regra de quando mostrar.
 *
 * POR QUE O TEXTO MORA AQUI, e nao no corpo da release do GitHub: a tela
 * aparece no PRIMEIRO BOOT DEPOIS de atualizar. Nesse momento o app ja
 * reiniciou, e o `releaseNotes` que o electron-updater entregou junto do
 * download morreu com o processo anterior. Buscar de novo pela rede
 * significaria a tela depender do GitHub estar no ar para abrir.
 *
 * Vindo daqui, ela abre offline, e o texto e versionado junto do codigo que
 * ele descreve. `scripts/release-desktop.mjs` le este mesmo arquivo e RECUSA
 * publicar uma versao sem entrada — assim o corpo da release no GitHub e esta
 * tela nunca divergem, porque sao a mesma fonte.
 */

export type CategoriaDeNovidade =
  | "recurso"
  | "performance"
  | "correcao"
  | "seguranca";

export interface ItemDeNovidade {
  categoria: CategoriaDeNovidade;
  texto: string;
}

export interface NovidadesDaVersao {
  versao: string;
  /** ISO `AAAA-MM-DD` */
  data: string;
  resumo: string;
  itens: ItemDeNovidade[];
}

type Bruto = Record<
  string,
  { data: string; resumo: string; itens: { categoria: string; texto: string }[] }
>;

const CATEGORIAS: CategoriaDeNovidade[] = [
  "recurso",
  "performance",
  "correcao",
  "seguranca",
];

function categoria(valor: string): CategoriaDeNovidade {
  return (CATEGORIAS as string[]).includes(valor)
    ? (valor as CategoriaDeNovidade)
    : // Categoria desconhecida vira "recurso" em vez de sumir da lista: perder
      // uma linha do changelog por causa de um rotulo errado seria pior.
      "recurso";
}

export function novidadesDaVersao(versao: string): NovidadesDaVersao | null {
  const entrada = (dados as Bruto)[versao];
  if (!entrada || entrada.itens.length === 0) return null;
  return {
    versao,
    data: entrada.data,
    resumo: entrada.resumo,
    itens: entrada.itens.map((i) => ({
      categoria: categoria(i.categoria),
      texto: i.texto,
    })),
  };
}

const CHAVE = "aether:novidades-vista";

/**
 * Mostrar a tela agora?
 *
 * Tres respostas, e as tres importam:
 *
 *  - `null` quando nao ha nada a dizer (versao sem entrada, ou ja vista);
 *  - `null` TAMBEM na primeira execucao de quem acabou de instalar. Quem nunca
 *    usou o app nao tem "o que mudou" — abrir um changelog na cara de alguem
 *    que chegou agora e ruido. Nesse caso a versao e anotada em silencio, e a
 *    proxima atualizacao ja mostra normalmente;
 *  - a entrada, quando a versao instalada e diferente da ultima vista.
 *
 * `localStorage` pode lancar (janela anonima, armazenamento bloqueado). Se
 * lancar, nao mostramos nada: uma tela de novidades que reaparece a cada
 * abertura seria pior do que nao existir.
 */
export function novidadesParaMostrar(
  versaoAtual: string,
): NovidadesDaVersao | null {
  let vista: string | null;
  try {
    vista = localStorage.getItem(CHAVE);
  } catch {
    return null;
  }

  if (vista === versaoAtual) return null;

  if (vista === null) {
    marcarComoVista(versaoAtual);
    return null;
  }

  return novidadesDaVersao(versaoAtual);
}

export function marcarComoVista(versao: string): void {
  try {
    localStorage.setItem(CHAVE, versao);
  } catch {
    // Sem armazenamento a tela reapareceria; `novidadesParaMostrar` ja
    // devolve `null` nesse caso, entao aqui nao ha nada a fazer.
  }
}
