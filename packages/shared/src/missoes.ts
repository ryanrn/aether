/**
 * Missoes da loja (Estagio 2): a regra de PERIODO que o gateway (que conta o
 * progresso) e o app web (que resgata e mostra) precisam calcular IGUAL. Se um
 * lado achasse que ainda e domingo e o outro que ja e segunda, o progresso iria
 * para uma linha e o resgate procuraria outra.
 *
 * O dia vira a meia-noite de BRASILIA, nao de UTC: quem joga as 22h nao pode
 * ver a missao diaria "zerar" no meio da partida. Brasilia e UTC-3 o ano todo
 * (sem horario de verao desde 2019), entao um deslocamento fixo basta.
 *
 * A semana e a ISO 8601: comeca na segunda e e numerada pelo ano ISO, para a
 * virada de ano nao criar uma "semana 53" de um dia.
 */

export type PeriodoDeMissao = "DIARIA" | "SEMANAL";
export type MetricaDeMissao = "MINUTOS_EM_VOZ" | "MINUTOS_JOGANDO" | "DIAS_ATIVOS";

const OFFSET_BRASILIA_MS = -3 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

/** A data "de calendario" em Brasilia, como um Date em UTC a meia-noite. */
function diaEmBrasilia(agora: Date): Date {
  const local = new Date(agora.getTime() + OFFSET_BRASILIA_MS);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()),
  );
}

function doisDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

/** `2026-11-02` para a diaria, `2026-W45` para a semanal. */
export function chaveDoPeriodo(periodo: PeriodoDeMissao, agora = new Date()): string {
  const dia = diaEmBrasilia(agora);
  if (periodo === "DIARIA") {
    return `${dia.getUTCFullYear()}-${doisDigitos(dia.getUTCMonth() + 1)}-${doisDigitos(dia.getUTCDate())}`;
  }
  // ISO 8601: a semana pertence ao ano da quinta-feira dela, e a semana 1 e a
  // que contem o 4 de janeiro.
  const diaDaSemana = (dia.getUTCDay() + 6) % 7; // segunda = 0
  const quinta = new Date(dia.getTime() + (3 - diaDaSemana) * DIA_MS);
  const anoIso = quinta.getUTCFullYear();
  const quatroDeJaneiro = new Date(Date.UTC(anoIso, 0, 4));
  const diaDoQuatro = (quatroDeJaneiro.getUTCDay() + 6) % 7;
  const semana =
    1 +
    Math.round(
      ((quinta.getTime() - quatroDeJaneiro.getTime()) / DIA_MS - 3 + diaDoQuatro) / 7,
    );
  return `${anoIso}-W${doisDigitos(semana)}`;
}

/** Como a tela mostra cada metrica: "12 / 30 min", "3 / 7 dias". */
export function formatarProgresso(
  metrica: MetricaDeMissao,
  valor: number,
  meta: number,
): string {
  const v = Math.min(valor, meta);
  if (metrica === "DIAS_ATIVOS") return `${v} / ${meta} ${meta === 1 ? "dia" : "dias"}`;
  if (meta >= 120 && meta % 60 === 0) {
    const horas = (n: number) => (n / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
    return `${horas(v)} / ${horas(meta)} h`;
  }
  return `${v} / ${meta} min`;
}

/** Uma missao do ponto de vista de quem a ve na loja. */
export interface MissaoDaPessoa {
  id: string;
  titulo: string;
  descricao: string | null;
  metrica: MetricaDeMissao;
  periodo: PeriodoDeMissao;
  meta: number;
  recompensa: number;
  valor: number;
  concluida: boolean;
  resgatada: boolean;
}

/** Como o painel da equipe ve o catalogo. */
export interface MissaoNoPainel {
  id: string;
  slug: string;
  titulo: string;
  descricao: string | null;
  metrica: MetricaDeMissao;
  periodo: PeriodoDeMissao;
  meta: number;
  recompensa: number;
  ativa: boolean;
}
