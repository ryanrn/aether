"use client";

import {
  autorizarAnexoAction,
  confirmarAnexoAction,
} from "@/server/actions/anexos";
import type { PublicAttachment } from "@aether/shared";

/**
 * O envio de um arquivo, do lado do navegador.
 *
 * TRES PASSOS, e o do meio nao passa pelo nosso servidor:
 *
 *   1. pedir autorizacao — o servidor confere o plano e assina;
 *   2. PUT direto no R2, com a URL assinada;
 *   3. confirmar — o servidor pergunta ao R2 se chegou, e so entao o anexo
 *      pode entrar numa mensagem.
 *
 * O passo 2 usa `XMLHttpRequest` e nao `fetch`, e essa e a unica razao: `fetch`
 * nao informa PROGRESSO de upload. Num arquivo de 200 MB, uma barra parada e
 * indistinguivel de um envio travado, e a pessoa cancela um envio que estava
 * indo bem.
 */

export interface ProgressoDeEnvio {
  (fracao: number): void;
}

export class EnvioCancelado extends Error {
  override name = "EnvioCancelado";
}

/** As dimensoes de uma imagem, para reservar o espaco na tela depois. */
async function dimensoesDe(arquivo: File): Promise<{ largura: number; altura: number } | null> {
  if (!arquivo.type.startsWith("image/")) return null;
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("imagem ilegivel"));
      img.src = url;
    });
    return { largura: img.naturalWidth, altura: img.naturalHeight };
  } catch {
    // Nao conseguir medir nao impede o envio; so perde a reserva de espaco.
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function enviarAnexo(
  arquivo: File,
  opcoes: {
    onProgresso?: ProgressoDeEnvio;
    sinal?: AbortSignal;
  } = {},
): Promise<PublicAttachment> {
  const autorizacao = await autorizarAnexoAction({
    nome: arquivo.name,
    tamanho: arquivo.size,
    mime: arquivo.type || "application/octet-stream",
  });
  if (!autorizacao.ok) throw new Error(autorizacao.error);

  const { id, urlDeEnvio, cabecalhos } = autorizacao.data;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", urlDeEnvio, true);

    /**
     * Os cabecalhos vem do servidor e sao mandados EXATAMENTE como vieram.
     * `content-type` e `content-length` fazem parte da assinatura — mudar um
     * deles aqui faz o R2 recusar com 403, que e o comportamento desejado e
     * ao mesmo tempo o erro mais facil de causar sem querer.
     */
    for (const [nome, valor] of Object.entries(cabecalhos)) {
      // O navegador nao deixa definir content-length: ele calcula do corpo.
      if (nome.toLowerCase() === "content-length") continue;
      xhr.setRequestHeader(nome, valor);
    }

    xhr.upload.onprogress = (evento) => {
      if (evento.lengthComputable && opcoes.onProgresso) {
        opcoes.onProgresso(evento.loaded / evento.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`o armazenamento recusou (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("falha de rede ao enviar"));
    xhr.onabort = () => reject(new EnvioCancelado());

    opcoes.sinal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(arquivo);
  });

  const dimensoes = await dimensoesDe(arquivo);
  const confirmado = await confirmarAnexoAction({
    id,
    largura: dimensoes?.largura ?? null,
    altura: dimensoes?.altura ?? null,
  });
  if (!confirmado.ok) throw new Error(confirmado.error);

  return confirmado.data;
}
