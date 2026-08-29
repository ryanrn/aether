import type { AuthenticatedSession } from "./session";

/**
 * Administracao GLOBAL do produto.
 *
 * NAO CONFUNDIR COM DONO DE SERVIDOR. Dono manda no servidor dele e nao tem
 * nenhum poder fora dele; equipe mexe no que vale para a base inteira — hoje,
 * a fila de jogos sugeridos. Sao eixos diferentes, e juntar os dois daria a
 * todo dono de servidor o poder de escrever no catalogo de todo mundo.
 *
 * MORA AQUI pela mesma razao das outras regras: autorizacao em um lugar so. A
 * alternativa seria cada tela comparar `username === "ryan"`, e ai a regra
 * existiria em tantos lugares quanto telas — com uma delas sempre esquecida
 * numa refatoracao.
 *
 * O frontend usa isto apenas para ESCONDER a entrada do painel. Quem barra de
 * verdade e a action, que rechama esta funcao no servidor: esconder botao nao
 * e autorizacao, e so cortesia.
 */
export function ehEquipe(
  sessao: AuthenticatedSession | null | undefined,
): boolean {
  return sessao?.user.equipe === true;
}

/**
 * Lancada quando alguem sem equipe tenta o caminho da equipe.
 *
 * A mensagem NAO diz "voce nao e da equipe": quem chega aqui sem ser recebe a
 * mesma resposta de rota inexistente. E a regra do projeto — acesso indevido
 * responde 404, e nao 403 — porque 403 confirma que o recurso existe.
 */
export class NaoEhEquipeError extends Error {
  constructor() {
    super("Nao encontrado");
    this.name = "NaoEhEquipeError";
  }
}
