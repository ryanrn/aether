/**
 * Mencoes no texto de uma mensagem (P1-2).
 *
 * O texto GUARDA marcadores, e nao nomes: `<@idDaPessoa>`, `<@&idDoCargo>` e
 * `@everyone`. Nome muda; id nao — a mencao acompanha a troca de nome sem
 * reescrever mensagem nenhuma. Quem digita `@usuario` a mao tem o nome trocado
 * pelo marcador no gateway, antes de gravar (`trocarNomesPorMarcadores`).
 *
 * Mora em `@aether/shared` porque os DOIS lados leem o mesmo texto: o gateway
 * para saber quem foi chamado, a tela para desenhar. Duas leituras diferentes
 * do mesmo marcador seriam uma mencao que avisa e nao aparece, ou o contrario.
 *
 * Dentro de codigo (entre crases) nao ha mencao: quem cola um trecho com `@`
 * nao esta chamando ninguem.
 */

/** Teto de pessoas + cargos por mensagem. Passou disso, o resto fica texto. */
export const MENCOES_MAX = 20;

export type PedacoDeTexto =
  | { tipo: "texto"; valor: string }
  | { tipo: "usuario"; id: string }
  | { tipo: "cargo"; id: string }
  | { tipo: "todos" };

/** Os nomes que a tela mostra no lugar dos marcadores. Vem em `PublicMessage`. */
export interface MencoesDaMensagem {
  usuarios: { id: string; nome: string }[];
  cargos: { id: string; nome: string; cor: string | null }[];
  /** `@everyone` foi aceito (o autor tinha permissao). */
  todos: boolean;
}

/**
 * O pedaco do `select` do Prisma que traz as mencoes de uma mensagem. Fica
 * aqui pelo mesmo motivo do `SELECT_USUARIO_PUBLICO`: o gateway e o app web
 * leem mensagem, e duas copias do select divergem.
 */
export const SELECT_MENCOES = {
  mencionaTodos: true,
  mencoes: {
    select: {
      user: { select: { id: true, displayName: true } },
      role: { select: { id: true, name: true, color: true } },
    },
  },
} as const;

export const SEM_MENCOES: MencoesDaMensagem = {
  usuarios: [],
  cargos: [],
  todos: false,
};

/**
 * Corta o texto em trechos fora e dentro de codigo. Bloco de tres crases
 * primeiro, depois crase simples; crase sem par fecha nada e vira texto.
 */
export function separarCodigo(
  texto: string,
): { codigo: boolean; valor: string }[] {
  const saida: { codigo: boolean; valor: string }[] = [];
  const re = /```[\s\S]*?```|`[^`\n]+`/g;
  let ultimo = 0;
  for (const m of texto.matchAll(re)) {
    if (m.index! > ultimo) {
      saida.push({ codigo: false, valor: texto.slice(ultimo, m.index) });
    }
    saida.push({ codigo: true, valor: m[0] });
    ultimo = m.index! + m[0].length;
  }
  if (ultimo < texto.length) saida.push({ codigo: false, valor: texto.slice(ultimo) });
  return saida;
}

/**
 * Marcadores e `@everyone`. O `@everyone` precisa de borda dos dois lados:
 * `email@everyone.com` nao chama ninguem.
 */
const RE_MARCADOR = /<@(&?)([a-z0-9]{8,40})>|(?<![\w.@-])@everyone(?![\w.-])/gi;

/** Divide o texto nos pedacos que a tela desenha. */
export function quebrarEmMencoes(texto: string): PedacoDeTexto[] {
  const saida: PedacoDeTexto[] = [];
  const empurrarTexto = (valor: string) => {
    if (!valor) return;
    const anterior = saida[saida.length - 1];
    if (anterior?.tipo === "texto") anterior.valor += valor;
    else saida.push({ tipo: "texto", valor });
  };

  for (const trecho of separarCodigo(texto)) {
    if (trecho.codigo) {
      empurrarTexto(trecho.valor);
      continue;
    }
    let ultimo = 0;
    for (const m of trecho.valor.matchAll(RE_MARCADOR)) {
      empurrarTexto(trecho.valor.slice(ultimo, m.index));
      if (m[2]) saida.push({ tipo: m[1] ? "cargo" : "usuario", id: m[2] });
      else saida.push({ tipo: "todos" });
      ultimo = m.index! + m[0].length;
    }
    empurrarTexto(trecho.valor.slice(ultimo));
  }
  return saida;
}

/** O que o texto PEDE — o gateway ainda decide o que vale. */
export interface MencoesPedidas {
  usuarios: string[];
  cargos: string[];
  todos: boolean;
}

export function mencoesPedidas(texto: string): MencoesPedidas {
  const usuarios = new Set<string>();
  const cargos = new Set<string>();
  let todos = false;
  for (const p of quebrarEmMencoes(texto)) {
    if (p.tipo === "usuario") usuarios.add(p.id);
    else if (p.tipo === "cargo") cargos.add(p.id);
    else if (p.tipo === "todos") todos = true;
  }
  return { usuarios: [...usuarios], cargos: [...cargos], todos };
}

/**
 * `@nome` digitado a mao. A borda da esquerda impede casar dentro de e-mail
 * (`a@b`); ponto e hifen no FIM saem do nome, porque quem escreve "fala com
 * @ryan." nao quis dizer o usuario `ryan.`.
 */
const RE_NOME = /(?<![\w.@-])@([a-zA-Z0-9._-]{3,24})/g;

function limparFimDoNome(nome: string): string {
  return nome.replace(/[.-]+$/, "");
}

/** Os `@nome` digitados a mao, fora de codigo, em minusculas. */
export function nomesDigitados(texto: string): string[] {
  const nomes = new Set<string>();
  for (const trecho of separarCodigo(texto)) {
    if (trecho.codigo) continue;
    for (const m of trecho.valor.matchAll(RE_NOME)) {
      const nome = limparFimDoNome(m[1]!).toLowerCase();
      if (nome.length >= 3 && nome !== "everyone") nomes.add(nome);
    }
  }
  return [...nomes];
}

/**
 * Troca `@nome` pelo marcador da pessoa, so para os nomes que o gateway
 * resolveu (`idPorNome`, chave em minusculas). Nome que nao resolveu fica
 * como foi digitado.
 */
export function trocarNomesPorMarcadores(
  texto: string,
  idPorNome: Record<string, string>,
): string {
  return separarCodigo(texto)
    .map((trecho) =>
      trecho.codigo
        ? trecho.valor
        : trecho.valor.replace(RE_NOME, (inteiro, bruto: string) => {
            const nome = limparFimDoNome(bruto);
            const id = idPorNome[nome.toLowerCase()];
            if (!id) return inteiro;
            // O que foi cortado do fim (ponto final) volta depois do marcador.
            return `<@${id}>${bruto.slice(nome.length)}`;
          }),
    )
    .join("");
}

/**
 * Texto corrido, sem marcador cru: para o trecho de uma resposta e qualquer
 * lugar que mostre a mensagem como texto simples.
 */
export function textoComNomes(
  texto: string,
  mencoes: MencoesDaMensagem,
): string {
  const nomeUsuario = new Map(mencoes.usuarios.map((u) => [u.id, u.nome]));
  const nomeCargo = new Map(mencoes.cargos.map((c) => [c.id, c.nome]));
  return quebrarEmMencoes(texto)
    .map((p) => {
      if (p.tipo === "texto") return p.valor;
      if (p.tipo === "usuario") return `@${nomeUsuario.get(p.id) ?? "alguém"}`;
      if (p.tipo === "cargo") return `@${nomeCargo.get(p.id) ?? "cargo"}`;
      return "@everyone";
    })
    .join("");
}
