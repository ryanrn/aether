import { randomUUID } from "node:crypto";
import {
  adaptadorDoJogo,
  CONVITE_VALIDADE_MS,
  CONVITES_ENVIADOS_MAX,
  CONVITES_RECEBIDOS_MAX,
  isTipoDeConvite,
  limparComoEntrar,
  type CodigoDeRecusaDeConvite,
  type ConviteAck,
  type ConviteDeJogo,
  type PresenceEntry,
  type PublicUser,
  type UserStatus,
} from "@aether/shared";
import type { ArmazemDeConvites } from "./armazem";

/**
 * Regras dos convites de jogo. Sem socket aqui: quem chama (o handler) cuida
 * de limite de ritmo e de avisar as salas; estas funcoes so decidem e gravam,
 * e por isso dao para testar com dependencias falsas.
 *
 * O que NAO e verdade so porque o cliente disse:
 * - amizade: vem do estado do gateway (`friendsOf`), que bloqueio desfaz;
 * - o jogo: vem da presenca do ANFITRIAO no gateway, nao do payload — ninguem
 *   pede para entrar num jogo que o outro nao esta jogando;
 * - invisivel conta como "nao esta jogando", com a MESMA mensagem: a recusa
 *   nao pode contar que a pessoa esta la escondida.
 */
export interface DependenciasDeConvite {
  armazem: ArmazemDeConvites;
  friendsOf(userId: string): Promise<string[]>;
  isConnected(userId: string): Promise<boolean>;
  presenceEntryOf(userId: string): Promise<PresenceEntry | null>;
  statusOf(userId: string): Promise<UserStatus>;
  usuarioPublico(userId: string): Promise<PublicUser | null>;
  agora?: () => number;
  novoId?: () => string;
}

/**
 * "Como entrar" limpo E no formato do jogo (`adaptadores-de-jogo.ts`): um
 * Riot ID no VALORANT, nome Epic no Fortnite. Vazio e valido — o campo e
 * opcional. `erro` volta para o anfitriao corrigir antes de o outro ver.
 */
function comoEntrarDoJogo(
  jogo: string,
  bruto: unknown,
): { valor: string | null; erro: string | null } {
  const valor = limparComoEntrar(bruto);
  if (valor === null) return { valor: null, erro: null };
  return { valor, erro: adaptadorDoJogo(jogo).comoEntrar.validar(valor) };
}

function recusa(codigo: CodigoDeRecusaDeConvite, error: string): ConviteAck {
  return { ok: false, codigo, error };
}

function falha(codigo: CodigoDeRecusaDeConvite, error: string): { ack: ConviteAck; novo: false } {
  return { ack: recusa(codigo, error), novo: false };
}

/** O jogo que o anfitriao esta jogando e mostrando agora, ou `null`. */
async function jogoVisivel(
  deps: DependenciasDeConvite,
  anfitriaoId: string,
): Promise<{ nome: string; capa: string | null } | null> {
  if (!(await deps.isConnected(anfitriaoId))) return null;
  if ((await deps.statusOf(anfitriaoId)) === "OFFLINE") return null;
  const entrada = await deps.presenceEntryOf(anfitriaoId);
  if (!entrada?.game) return null;
  return { nome: entrada.game, capa: entrada.gameCover ?? null };
}

/**
 * Convite ainda pendente mas vencido vira `expirado` aqui, na leitura. O timer
 * do handler faz o mesmo na hora certa; isto cobre o timer que se perdeu
 * (gateway reiniciou, outra instancia).
 */
export async function vencerSePreciso(
  deps: DependenciasDeConvite,
  convite: ConviteDeJogo,
): Promise<{ convite: ConviteDeJogo; mudou: boolean }> {
  const agora = (deps.agora ?? Date.now)();
  if (convite.estado !== "pendente" || new Date(convite.expiraEm).getTime() > agora) {
    return { convite, mudou: false };
  }
  const vencido: ConviteDeJogo = {
    ...convite,
    estado: "expirado",
    respondidoEm: new Date(agora).toISOString(),
  };
  const mudou = await deps.armazem.transicionar(vencido);
  if (mudou) return { convite: vencido, mudou: true };
  // Outra parte respondeu no mesmo instante: vale o que ficou gravado.
  return { convite: (await deps.armazem.buscar(convite.id)) ?? vencido, mudou: false };
}

/**
 * `novo: false` = devolveu um convite que ja existia (o mesmo pedido de novo):
 * o handler NAO renotifica o destinatario — clicar de novo nao e insistir.
 */
export async function enviarConvite(
  deps: DependenciasDeConvite,
  remetente: PublicUser,
  payload: unknown,
): Promise<{ resposta: ConviteAck; novo: boolean }> {
  const resposta = await montarConvite(deps, remetente, payload);
  return { resposta: resposta.ack, novo: resposta.novo };
}

async function montarConvite(
  deps: DependenciasDeConvite,
  remetente: PublicUser,
  payload: unknown,
): Promise<{ ack: ConviteAck; novo: boolean }> {
  const p = payload as { paraId?: unknown; tipo?: unknown; comoEntrar?: unknown } | null;
  const paraId = p?.paraId;
  if (typeof paraId !== "string" || !paraId || !isTipoDeConvite(p?.tipo)) {
    return falha("invalido", "Convite invalido.");
  }
  const tipo = p.tipo;
  if (paraId === remetente.id) return falha("invalido", "Convite invalido.");

  if (!(await deps.friendsOf(remetente.id)).includes(paraId)) {
    return falha("nao_amigo", "Voce so pode convidar amigos.");
  }

  const para = await deps.usuarioPublico(paraId);
  if (!para) return falha("nao_amigo", "Voce so pode convidar amigos.");

  const anfitriaoId = tipo === "pedir" ? paraId : remetente.id;
  const jogo = await jogoVisivel(deps, anfitriaoId);
  if (!jogo) {
    return falha(
      "sem_jogo",
      tipo === "pedir"
        ? `${para.displayName} nao esta jogando agora.`
        : "Abra um jogo no app de desktop para convidar.",
    );
  }

  const existentes = await Promise.all(
    (await deps.armazem.daPessoa(remetente.id)).map(
      async (c) => (await vencerSePreciso(deps, c)).convite,
    ),
  );
  const pendentes = existentes.filter((c) => c.estado === "pendente");

  /**
   * Mesmo pedido de novo (mesmo par, mesmo tipo, mesmo jogo): devolve o que ja
   * existe em vez de criar outro. Clicar duas vezes nao vira duas notificacoes.
   */
  const repetido = pendentes.find(
    (c) => c.de.id === remetente.id && c.para.id === paraId && c.tipo === tipo && c.jogo === jogo.nome,
  );
  if (repetido) return { ack: { ok: true, convite: repetido }, novo: false };

  if (pendentes.filter((c) => c.de.id === remetente.id).length >= CONVITES_ENVIADOS_MAX) {
    return falha("limite", "Voce ja tem convites demais esperando resposta.");
  }

  const doDestinatario = await deps.armazem.daPessoa(paraId);
  const recebidosPendentes = doDestinatario.filter(
    (c) =>
      c.para.id === paraId &&
      c.estado === "pendente" &&
      new Date(c.expiraEm).getTime() > (deps.agora ?? Date.now)(),
  );
  if (recebidosPendentes.length >= CONVITES_RECEBIDOS_MAX) {
    return falha("limite", `${para.displayName} tem convites demais agora. Tente daqui a pouco.`);
  }

  // No convite, o anfitriao e quem envia: ja pode dizer como entrar.
  const comoEntrar =
    tipo === "convidar" ? comoEntrarDoJogo(jogo.nome, p.comoEntrar) : { valor: null, erro: null };
  if (comoEntrar.erro) return falha("invalido", comoEntrar.erro);

  const agora = (deps.agora ?? Date.now)();
  const convite: ConviteDeJogo = {
    id: (deps.novoId ?? randomUUID)(),
    tipo,
    de: remetente,
    para,
    anfitriaoId,
    jogo: jogo.nome,
    jogoCapa: jogo.capa,
    estado: "pendente",
    criadoEm: new Date(agora).toISOString(),
    expiraEm: new Date(agora + CONVITE_VALIDADE_MS).toISOString(),
    respondidoEm: null,
    comoEntrar: comoEntrar.valor,
  };
  await deps.armazem.criar(convite);
  return { ack: { ok: true, convite }, novo: true };
}

async function buscarParaAgir(
  deps: DependenciasDeConvite,
  payload: unknown,
): Promise<ConviteDeJogo | ConviteAck> {
  const id = (payload as { id?: unknown } | null)?.id;
  if (typeof id !== "string" || !id) return recusa("invalido", "Convite invalido.");
  const achado = await deps.armazem.buscar(id);
  if (!achado) return recusa("nao_encontrado", "Esse convite nao existe mais.");
  return (await vencerSePreciso(deps, achado)).convite;
}

function naoPendente(convite: ConviteDeJogo): ConviteAck {
  return convite.estado === "expirado"
    ? recusa("expirado", "Esse convite expirou.")
    : recusa("ja_respondido", "Esse convite ja foi respondido.");
}

export async function responderConvite(
  deps: DependenciasDeConvite,
  userId: string,
  payload: unknown,
): Promise<ConviteAck> {
  const achado = await buscarParaAgir(deps, payload);
  if ("ok" in achado) return achado;
  // Nao revela convite alheio: quem nao e o destinatario ve "nao existe".
  if (achado.para.id !== userId) return recusa("nao_encontrado", "Esse convite nao existe mais.");
  if (achado.estado !== "pendente") return naoPendente(achado);

  const p = payload as { aceitar?: unknown; comoEntrar?: unknown };
  const aceitar = p.aceitar === true;
  // Num pedido, quem aceita e o anfitriao: e agora que ele diz como entrar.
  const escreve = aceitar && achado.anfitriaoId === userId;
  const comoEntrar = escreve
    ? comoEntrarDoJogo(achado.jogo, p.comoEntrar)
    : { valor: aceitar ? achado.comoEntrar : null, erro: null };
  // Formato errado nao responde: o convite segue pendente para corrigir.
  if (comoEntrar.erro) return recusa("invalido", comoEntrar.erro);
  const agora = (deps.agora ?? Date.now)();
  const novo: ConviteDeJogo = {
    ...achado,
    estado: aceitar ? "aceito" : "recusado",
    respondidoEm: new Date(agora).toISOString(),
    comoEntrar: comoEntrar.valor,
  };
  if (!(await deps.armazem.transicionar(novo))) {
    const atual = await deps.armazem.buscar(achado.id);
    return atual ? naoPendente(atual) : recusa("nao_encontrado", "Esse convite nao existe mais.");
  }
  return { ok: true, convite: novo };
}

export async function cancelarConvite(
  deps: DependenciasDeConvite,
  userId: string,
  payload: unknown,
): Promise<ConviteAck> {
  const achado = await buscarParaAgir(deps, payload);
  if ("ok" in achado) return achado;
  if (achado.de.id !== userId) return recusa("nao_encontrado", "Esse convite nao existe mais.");
  if (achado.estado !== "pendente") return naoPendente(achado);

  const novo: ConviteDeJogo = {
    ...achado,
    estado: "cancelado",
    respondidoEm: new Date((deps.agora ?? Date.now)()).toISOString(),
  };
  if (!(await deps.armazem.transicionar(novo))) {
    const atual = await deps.armazem.buscar(achado.id);
    return atual ? naoPendente(atual) : recusa("nao_encontrado", "Esse convite nao existe mais.");
  }
  return { ok: true, convite: novo };
}

/**
 * Os convites da pessoa, com os vencidos ja marcados. `vencidos` volta junto
 * para o handler avisar o outro lado de cada um que expirou nesta leitura.
 */
export async function listarConvites(
  deps: DependenciasDeConvite,
  userId: string,
): Promise<{ convites: ConviteDeJogo[]; vencidos: ConviteDeJogo[] }> {
  const convites: ConviteDeJogo[] = [];
  const vencidos: ConviteDeJogo[] = [];
  for (const c of await deps.armazem.daPessoa(userId)) {
    const r = await vencerSePreciso(deps, c);
    convites.push(r.convite);
    if (r.mudou) vencidos.push(r.convite);
  }
  convites.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  return { convites, vencidos };
}
