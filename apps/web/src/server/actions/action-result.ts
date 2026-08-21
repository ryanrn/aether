import type { ActionResult } from "@aether/shared";
import { AuthError, ForbiddenError, NotFoundError } from "../guards";

/**
 * Envelope padrao das server actions.
 *
 * Motivo: nunca deixar excecao crua vazar para o cliente (stack trace e detalhe
 * de banco sao superficie de ataque) e dar ao formulario um formato unico de erro.
 */
export function ok(): ActionResult<undefined>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}

export function fail(error: string, field?: string): ActionResult<never> {
  return { ok: false, error, field };
}

export function toActionError(error: unknown): ActionResult<never> {
  if (error instanceof AuthError) {
    return fail("Sessao expirada. Entre novamente.");
  }
  if (error instanceof ForbiddenError) {
    return fail(error.message);
  }
  if (error instanceof NotFoundError) {
    return fail(error.message);
  }
  console.error("[action] erro inesperado", error);
  return fail("Algo deu errado. Tente novamente.");
}
