import { prisma } from "@aether/db";
import { getChannelPermissions, loadMemberAccess } from "@aether/access";
import {
  has,
  room,
  VOZ_DE_AMIGO_MAX,
  type VoiceParticipant,
  type VozDeAmigo,
} from "@aether/shared";
import { log } from "@aether/shared/log";
import type { AetherServer } from "../types";
import {
  friendsOf,
  isConnected,
  statusOf,
  voiceLocation,
  voiceOfServer,
} from "../state";

/**
 * A call dos AMIGOS na tela Amigos.
 *
 * O estado de voz ja existia, mas so chegava a quem abria AQUELE servidor
 * (`voice:sync` no `server:join`). Este modulo leva a mesma informacao pela
 * sala pessoal (`room.user`) — e e aqui que mora a decisao de privacidade:
 *
 * A VISAO E CALCULADA POR QUEM VE. Um amigo so recebe o canal se for membro do
 * servidor e tiver `VIEW_CHANNEL` nele, pelo `@aether/access` (a mesma regra do
 * `voice:join`). Para os outros, a pessoa "nao esta em call" — `null`, e nao
 * "em um canal privado", porque isso ja contaria que o servidor existe.
 * Invisivel tambem e `null`, como ja acontece com o jogo.
 *
 * GATILHO UNICO, COM DEBOUNCE POR SERVIDOR. Os pontos que emitem
 * `voice:update` chamam `marcarVozAlterada`; o trabalho roda 400 ms depois,
 * uma vez por servidor, e so sai para os amigos de quem teve a ASSINATURA da
 * call mudada (canal, ocupantes, tela). Falar e mutar — que emitem
 * `voice:update` o tempo todo — nao mudam a assinatura, entao nao custam nada
 * aqui alem de uma leitura de estado por janela.
 */

const DEBOUNCE_MS = 400;
const CACHE_MS = 30_000;

/** userIds a reavaliar, por servidor, esperando o debounce. */
const pendentes = new Map<string, Set<string>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * O que foi anunciado por ultimo para cada pessoa em call, nesta instancia.
 * Some quando a pessoa sai (assinatura "fora"), entao o tamanho acompanha
 * quantos estao em call — nao cresce sem limite.
 */
const assinaturas = new Map<string, string>();

type Expiravel<T> = { valor: T; ate: number };
const podeVerCache = new Map<string, Expiravel<boolean>>();
const canalCache = new Map<string, Expiravel<InfoDoCanal | null>>();

interface InfoDoCanal {
  serverId: string;
  serverName: string;
  serverIconUrl: string | null;
  channelName: string;
  userLimit: number | null;
}

function lerCache<T>(mapa: Map<string, Expiravel<T>>, chave: string): T | undefined {
  const item = mapa.get(chave);
  if (!item) return undefined;
  if (item.ate < Date.now()) {
    mapa.delete(chave);
    return undefined;
  }
  return item.valor;
}

function gravarCache<T>(mapa: Map<string, Expiravel<T>>, chave: string, valor: T): void {
  // Teto simples: o cache e de 30 s, entao zerar quando enche custa no maximo
  // uma rodada de consultas — e evita guardar uma faxina periodica.
  if (mapa.size > 5_000) mapa.clear();
  mapa.set(chave, { valor, ate: Date.now() + CACHE_MS });
}

/**
 * `viewerId` pode ver o canal? Membro + `VIEW_CHANNEL`, pelo `@aether/access`.
 *
 * Em cache por 30 s. Consequencia anotada nas limitacoes: perder acesso ao
 * canal leva ate 30 s para tirar a call da tela Amigos — a ENTRADA no canal
 * continua revalidada no `voice:join`, entao a janela e so de exibicao.
 */
async function podeVer(viewerId: string, serverId: string, channelId: string): Promise<boolean> {
  const chave = `${viewerId}:${channelId}`;
  const emCache = lerCache(podeVerCache, chave);
  if (emCache !== undefined) return emCache;

  const access = await loadMemberAccess(serverId, viewerId);
  const bits = access ? await getChannelPermissions(access, channelId) : null;
  const pode = bits !== null && has(bits, "VIEW_CHANNEL");
  gravarCache(podeVerCache, chave, pode);
  return pode;
}

async function infoDoCanal(channelId: string): Promise<InfoDoCanal | null> {
  const emCache = lerCache(canalCache, channelId);
  if (emCache !== undefined) return emCache;

  const canal = await prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      name: true,
      userLimit: true,
      type: true,
      server: { select: { id: true, name: true, iconUrl: true } },
    },
  });
  const info =
    canal && canal.type === "VOICE"
      ? {
          serverId: canal.server.id,
          serverName: canal.server.name,
          serverIconUrl: canal.server.iconUrl,
          channelName: canal.name,
          userLimit: canal.userLimit,
        }
      : null;
  gravarCache(canalCache, channelId, info);
  return info;
}

function ocupantesDoCanal(participantes: VoiceParticipant[], channelId: string): VoiceParticipant[] {
  return participantes
    .filter((p) => p.channelId === channelId)
    .sort((a, b) => (a.joinedAt ?? "").localeCompare(b.joinedAt ?? ""));
}

/**
 * A call de `userId` como os amigos a veem — sem o filtro de quem ve, que vem
 * depois. `null` = fora de call, ou invisivel.
 */
async function chamadaDe(
  userId: string,
  participantes: VoiceParticipant[],
): Promise<VozDeAmigo | null> {
  const eu = participantes.find((p) => p.userId === userId);
  if (!eu?.channelId) return null;
  if ((await statusOf(userId)) === "OFFLINE") return null;

  const info = await infoDoCanal(eu.channelId);
  if (!info) return null;

  const ocupantes = ocupantesDoCanal(participantes, eu.channelId);
  return {
    serverId: info.serverId,
    serverName: info.serverName,
    serverIconUrl: info.serverIconUrl,
    channelId: eu.channelId,
    channelName: info.channelName,
    userLimit: info.userLimit,
    total: ocupantes.length,
    participantes: ocupantes.slice(0, VOZ_DE_AMIGO_MAX).map((p) => p.user),
    transmitindo: eu.streaming,
    desde: eu.joinedAt,
  };
}

function assinaturaDe(voz: VozDeAmigo | null): string {
  if (!voz) return "fora";
  return [
    voz.channelId,
    voz.transmitindo ? "t" : "",
    voz.total,
    voz.participantes.map((u) => `${u.id}/${u.avatarUrl ?? ""}/${u.displayName}`).join(","),
    voz.channelName,
  ].join("|");
}

/** Manda para cada amigo CONECTADO a visao que ele pode ter. */
async function anunciar(io: AetherServer, userId: string, voz: VozDeAmigo | null): Promise<void> {
  for (const amigoId of await friendsOf(userId)) {
    if (!(await isConnected(amigoId))) continue;
    const visivel =
      voz && (await podeVer(amigoId, voz.serverId, voz.channelId)) ? voz : null;
    io.to(room.user(amigoId)).emit("friend:voice", { userId, voz: visivel });
  }
}

async function processar(io: AetherServer, serverId: string, dicas: Set<string>): Promise<void> {
  const participantes = await voiceOfServer(serverId);
  const candidatos = new Set(dicas);
  for (const p of participantes) candidatos.add(p.userId);

  for (const userId of candidatos) {
    /**
     * Saiu DESTE servidor para outro: quem anuncia e o processamento do
     * servidor novo (que tambem foi marcado). Anunciar "fora" daqui, depois
     * daquele, apagaria a call nova da tela dos amigos.
     */
    const onde = await voiceLocation(userId);
    if (onde && onde.serverId !== serverId) continue;

    const voz = await chamadaDe(userId, participantes);
    const assinatura = assinaturaDe(voz);
    if (assinaturas.get(userId) === assinatura) continue;
    if (voz) assinaturas.set(userId, assinatura);
    else assinaturas.delete(userId);

    await anunciar(io, userId, voz);
  }
}

/**
 * "A voz deste servidor mudou" — chamado ao lado de cada `voice:update`.
 * `userIds` sao quem pode ter SAIDO: depois da saida eles nao aparecem mais
 * em `voiceOfServer`, e sem a dica ninguem anunciaria que sairam.
 *
 * Nunca lanca e nunca espera: quem chama esta no caminho de uma call.
 */
export function marcarVozAlterada(
  io: AetherServer,
  serverId: string,
  userIds: string[] = [],
): void {
  let fila = pendentes.get(serverId);
  if (!fila) {
    fila = new Set();
    pendentes.set(serverId, fila);
  }
  for (const id of userIds) fila.add(id);

  if (timers.has(serverId)) return;
  timers.set(
    serverId,
    setTimeout(() => {
      timers.delete(serverId);
      const dicas = pendentes.get(serverId) ?? new Set<string>();
      pendentes.delete(serverId);
      processar(io, serverId, dicas).catch((erro) =>
        log.warn("gateway.voz_de_amigos.falhou", "não anunciei a voz aos amigos", {
          err: erro,
          serverId,
        }),
      );
    }, DEBOUNCE_MS),
  );
}

/** A pessoa mudou de visibilidade (invisivel <-> visivel): reavalia a call dela. */
export async function reavaliarVozDe(io: AetherServer, userId: string): Promise<void> {
  const onde = await voiceLocation(userId);
  if (onde) marcarVozAlterada(io, onde.serverId, [userId]);
}

/**
 * Foto das calls dos amigos de `viewerId`, ja filtrada para ele. Usada pelo
 * `friend:voice-sync` — ao conectar, reconectar e quando a lista de amigos muda.
 */
export async function vozDosAmigos(
  viewerId: string,
): Promise<{ userId: string; voz: VozDeAmigo }[]> {
  const porServidor = new Map<string, VoiceParticipant[]>();
  const resultado: { userId: string; voz: VozDeAmigo }[] = [];

  for (const amigoId of await friendsOf(viewerId)) {
    const onde = await voiceLocation(amigoId);
    if (!onde) continue;

    let participantes = porServidor.get(onde.serverId);
    if (!participantes) {
      participantes = await voiceOfServer(onde.serverId);
      porServidor.set(onde.serverId, participantes);
    }

    const voz = await chamadaDe(amigoId, participantes);
    if (voz && (await podeVer(viewerId, voz.serverId, voz.channelId))) {
      resultado.push({ userId: amigoId, voz });
    }
  }
  return resultado;
}
