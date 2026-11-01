/**
 * Contratos compartilhados entre web, gateway realtime (fase 3) e servico de midia (fase 4/5).
 * Nada aqui depende de Prisma ou de React de proposito: e o vocabulario comum do sistema.
 */

import { planoEfetivo, type PlanTier } from "./plans";
import {
  decoracaoEfetiva,
  molduraEfetiva,
  podeAvatarAnimado,
  type DecoracaoPublica,
  type DecoracaoRow,
} from "./cosmeticos";

export const USER_STATUSES = ["ONLINE", "IDLE", "DND", "OFFLINE"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Guarda de tipo para valor vindo da rede — nao confiamos no cliente. */
export function isUserStatus(value: unknown): value is UserStatus {
  return (
    typeof value === "string" &&
    (USER_STATUSES as readonly string[]).includes(value)
  );
}

export type ChannelType = "TEXT" | "VOICE";

/**
 * O que a linha `User` representa. `HUMAN` e o normal; `BOT` e a identidade de
 * uma `Application`; `WEBHOOK` existe so para ser autor de mensagem de webhook.
 * Viaja no `PublicUser` para o chat e a lista de membros marcarem o bot.
 */
export type UserKind = "HUMAN" | "BOT" | "WEBHOOK";

export function ehUserKind(v: unknown): v is UserKind {
  return v === "HUMAN" || v === "BOT" || v === "WEBHOOK";
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  status: UserStatus;
  /**
   * `HUMAN` na esmagadora maioria. `BOT`/`WEBHOOK` fazem a tela desenhar o selo
   * — mensagem de bot tem de ser reconhecivel na hora. OBRIGATORIO pela mesma
   * razao do `plano`: campo opcional seria esquecido em silencio num `select` e
   * o bot apareceria disfarcado de gente numa tela so.
   */
  kind: UserKind;
  /**
   * O plano JA RESOLVIDO — vencimento aplicado, pronto para desenhar.
   *
   * Publico de proposito: metade do valor de um plano e social, e sem o plano
   * viajando junto com a pessoa o selo so apareceria para quem pagou, nas
   * proprias configuracoes. Nao ha nada sensivel aqui — `expiraEm`, provedor e
   * id externo ficam fora, porque a tela nao precisa deles e o navegador de
   * outra pessoa nao tem o que fazer com eles.
   *
   * OBRIGATORIO, e nao opcional. Como sao muitos os lugares que montam um
   * `PublicUser`, campo opcional deixaria cada um deles esquecer em silencio e
   * o assinante ficaria sem selo em uma tela so. Assim o compilador cobra.
   * Quem nao assina e `FREE`, que o selo trata como ausencia de selo.
   */
  plano: PlanTier;
  /**
   * A moldura do avatar, JA RESOLVIDA contra o plano — so o id, e nulo quando
   * nao ha nenhuma valendo.
   *
   * Vem resolvida pelo mesmo motivo do `plano`: se descesse crua, cada tela
   * teria de comparar o tier de novo, e a que esquecesse desenharia moldura de
   * assinante em conta que deixou de pagar.
   */
  moldura: string | null;
  /**
   * A DECORACAO de avatar equipada, JA RESOLVIDA (contra plano e `ativo`) — as
   * duas URLs, ou `null`. Viaja no `PublicUser` porque a decoracao aparece em
   * cima do avatar em toda parte (chat, listas). O BANNER nao vem aqui: so
   * aparece no cartao de perfil, que o resolve sob demanda.
   */
  decoracao: DecoracaoPublica | null;
}

/**
 * Formato CRU de usuario vindo do banco.
 *
 * Declarado aqui — sem importar Prisma — pelo mesmo motivo de `MessageRow`:
 * o app web e o gateway produzem `PublicUser` pela MESMA funcao, em vez de
 * cada um montar o objeto do seu jeito e um deles esquecer um campo.
 *
 * `assinatura` e OBRIGATORIO, ainda que possa ser nulo. A diferenca importa:
 * nulo significa "esta pessoa nao assina", enquanto ausente significaria "quem
 * consultou esqueceu de pedir a assinatura" — e as duas coisas produziriam
 * `FREE` calado, com o assinante perdendo o selo numa tela so. Sendo
 * obrigatorio, esquecer no `select` nao compila.
 */
export interface UserRow {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  status: string;
  /** `User.kind` cru do enum do Postgres — `toPublicUser` estreita. */
  kind: string;
  /**
   * O mesmo avatar parado, quando o enviado e animado. Nulo se nunca houve
   * animacao — ai `avatarUrl` ja e a versao parada.
   */
  avatarEstaticoUrl: string | null;
  /** A escolha guardada. Continua no banco mesmo sem plano que a cubra. */
  molduraId: string | null;
  /**
   * A relacao `User.decoracao` ja trazida pelo `select` — linha crua do
   * `Cosmetic` equipado, ou `null`. `toPublicUser` resolve contra o plano.
   */
  decoracao: DecoracaoRow | null;
  assinatura: {
    tier: PlanTier;
    expiraEm: Date | string | null;
  } | null;
}

/**
 * O `select` do Prisma que preenche um `UserRow`, num lugar so.
 *
 * Antes disto, nove consultas repetiam a mesma lista de campos a mao. Enquanto
 * era so o perfil basico, copiar custava pouco; com o plano entrando, cada
 * copia vira uma chance de um lugar mostrar assinatura vencida como ativa.
 *
 * E objeto literal puro de proposito — nao importa Prisma — para que este
 * arquivo continue sem dependencia de banco e possa ser lido tambem pelo
 * navegador.
 */
export const SELECT_USUARIO_PUBLICO = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  avatarEstaticoUrl: true,
  status: true,
  kind: true,
  molduraId: true,
  /**
   * A decoracao equipada — so os quatro campos que `decoracaoEfetiva` precisa.
   * E um LEFT JOIN por linha de usuario; `Cosmetic` e tabela pequena e a busca
   * e por chave primaria, entao o custo e baixo. O banner NAO entra: nao viaja
   * no `PublicUser`.
   */
  decoracao: {
    select: {
      assetUrl: true,
      assetTrasUrl: true,
      tierMinimo: true,
      ativo: true,
    },
  },
  /**
   * So `tier` e `expiraEm`: sao o que `planoEfetivo` precisa. Provedor, id
   * externo e quem concedeu ficam fora — nao servem a tela e nao tem por que
   * atravessar a rede ate o navegador de outra pessoa.
   */
  assinatura: { select: { tier: true, expiraEm: true } },
} as const;

/**
 * Linha do banco -> usuario publico, com o vencimento do plano ja aplicado.
 *
 * `agora` entra por parametro para o teste conseguir posicionar o relogio; na
 * vida real ninguem passa.
 */
export function toPublicUser(row: UserRow, agora: Date = new Date()): PublicUser {
  const plano = planoEfetivo(row.assinatura, agora);
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    /**
     * O AVATAR TAMBEM E RESOLVIDO CONTRA O PLANO, como a moldura.
     *
     * Sem plano que cubra animacao, vai a versao parada — que existe porque
     * foi gerada no envio. A foto NAO some e o arquivo animado NAO e apagado:
     * reativar o plano devolve o movimento sem novo envio.
     *
     * Quem nunca enviou animacao tem `avatarEstaticoUrl` nulo, e cai em
     * `avatarUrl`, que ja e parado. Por isso a regra vale para todo mundo sem
     * precisar saber se o avatar e animado.
     */
    avatarUrl: podeAvatarAnimado(plano)
      ? row.avatarUrl
      : (row.avatarEstaticoUrl ?? row.avatarUrl),
    /**
     * `status` chega como string do banco. Valor desconhecido vira OFFLINE em
     * vez de vazar cru para a tela — o mesmo cuidado que `toPublicMessage` ja
     * tomava com o autor.
     */
    status: isUserStatus(row.status) ? row.status : "OFFLINE",
    /** Desconhecido vira `HUMAN` — o mesmo cuidado do `status`. */
    kind: ehUserKind(row.kind) ? row.kind : "HUMAN",
    plano,
    /**
     * Resolvida contra o plano JA calculado acima — e nao contra o tier cru da
     * assinatura. Usar o tier cru exibiria a moldura paga durante todo o
     * periodo entre o vencimento e alguem mexer na linha.
     */
    moldura: molduraEfetiva(row.molduraId, plano)?.id ?? null,
    /**
     * Mesma resolucao contra o plano JA calculado: decoracao paga em conta que
     * venceu some, e a escolha continua no banco para voltar sozinha.
     */
    decoracao: decoracaoEfetiva(row.decoracao, plano),
  };
}

export interface PublicRole {
  id: string;
  name: string;
  color: string;
  position: number;
  isDefault: boolean;
  isOwner: boolean;
  /** bitfield serializado como string — bigint nao sobrevive a JSON.stringify */
  permissions: string;
  /**
   * Nome do jogo que da este cargo automaticamente, ou `null` (fase 2). So
   * atribuido de fato com `cargoPorJogo` ligado no servidor. A tela de cargos
   * usa para mostrar o vinculo; o painel de membros nao precisa disto.
   */
  jogoVinculado?: string | null;
}

export interface PublicMember {
  id: string;
  user: PublicUser;
  nickname: string | null;
  roles: PublicRole[];
  joinedAt: string;
}

/** Cor de quem nao tem cargo colorido nenhum (nem o padrao tem cor custom). */
export const COR_CARGO_PADRAO = "#6B7280";

/**
 * A cor que representa a pessoa: a do cargo mais alto que NAO e o padrao
 * (@everyone), ou a do primeiro cargo que ela tiver, ou a cor neutra.
 *
 * Uma funcao so, para o painel de membros e o chat nunca decidirem duas cores
 * diferentes para a mesma pessoa. `roles` precisa vir ordenado por `position`
 * DESC — quem monta `PublicMember` ja garante isso.
 */
export function corDoCargoPrincipal(roles: PublicRole[]): string {
  const top = roles.find((r) => !r.isDefault) ?? roles[0];
  return top?.color ?? COR_CARGO_PADRAO;
}

export interface PublicChannel {
  id: string;
  name: string;
  topic: string | null;
  type: ChannelType;
  categoryId: string | null;
  position: number;
  isPrivate: boolean;
  isTemporary: boolean;
  /** sala de grupo (LFG): o jogo que ela junta, ou `null` num canal comum */
  jogo?: string | null;
  /** id de quem abriu a sala de grupo, ou `null` (fase 2, estagio 3) */
  criadaPor?: string | null;
  userLimit: number | null;
}

export interface PublicCategory {
  id: string;
  name: string;
  position: number;
  channels: PublicChannel[];
}

export interface PublicServer {
  id: string;
  name: string;
  iconUrl: string | null;
  ownerId: string;
  memberCount: number;
}

/**
 * Estado de voz de um membro. Alimentado pelo gateway (fase 3) e pelo SFU (fase 4).
 * Definido agora para que a UI da fase 1 ja renderize os indicadores corretos.
 */
export interface VoiceState {
  userId: string;
  channelId: string | null;
  /** o proprio usuario se mutou */
  selfMuted: boolean;
  /** o proprio usuario se ensurdeceu */
  selfDeafened: boolean;
  /** um moderador mutou o usuario */
  serverMuted: boolean;
  /** um moderador ensurdeceu o usuario */
  serverDeafened: boolean;
  /** esta transmitindo tela neste momento */
  streaming: boolean;
  /** a camera esta ligada — sinalizacao; o video em si vai pelo SFU */
  camera: boolean;
  /** detectado como falando agora */
  speaking: boolean;
  /**
   * Quando entrou no canal atual (ISO), para contar ha quanto tempo esta ali.
   *
   * Carimbado pelo GATEWAY, nunca pelo cliente: relogio de navegador erra, e
   * um cliente poderia mentir "estou aqui ha 8 horas". `null` quando a pessoa
   * nao esta em voz.
   *
   * Trocar de canal REINICIA a contagem — a atividade e "estar neste canal",
   * nao "estar em voz em algum lugar".
   */
  joinedAt: string | null;
}

/**
 * Quem esta olhando o servidor, do ponto de vista da UI.
 *
 * `permissions` e o bitfield serializado como string (bigint nao sobrevive a
 * serializacao entre servidor e cliente). Serve APENAS para mostrar/esconder
 * controles — toda action recalcula as permissoes no servidor.
 */
export interface ViewerContext {
  memberId: string;
  isOwner: boolean;
  permissions: string;
  roleIds: string[];
  highestRolePosition: number;
}

/** Permissoes efetivas por canal, ja com os overwrites aplicados. */
export type ChannelPermissionMap = Record<string, string>;

/** Estado de voz ja resolvido com o usuario — formato que a UI consome. */
export interface VoiceParticipant extends VoiceState {
  user: PublicUser;
}

/** Resultado padrao de toda server action — nunca lancamos erro cru para o cliente. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

/**
 * Mensagem de canal de texto, no formato que o cliente consome.
 *
 * Datas viram string ISO de proposito: `Date` nao sobrevive a serializacao
 * entre servidor e cliente nem ao JSON do socket, e converter em dois lugares
 * diferentes e como os fusos comecam a divergir.
 */
/**
 * Uma reacao AGRUPADA, do jeito que a tela desenha: o emoji, quantos e se voce
 * e um deles.
 *
 * Nao vai a lista de quem reagiu. Numa mensagem com trinta reacoes isso seriam
 * trinta usuarios completos por emoji viajando a cada carregamento de
 * historico, para desenhar um numero. Quem quiser ver os nomes um dia pede sob
 * demanda.
 */
export interface PublicReaction {
  emoji: string;
  count: number;
  /** Voce reagiu com este. E o que pinta o botao de aceso. */
  mine: boolean;
}

/**
 * Um arquivo anexado, como a tela recebe.
 *
 * A `url` ja vem montada pelo servidor. O cliente NAO monta caminho de bucket:
 * juntar `R2_PUBLIC_URL` com a chave no navegador significaria a chave do
 * objeto virar parte do contrato publico, e trocar de provedor depois passaria
 * a exigir mexer no cliente.
 */
export interface PublicAttachment {
  id: string;
  nome: string;
  /** o tipo com que o objeto foi GRAVADO, que decide como a tela desenha */
  mime: string;
  tamanho: number;
  url: string;
  largura: number | null;
  altura: number | null;
}

export interface PublicMessage {
  id: string;
  /**
   * Onde a mensagem vive: um canal de servidor OU uma conversa direta.
   *
   * NAO se chama `channelId` de proposito. Ate as conversas diretas
   * existirem, esse era o nome, e o cliente sempre usou o campo como CHAVE
   * (`messages[id]`, `unread[id]`, comparacao com a conversa aberta) — nunca
   * para buscar um `Channel`. Com dois tipos de pai possiveis, manter o nome
   * antigo deixaria pronta a armadilha de alguem escrever
   * `channel.findUnique({ id: message.channelId })` e receber `null` calado em
   * toda conversa direta.
   */
  conversationId: string;
  content: string;
  author: PublicUser;
  createdAt: string;
  editedAt: string | null;
  reactions: PublicReaction[];
  anexos: PublicAttachment[];
  /**
   * A mensagem RESPONDIDA, reduzida ao que a referencia mostra: quem escreveu e
   * um trecho. `null` quando nao e resposta; `{ apagada: true }` quando a
   * original foi apagada depois (a referencia vira "mensagem apagada", nao
   * some). So o resumo viaja — a original inteira ja esta (ou estara) na lista.
   */
  replyTo: MessageReplyTo | null;
}

export interface MessageReplyTo {
  id: string;
  autorNome: string;
  /** primeiras ~120 chars do conteudo, ou "" se era so anexo */
  trecho: string;
  apagada: boolean;
}

/**
 * Formato cru vindo do banco. Declarado aqui — sem importar Prisma — para que
 * o app web e o gateway produzam PublicMessage pela MESMA funcao.
 */
export interface MessageRow {
  id: string;
  /** Preenchido quando a mensagem e de canal de servidor. */
  channelId: string | null;
  /** Preenchido quando a mensagem e de conversa direta. */
  dmChannelId: string | null;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  /** Cru do banco: uma linha por pessoa por emoji. O agrupamento e aqui. */
  reactions?: Array<{ emoji: string; userId: string }>;
  /** Cru do banco. A URL publica e montada em `toPublicMessage`. */
  anexos?: Array<{
    id: string;
    nome: string;
    mime: string;
    tamanho: number;
    chave: string;
    largura: number | null;
    altura: number | null;
  }>;
  /**
   * O autor no formato cru compartilhado — inclusive a assinatura, para a
   * mensagem no chat carregar o selo do plano junto com o nome.
   */
  author: UserRow;
  /**
   * A mensagem respondida, crua do banco. `null` quando `replyToId` e nulo.
   * `deletedAt` vem junto: o soft-delete nao apaga a linha, e a referencia
   * precisa saber se deve mostrar "mensagem apagada".
   */
  replyTo?: {
    id: string;
    content: string;
    deletedAt: Date | null;
    author: { displayName: string };
  } | null;
}

/**
 * Agrupa as linhas cruas em `{ emoji, count, mine }`.
 *
 * A ORDEM E ESTAVEL — primeiro emoji a aparecer fica na frente — porque a
 * alternativa (ordenar por contagem) faria os botoes SALTAREM de lugar quando
 * alguem reage: a pessoa mira num, e ele troca de posicao no clique.
 */
function agruparReacoes(
  linhas: Array<{ emoji: string; userId: string }>,
  selfUserId: string | null,
): PublicReaction[] {
  const porEmoji = new Map<string, PublicReaction>();
  for (const linha of linhas) {
    const atual = porEmoji.get(linha.emoji);
    if (atual) {
      atual.count += 1;
      if (linha.userId === selfUserId) atual.mine = true;
    } else {
      porEmoji.set(linha.emoji, {
        emoji: linha.emoji,
        count: 1,
        mine: linha.userId === selfUserId,
      });
    }
  }
  return [...porEmoji.values()];
}

/**
 * `selfUserId` decide o `mine` de cada reacao. Opcional porque nem todo
 * chamador tem quem esta olhando — sem ele, nada fica aceso, que e o padrao
 * seguro: pintar de aceso o que nao e seu seria mentira; deixar apagado o que
 * e seu so custa um clique a mais.
 */
export function toPublicMessage(
  row: MessageRow,
  selfUserId: string | null = null,
  /**
   * A base publica do armazenamento. Chega por parametro, e nao lida de
   * `process.env` aqui dentro, porque este arquivo roda nos DOIS lados: no
   * gateway ha variavel de ambiente, no navegador nao. Lendo `process.env`
   * direto, a URL sairia vazia no cliente e o anexo apareceria quebrado sem
   * ninguem entender por que.
   */
  baseDeArquivos = "",
): PublicMessage {
  /**
   * Exatamente um dos dois esta preenchido — garantido pelo CHECK
   * `Message_um_pai_so` no banco. Se algum dia os dois vierem nulos, e melhor
   * quebrar alto aqui do que devolver `undefined` e virar chave invalida no
   * store do cliente, onde o sintoma seria "a mensagem sumiu".
   */
  const conversationId = row.channelId ?? row.dmChannelId;
  if (conversationId === null) {
    throw new Error(`Mensagem ${row.id} sem canal nem conversa`);
  }

  return {
    id: row.id,
    conversationId,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    reactions: agruparReacoes(row.reactions ?? [], selfUserId),
    anexos: (row.anexos ?? []).map((a) => ({
      id: a.id,
      nome: a.nome,
      mime: a.mime,
      tamanho: a.tamanho,
      url: `${baseDeArquivos.replace(/\/+$/, "")}/${a.chave}`,
      largura: a.largura,
      altura: a.altura,
    })),
    author: toPublicUser(row.author),
    replyTo: row.replyTo ? resumirResposta(row.replyTo) : null,
  };
}

const TRECHO_MAX = 120;

/**
 * O trecho que uma referencia de resposta mostra. Exportado porque o cliente
 * refaz o trecho quando a original e editada — a mesma regra, nao uma copia.
 */
export function trechoDeResposta(content: string): string {
  const bruto = content.replace(/\s+/g, " ").trim();
  return bruto.length > TRECHO_MAX ? `${bruto.slice(0, TRECHO_MAX)}…` : bruto;
}

function resumirResposta(
  r: NonNullable<MessageRow["replyTo"]>,
): MessageReplyTo {
  const apagada = r.deletedAt !== null;
  return {
    id: r.id,
    autorNome: r.author.displayName,
    trecho: apagada ? "" : trechoDeResposta(r.content),
    apagada,
  };
}

/**
 * Uma amizade do ponto de vista de QUEM esta olhando.
 *
 * O banco guarda `requesterId`/`addresseeId`, que sao sobre quem pediu. A tela
 * nunca quer isso: quer "a outra pessoa" e "de que lado esta a decisao". A
 * traducao acontece no servidor, uma vez, em vez de cada componente refazer o
 * mesmo `meuId === requesterId ? ... : ...` e um deles errar.
 */
export interface PublicFriendship {
  id: string;
  /** a outra ponta — nunca voce */
  user: PublicUser;
  /**
   * `friend` ja aceito; `incoming` alguem te pediu e a decisao e sua;
   * `outgoing` voce pediu e esta esperando; `blocked` voce bloqueou.
   *
   * `blocked` entra AQUI em vez de virar uma lista propria porque a tela ja
   * sabe desenhar uma pessoa a partir desta forma — nome, avatar, acoes. Uma
   * segunda forma seria uma segunda copia da linha, do agrupamento e da busca.
   */
  kind: "friend" | "incoming" | "outgoing" | "blocked";
  createdAt: string;
}

/** Estado da relacao entre quem olha e a pessoa do cartao de perfil. */
export type RelacaoComUsuario =
  | "eu"
  | "nenhuma"
  | "amigos"
  | "pedido-enviado"
  | "pedido-recebido"
  | "bloqueado"
  | "bloqueou-voce";

/**
 * O que o cartao de perfil precisa ALEM do `PublicUser` (que ele ja tem da
 * mensagem). Buscado sob demanda quando o cartao abre — nao viaja em toda
 * mensagem.
 */
export interface PerfilParaCartao {
  bio: string | null;
  /**
   * O BANNER de perfil equipado, ja RESOLVIDO (contra plano e `ativo`) — a URL,
   * ou `null`. So o cartao usa, entao busca aqui em vez de viajar no
   * `PublicUser`. A decoracao de avatar, ao contrario, esta no `PublicUser`
   * porque aparece em todo lugar.
   */
  banner: string | null;
  /** apelido no servidor atual; `null` em DM ou sem apelido */
  nickname: string | null;
  /** cargos no servidor atual, ja ordenados; `[]` em DM ou sem cargo com cor */
  roles: PublicRole[];
  relacao: RelacaoComUsuario;
  /** id da amizade — para aceitar/recusar um `pedido-recebido`; `null` senao */
  friendshipId: string | null;
}
