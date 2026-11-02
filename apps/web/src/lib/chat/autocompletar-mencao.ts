/**
 * Autocompletar de mencao no campo de mensagem (P1-2) — a parte pura, sem
 * React, para poder ser testada.
 *
 * O campo insere `@usuario`, e nao o marcador `<@id>`: e o que a pessoa leria
 * se tivesse digitado, e o gateway troca pelo marcador ao gravar. Assim o
 * campo nunca mostra id cru.
 */

export interface PessoaMencionavel {
  id: string;
  username: string;
  nome: string;
  avatarUrl: string | null;
}

export type Sugestao =
  | { tipo: "pessoa"; pessoa: PessoaMencionavel }
  | { tipo: "todos" };

/** O `@algo` que o cursor esta digitando agora, e onde ele comeca. */
export interface ConsultaDeMencao {
  /** indice do `@` no texto */
  inicio: number;
  /** o que vem depois do `@`, ate o cursor */
  termo: string;
}

/**
 * So abre logo depois de espaco, parentese ou do inicio: `a@b` (e-mail) nao
 * e mencao, e o servidor pensa igual (`nomesDigitados`).
 */
export function consultaNoCursor(
  texto: string,
  cursor: number,
): ConsultaDeMencao | null {
  const antes = texto.slice(0, cursor);
  const m = /(?:^|[\s(])@([a-zA-Z0-9._-]{0,24})$/.exec(antes);
  if (!m) return null;
  return { inicio: cursor - m[1]!.length - 1, termo: m[1]! };
}

/** Sem acento e minusculo: "Joao" acha "João". */
function normalizar(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Quem combina com o termo. Usuario que COMECA com o termo vem antes; depois,
 * nome de exibicao que contem. `@everyone` aparece quando o termo e prefixo
 * dele — o servidor ainda decide se a pessoa pode usar.
 */
export function filtrarSugestoes(
  termo: string,
  pessoas: PessoaMencionavel[],
  incluiTodos: boolean,
  limite = 8,
): Sugestao[] {
  const t = normalizar(termo);
  const comeca: Sugestao[] = [];
  const contem: Sugestao[] = [];
  for (const pessoa of pessoas) {
    const usuario = normalizar(pessoa.username);
    const nome = normalizar(pessoa.nome);
    if (usuario.startsWith(t)) comeca.push({ tipo: "pessoa", pessoa });
    else if (nome.includes(t) || usuario.includes(t)) {
      contem.push({ tipo: "pessoa", pessoa });
    }
  }
  const todos: Sugestao[] =
    incluiTodos && "everyone".startsWith(t) ? [{ tipo: "todos" }] : [];
  return [...comeca, ...contem, ...todos].slice(0, limite);
}

/** Troca o `@termo` em digitacao pela escolha e devolve onde o cursor fica. */
export function aplicarSugestao(
  texto: string,
  consulta: ConsultaDeMencao,
  cursor: number,
  sugestao: Sugestao,
): { texto: string; cursor: number } {
  const inserido =
    sugestao.tipo === "todos" ? "@everyone " : `@${sugestao.pessoa.username} `;
  const novo = texto.slice(0, consulta.inicio) + inserido + texto.slice(cursor);
  return { texto: novo, cursor: consulta.inicio + inserido.length };
}
