import { z } from "zod";

/**
 * Hub global "AETHER · Grupos" (fase 2, estagio 4b).
 *
 * As constantes moram aqui, e nao no servidor, porque a tela tambem precisa
 * delas: o seletor de tamanho da sala e o texto das regras. A decisao continua
 * sendo do servidor — `@aether/access` (`motivoParaNaoEntrarNoHub`) e as
 * actions do hub releem tudo.
 */

/** Idade minima da conta para entrar no hub, em horas (anti-spam). */
export const HUB_IDADE_MINIMA_HORAS = 24;

/** Tamanho de sala que o criador escolhe — vira o `userLimit` do canal. */
export const HUB_TAMANHO_MINIMO = 2;
export const HUB_TAMANHO_MAXIMO = 10;
export const HUB_TAMANHO_PADRAO = 5;

/** Teto de salas abertas ao mesmo tempo no hub. */
export const HUB_MAX_SALAS = 50;

/** Por que alguem nao pode entrar no hub agora. */
export type MotivoDeRecusaDoHub =
  | "conta_nova"
  | "email_nao_verificado"
  | "silenciado"
  | "banido";

export const MENSAGEM_DE_RECUSA_DO_HUB: Record<MotivoDeRecusaDoHub, string> = {
  conta_nova: `O hub abre para contas com mais de ${HUB_IDADE_MINIMA_HORAS} horas. Volte mais tarde.`,
  email_nao_verificado: "Confirme seu e-mail para entrar no hub.",
  silenciado: "Sua conta esta silenciada e nao pode entrar no hub agora.",
  banido: "Voce nao pode entrar no hub.",
};

export const entrarNoHubSchema = z.object({
  /** A pessoa marcou que leu as regras. Sem isso, nao entra. */
  aceitouRegras: z.literal(true, {
    errorMap: () => ({ message: "Aceite as regras do hub para entrar." }),
  }),
});

export const criarSalaNoHubSchema = z.object({
  jogo: z.string().trim().min(2, "Nome muito curto").max(64, "Nome muito longo"),
  tamanho: z
    .number()
    .int()
    .min(HUB_TAMANHO_MINIMO, `Minimo de ${HUB_TAMANHO_MINIMO} pessoas`)
    .max(HUB_TAMANHO_MAXIMO, `Maximo de ${HUB_TAMANHO_MAXIMO} pessoas`),
});
