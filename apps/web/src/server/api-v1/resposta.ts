import "server-only";

import { NextResponse } from "next/server";
import { API_ERRO_MENSAGEM, type ApiErroCodigo } from "@aether/shared";

/**
 * Respostas da REST v1 — um formato só.
 *
 * Erro sempre `{ error: { code, message } }` com o `code` estável (ver
 * `@aether/shared/developer`). Sucesso é o corpo direto (sem envelope), como a
 * maior parte das APIs do mercado.
 */

const STATUS_PADRAO: Record<ApiErroCodigo, number> = {
  unauthorized: 401,
  not_found: 404,
  bad_request: 400,
  rate_limited: 429,
  gateway_unavailable: 503,
};

export function erroApi(
  code: ApiErroCodigo,
  extra?: { message?: string; status?: number; headers?: Record<string, string> },
): NextResponse {
  return NextResponse.json(
    { error: { code, message: extra?.message ?? API_ERRO_MENSAGEM[code] } },
    { status: extra?.status ?? STATUS_PADRAO[code], headers: extra?.headers },
  );
}

export function okApi<T>(
  corpo: T,
  status = 200,
  headers?: Record<string, string>,
): NextResponse {
  return NextResponse.json(corpo, { status, headers });
}
