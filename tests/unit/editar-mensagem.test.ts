import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Editar mensagem (P1-1) — o caminho de escrita do gateway.
 *
 * O banco e `autorizarConversa` sao DUBLADOS: o que se prende aqui e a regra
 * (so o autor, so quem ainda escreve na conversa, nada de ressuscitar
 * mensagem apagada) e o que vai para a sala. A consulta real fica para os
 * verify-* contra servicos no ar.
 */

const findUnique = vi.fn();
const updateMany = vi.fn();
const autorizarConversa = vi.fn();

vi.mock("@aether/db", () => ({
  prisma: { message: { findUnique, updateMany } },
}));
vi.mock("../../apps/realtime/src/enviar-mensagem", () => ({
  autorizarConversa,
}));

const { editarMensagem } = await import(
  "../../apps/realtime/src/editar-mensagem"
);

const emit = vi.fn();
const to = vi.fn(() => ({ emit }));
const io = { to } as unknown as Parameters<typeof editarMensagem>[0];

const AUTOR = { id: "autor", silenciadoEm: null, silenciadoAte: null };

function linha(over: Record<string, unknown> = {}) {
  return {
    authorId: "autor",
    channelId: "canal-1",
    dmChannelId: null,
    content: "texto antigo",
    editedAt: null,
    deletedAt: null,
    _count: { anexos: 0 },
    ...over,
  };
}

beforeEach(() => {
  findUnique.mockReset();
  updateMany.mockReset().mockResolvedValue({ count: 1 });
  autorizarConversa.mockReset().mockResolvedValue({
    tipo: "canal",
    channelId: "canal-1",
    serverId: "srv",
    isText: true,
  });
  emit.mockClear();
  to.mockClear();
});

describe("editarMensagem", () => {
  it("autor edita: grava conteudo e editedAt e avisa a sala do canal", async () => {
    findUnique.mockResolvedValue(linha());

    const r = await editarMensagem(io, {
      ator: AUTOR,
      messageId: "m1",
      content: "texto novo",
    });

    expect(r.ok).toBe(true);
    const where = updateMany.mock.calls[0]![0].where;
    // deletedAt no WHERE: apagada no meio do caminho nao volta.
    expect(where).toEqual({ id: "m1", authorId: "autor", deletedAt: null });
    expect(updateMany.mock.calls[0]![0].data.content).toBe("texto novo");
    expect(to).toHaveBeenCalledWith("channel:canal-1");
    const [evento, payload] = emit.mock.calls[0]!;
    expect(evento).toBe("message:updated");
    expect(payload).toMatchObject({
      messageId: "m1",
      conversationId: "canal-1",
      content: "texto novo",
    });
    // So o que mudou viaja — nada de reacoes do ponto de vista do autor.
    expect(Object.keys(payload).sort()).toEqual(
      ["content", "conversationId", "editedAt", "messageId"].sort(),
    );
  });

  it("mensagem de outra pessoa responde 'nao encontrada', igual a inexistente", async () => {
    findUnique.mockResolvedValue(linha({ authorId: "outra" }));
    const deOutra = await editarMensagem(io, {
      ator: AUTOR,
      messageId: "m1",
      content: "x",
    });

    findUnique.mockResolvedValue(null);
    const inexistente = await editarMensagem(io, {
      ator: AUTOR,
      messageId: "m1",
      content: "x",
    });

    expect(deOutra).toEqual(inexistente);
    expect(deOutra).toMatchObject({ ok: false, codigo: "nao_encontrada" });
    expect(updateMany).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("mensagem apagada nao e editada", async () => {
    findUnique.mockResolvedValue(linha({ deletedAt: new Date() }));
    const r = await editarMensagem(io, { ator: AUTOR, messageId: "m1", content: "x" });
    expect(r).toMatchObject({ ok: false, codigo: "nao_encontrada" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("quem perdeu acesso a conversa nao edita o que ficou para tras", async () => {
    findUnique.mockResolvedValue(linha());
    autorizarConversa.mockResolvedValue(null);
    const r = await editarMensagem(io, { ator: AUTOR, messageId: "m1", content: "x" });
    expect(r).toMatchObject({ ok: false, codigo: "nao_encontrada" });
    expect(autorizarConversa).toHaveBeenCalledWith("autor", "canal-1", "SEND_MESSAGES");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("conta silenciada nao edita", async () => {
    const r = await editarMensagem(io, {
      ator: { id: "autor", silenciadoEm: new Date(), silenciadoAte: null },
      messageId: "m1",
      content: "x",
    });
    expect(r).toMatchObject({ ok: false, codigo: "silenciado" });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("texto vazio sem anexo e recusado; com anexo e aceito", async () => {
    findUnique.mockResolvedValue(linha());
    const semAnexo = await editarMensagem(io, { ator: AUTOR, messageId: "m1", content: "   " });
    expect(semAnexo).toMatchObject({ ok: false, codigo: "invalida" });

    findUnique.mockResolvedValue(linha({ _count: { anexos: 1 } }));
    const comAnexo = await editarMensagem(io, { ator: AUTOR, messageId: "m1", content: "" });
    expect(comAnexo.ok).toBe(true);
  });

  it("texto longo demais e recusado", async () => {
    findUnique.mockResolvedValue(linha());
    const r = await editarMensagem(io, {
      ator: AUTOR,
      messageId: "m1",
      content: "a".repeat(4001),
    });
    expect(r).toMatchObject({ ok: false, codigo: "invalida" });
  });

  it("texto igual ao atual nao grava nem carimba (editada)", async () => {
    findUnique.mockResolvedValue(linha());
    const r = await editarMensagem(io, {
      ator: AUTOR,
      messageId: "m1",
      content: "texto antigo",
    });
    expect(r).toEqual({ ok: true, content: "texto antigo", editedAt: null });
    expect(updateMany).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("apagada entre a leitura e a escrita: nao ressuscita", async () => {
    findUnique.mockResolvedValue(linha());
    updateMany.mockResolvedValue({ count: 0 });
    const r = await editarMensagem(io, { ator: AUTOR, messageId: "m1", content: "novo" });
    expect(r).toMatchObject({ ok: false, codigo: "nao_encontrada" });
    expect(emit).not.toHaveBeenCalled();
  });

  it("em DM avisa as duas salas pessoais", async () => {
    findUnique.mockResolvedValue(linha({ channelId: null, dmChannelId: "dm-1" }));
    autorizarConversa.mockResolvedValue({ tipo: "dm", dmId: "dm-1", outroId: "outro" });
    const r = await editarMensagem(io, { ator: AUTOR, messageId: "m1", content: "novo" });
    expect(r.ok).toBe(true);
    expect(to).toHaveBeenCalledWith(["user:autor", "user:outro"]);
    expect(emit.mock.calls[0]![1].conversationId).toBe("dm-1");
  });
});
