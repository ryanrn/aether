"use server";

import {
  cosmeticoMetaSchema,
  type ActionResult,
  type CosmeticoNoPainel,
  type CosmeticType,
} from "@aether/shared";
import { prisma } from "@aether/db";
import { log } from "@aether/shared/log";
import { sessaoDaEquipe } from "../guards";
import { writeAudit } from "../audit";
import {
  ColecaoInexistente,
  CosmeticoNaoEncontrado,
  SlugEmUso,
  concederCosmetico,
  contarCosmeticosPorTipo,
  criarCosmetico,
  definirCosmeticoAtivo,
  editarCosmetico,
  excluirCosmetico,
  listarCosmeticos,
  type AssetDeCosmetico,
} from "../services/cosmeticos";
import {
  apagarAssetCosmetico,
  uploadCosmeticAsset,
  type UploadCosmeticoResult,
} from "../storage/cosmeticos";
import { fail, ok, toActionError } from "./action-result";

/**
 * Cadastro de cosmeticos — SO A EQUIPE.
 *
 * Toda action passa por `sessaoDaEquipe()`, que devolve `null` (nao lanca) para
 * quem nao e equipe; a resposta e "Nao encontrado", como todo o resto do
 * painel — nao confirmamos que a tela existe para quem chutou o nome da action.
 *
 * O upload passa pelo servidor (`uploadCosmeticAsset`): arquivo pequeno, so a
 * equipe envia, e o servidor precisa dos bytes para medir e recortar. Create e
 * edit recebem `FormData` (campos + arquivo), como `uploadAvatarAction`.
 */

function lerMeta(formData: FormData) {
  return cosmeticoMetaSchema.safeParse({
    nome: formData.get("nome"),
    descricao: formData.get("descricao") ?? undefined,
    tipo: formData.get("tipo"),
    slug: formData.get("slug"),
    raridade: formData.get("raridade"),
    precoMoedas: formData.get("precoMoedas"),
    tierMinimo: formData.get("tierMinimo"),
    ordem: formData.get("ordem"),
    colecaoId: formData.get("colecaoId"),
  });
}

function lerArquivo(formData: FormData, campo: string): File | null {
  const v = formData.get(campo);
  return v instanceof File && v.size > 0 ? v : null;
}

/** So os campos do asset — sem o `ok` do resultado do upload. */
function assetDoUpload(
  u: Extract<UploadCosmeticoResult, { ok: true }>,
): AssetDeCosmetico {
  return {
    assetKey: u.assetKey,
    assetUrl: u.assetUrl,
    assetMime: u.assetMime,
    largura: u.largura,
    altura: u.altura,
    assetTrasKey: u.assetTrasKey,
    assetTrasUrl: u.assetTrasUrl,
    thumbKey: u.thumbKey,
    thumbUrl: u.thumbUrl,
  };
}

async function limparAsset(asset: AssetDeCosmetico): Promise<void> {
  await apagarAssetCosmetico({
    assetKey: asset.assetKey,
    assetTrasKey: asset.assetTrasKey,
    thumbKey: asset.thumbKey,
  });
}

export async function listarCosmeticosAction(input?: {
  tipo?: CosmeticType;
  incluirInativos?: boolean;
}): Promise<
  ActionResult<{
    itens: CosmeticoNoPainel[];
    porTipo: Record<CosmeticType, number>;
  }>
> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");

    const [itens, porTipo] = await Promise.all([
      listarCosmeticos({
        tipo: input?.tipo,
        incluirInativos: input?.incluirInativos ?? true,
      }),
      contarCosmeticosPorTipo(),
    ]);
    return ok({ itens, porTipo });
  } catch (error) {
    return toActionError(error);
  }
}

export async function criarCosmeticoAction(
  formData: FormData,
): Promise<ActionResult<CosmeticoNoPainel>> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");

    const parsed = lerMeta(formData);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail(issue?.message ?? "Dados invalidos", issue?.path[0]?.toString());
    }

    const arquivo = lerArquivo(formData, "asset");
    if (!arquivo) return fail("Envie o arquivo do cosmetico", "asset");

    const upload = await uploadCosmeticAsset({
      file: arquivo,
      fileTras: lerArquivo(formData, "assetTras"),
      tipo: parsed.data.tipo,
      slug: parsed.data.slug,
    });
    if (!upload.ok) return fail(upload.error, "asset");
    const asset = assetDoUpload(upload);

    try {
      const criado = await criarCosmetico(parsed.data, asset, sessao.user.id);
      return ok(criado);
    } catch (erro) {
      // Falhou depois do upload: o objeto ja esta no R2 e ninguem aponta para
      // ele. Tira antes de devolver o erro.
      await limparAsset(asset);
      if (erro instanceof SlugEmUso) {
        return fail("Ja existe um cosmetico com esse slug", "slug");
      }
      if (erro instanceof ColecaoInexistente) {
        return fail("Essa colecao nao existe mais", "colecaoId");
      }
      throw erro;
    }
  } catch (error) {
    return toActionError(error);
  }
}

export async function editarCosmeticoAction(
  formData: FormData,
): Promise<ActionResult<CosmeticoNoPainel>> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");

    const id = String(formData.get("id") ?? "");
    if (!id) return fail("Cosmetico invalido");

    const parsed = lerMeta(formData);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail(issue?.message ?? "Dados invalidos", issue?.path[0]?.toString());
    }

    // slug e tipo nao mudam: o slug e o identificador estavel que o app
    // referencia, e o tipo decide a pasta no bucket e as regras de dimensao.
    const meta = {
      nome: parsed.data.nome,
      descricao: parsed.data.descricao,
      raridade: parsed.data.raridade,
      precoMoedas: parsed.data.precoMoedas,
      tierMinimo: parsed.data.tierMinimo,
      ordem: parsed.data.ordem,
      colecaoId: parsed.data.colecaoId,
    };

    let asset: AssetDeCosmetico | null = null;
    const arquivo = lerArquivo(formData, "asset");
    if (arquivo) {
      const upload = await uploadCosmeticAsset({
        file: arquivo,
        fileTras: lerArquivo(formData, "assetTras"),
        tipo: parsed.data.tipo,
        slug: parsed.data.slug,
      });
      if (!upload.ok) return fail(upload.error, "asset");
      asset = assetDoUpload(upload);
    }

    try {
      const editado = await editarCosmetico(id, meta, asset);
      return ok(editado);
    } catch (erro) {
      if (asset) await limparAsset(asset);
      if (erro instanceof CosmeticoNaoEncontrado) return fail("Nao encontrado");
      if (erro instanceof ColecaoInexistente) {
        return fail("Essa colecao nao existe mais", "colecaoId");
      }
      throw erro;
    }
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Concede um cosmetico a uma pessoa (por nome de usuario). Serve para dar peca
 * paga a quem nao passou pela loja — teste, parceria, premio. Idempotente.
 */
export async function concederCosmeticoAction(
  username: string,
  cosmeticId: string,
): Promise<ActionResult<undefined>> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");
    if (typeof username !== "string" || !username.trim()) {
      return fail("Informe o nome de usuário", "username");
    }
    if (typeof cosmeticId !== "string" || !cosmeticId) {
      return fail("Cosmético inválido");
    }

    const alvo = await prisma.user.findUnique({
      where: { username: username.trim() },
      select: { id: true },
    });
    if (!alvo) return fail("Usuário não encontrado", "username");

    await concederCosmetico(alvo.id, cosmeticId);
    return ok();
  } catch (error) {
    if (error instanceof CosmeticoNaoEncontrado) return fail("Nao encontrado");
    return toActionError(error);
  }
}

export async function definirCosmeticoAtivoAction(
  id: string,
  ativo: boolean,
): Promise<ActionResult<CosmeticoNoPainel>> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");
    if (typeof id !== "string" || !id || typeof ativo !== "boolean") {
      return fail("Pedido invalido");
    }

    const atualizado = await definirCosmeticoAtivo(id, ativo);
    return ok(atualizado);
  } catch (error) {
    if (error instanceof CosmeticoNaoEncontrado) return fail("Nao encontrado");
    return toActionError(error);
  }
}

/**
 * Exclui do catalogo. `apagarAsset` = tambem apagar o objeto do R2 (o segundo
 * passo do dialogo de confirmacao). Sem ele, so a linha sai — recadastrar
 * reaproveita o mesmo arquivo.
 */
export async function excluirCosmeticoAction(
  id: string,
  apagarAsset: boolean,
): Promise<ActionResult<undefined>> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");
    if (typeof id !== "string" || !id) return fail("Cosmetico invalido");

    const excluido = await excluirCosmetico(id, apagarAsset === true);
    log.warn("equipe.cosmetico_excluido", "cosmético excluído do catálogo", {
      por: sessao.user.id,
      slug: excluido.slug,
      nome: excluido.nome,
      tipo: excluido.tipo,
      arteApagada: apagarAsset === true,
      possesApagadas: excluido.possesApagadas,
    });
    await writeAudit({
      serverId: null,
      actorId: sessao.user.id,
      action: "global.cosmetico_excluido",
      targetType: "cosmetic",
      targetId: id,
      metadata: {
        slug: excluido.slug,
        nome: excluido.nome,
        tipo: excluido.tipo,
        arteApagada: apagarAsset === true,
        possesApagadas: excluido.possesApagadas,
      },
    });
    return ok();
  } catch (error) {
    if (error instanceof CosmeticoNaoEncontrado) return fail("Nao encontrado");
    return toActionError(error);
  }
}
