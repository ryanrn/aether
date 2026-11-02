import { z } from "zod";
import { COSMETIC_TYPES, ehRaridade } from "./cosmeticos";
import { Permission, type PermissionKey } from "./permissions";

/**
 * Schemas Zod usados nos dois lados. O servidor SEMPRE revalida —
 * a validacao no cliente e apenas conveniencia de UX.
 */

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Usuario precisa de ao menos 3 caracteres")
  .max(24, "Usuario pode ter no maximo 24 caracteres")
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    "Use apenas letras, numeros, ponto, hifen ou underline",
  );

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Nome de exibicao obrigatorio")
  .max(32, "Nome de exibicao pode ter no maximo 32 caracteres");

/** Developer Platform: nome e descricao de uma `Application`. */
export const appNameSchema = z
  .string()
  .trim()
  .min(1, "Nome do aplicativo obrigatorio")
  .max(48, "Nome pode ter no maximo 48 caracteres");

export const appDescricaoSchema = z
  .string()
  .trim()
  .max(400, "Descricao pode ter no maximo 400 caracteres");

/**
 * Bio do perfil global. Curta de proposito — e um cartao, nao uma pagina. Vazia
 * APAGA (volta a nulo), entao string vazia e valida. Quebra de linha passa;
 * o cartao respeita com `whitespace-pre-wrap`.
 */
export const bioSchema = z
  .string()
  .trim()
  .max(190, "A bio pode ter no maximo 190 caracteres");

/**
 * Apelido por servidor. Vazio APAGA o apelido (volta ao nome de exibicao) —
 * por isso a string vazia e valida aqui, diferente do displayName.
 */
export const nicknameSchema = z
  .string()
  .trim()
  .max(32, "Apelido pode ter no maximo 32 caracteres");

export const setNicknameSchema = z.object({
  memberId: z.string().min(1),
  nickname: nicknameSchema,
});

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("E-mail invalido")
  .max(160);

export const passwordSchema = z
  .string()
  .min(8, "Senha precisa de ao menos 8 caracteres")
  .max(200, "Senha longa demais");

export const registerSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  /** aceita username ou e-mail */
  identifier: z.string().trim().min(3, "Informe usuario ou e-mail").max(160),
  password: z.string().min(1, "Informe a senha"),
});

export const serverNameSchema = z
  .string()
  .trim()
  .min(2, "Nome do servidor precisa de ao menos 2 caracteres")
  .max(48, "Nome do servidor pode ter no maximo 48 caracteres");

export const createServerSchema = z.object({
  name: serverNameSchema,
});

export const updateServerSchema = z.object({
  serverId: z.string().min(1),
  name: serverNameSchema,
});

/**
 * Icone do servidor. Os mesmos valores configuram o bucket no Supabase
 * Storage (limite e mime type recusados na origem) e a validacao aqui —
 * duas cópias da regra divergem, entao os dois lados leem esta constante.
 */
export const SERVER_ICON_MAX_BYTES = 2 * 1024 * 1024;
export const SERVER_ICON_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export type ServerIconMimeType = (typeof SERVER_ICON_MIME_TYPES)[number];

/**
 * Foto de perfil. SEPARADA do icone de servidor porque as duas regras
 * divergiram: o avatar aceita GIF e chega a 10 MB, o icone nao.
 *
 * Antes as duas liam `SERVER_ICON_*`. Continuar assim significaria ou negar
 * GIF ao avatar, ou passar a aceitar GIF de 10 MB como icone de servidor —
 * que ninguem pediu e multiplica por cinco o peso da barra lateral.
 */
export const AVATAR_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export type AvatarMimeType = (typeof AVATAR_MIME_TYPES)[number];

/** Imagem parada: o mesmo teto de sempre. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/**
 * GIF animado: 10 MB.
 *
 * Mais alto porque um GIF carrega todos os quadros descomprimidos entre si —
 * 2 MB reprovaria quase toda animacao de verdade e o recurso nasceria inutil.
 * E limitado porque o arquivo e servido a CADA pessoa que abre uma lista de
 * membros: um avatar de 50 MB seria pago em banda por quem apenas passa os
 * olhos numa conversa.
 */
export const AVATAR_ANIMADO_MAX_BYTES = 10 * 1024 * 1024;

/** O teto que vale para este tipo. Um lugar so, para os dois lados lerem. */
export function limiteDoAvatar(mime: string): number {
  return mime === "image/gif" ? AVATAR_ANIMADO_MAX_BYTES : AVATAR_MAX_BYTES;
}

/** O maior teto possivel — o que o bucket precisa aceitar na origem. */
export const AVATAR_LIMITE_DO_BUCKET = AVATAR_ANIMADO_MAX_BYTES;

/**
 * Asset de cosmetico (decoracao de avatar ou banner de perfil) — enviado pela
 * equipe no painel, arquivo pequeno que vai direto do servidor para o R2.
 *
 * SO PNG E WEBP no v1. SVG fica de fora pelo mesmo motivo de sempre — e XML e
 * aceita `<script>` —, e o resto (JPEG) nao guarda transparencia, que e o
 * ponto de uma decoracao. Animado passa (WEBP com movimento), so a miniatura
 * congela no primeiro quadro.
 *
 * O teto de 4 MB e o corpo de uma Server Action da Vercel (4,5 MB): o upload
 * passa pelo servidor de proposito, porque ele precisa dos bytes para medir a
 * dimensao e gerar a miniatura.
 *
 * As regras de DIMENSAO variam por tipo (decoracao e quase quadrada, banner e
 * 3:1) — ver `COSMETIC_REGRAS` em `./cosmeticos`.
 */
export const COSMETIC_MIME_TYPES = ["image/png", "image/webp"] as const;
export type CosmeticMimeType = (typeof COSMETIC_MIME_TYPES)[number];
export const COSMETIC_ASSET_MAX_BYTES = 4 * 1024 * 1024;

/**
 * O slug de um cosmetico — o identificador estavel que o app referencia.
 * Minusculas, numeros e hifen; sem hifen nas pontas. Curto e previsivel para
 * virar parte do caminho no bucket sem escape.
 */
export const cosmeticSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "O slug precisa de ao menos 2 caracteres")
  .max(48, "O slug pode ter no maximo 48 caracteres")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use apenas letras minusculas, numeros e hifen (sem hifen nas pontas)",
  );

/**
 * Os METADADOS de um cosmetico, vindos do formulario do painel. O arquivo
 * (asset) e tratado a parte — chega como `File` no FormData da action, nao
 * aqui.
 *
 * `ativo` NAO entra: todo cosmetico nasce rascunho, e a publicacao e um passo
 * proprio (ver `definirCosmeticoAtivo`). Assim ninguem publica sem antes ver o
 * preview.
 */
const precoMoedasSchema = z.preprocess(
  (v) => (v === "" || v == null ? null : v),
  z.union([
    z.null(),
    z.coerce
      .number()
      .int("O preco precisa ser um numero inteiro")
      .min(0, "O preco nao pode ser negativo")
      .max(1_000_000, "Preco alto demais"),
  ]),
);

export const cosmeticoMetaSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "De um nome ao cosmetico")
    .max(60, "O nome pode ter no maximo 60 caracteres"),
  descricao: z
    .string()
    .trim()
    .max(240, "A descricao pode ter no maximo 240 caracteres")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  tipo: z.enum(COSMETIC_TYPES, {
    errorMap: () => ({ message: "Tipo de cosmetico invalido" }),
  }),
  slug: cosmeticSlugSchema,
  raridade: z
    .string()
    .trim()
    .toLowerCase()
    .refine(ehRaridade, "Raridade invalida"),
  precoMoedas: precoMoedasSchema,
  tierMinimo: z.enum(["FREE", "PLUS", "PRO"], {
    errorMap: () => ({ message: "Plano minimo invalido" }),
  }),
  ordem: z.coerce.number().int().min(0).max(9999).catch(0),
  /** vazio = sem colecao */
  colecaoId: z
    .string()
    .trim()
    .max(64)
    .nullish()
    .transform((v) => (v ? v : null)),
});

export type CosmeticoMeta = z.infer<typeof cosmeticoMetaSchema>;

/** Data opcional do formulario: vazio = sem limite. */
const dataOpcionalSchema = z
  .union([z.literal(""), z.null(), z.undefined(), z.coerce.date()])
  .transform((v) => (v instanceof Date ? v : null))
  .refine((v) => v === null || !Number.isNaN(v.getTime()), "Data invalida");

export const colecaoMetaSchema = z
  .object({
    nome: z
      .string()
      .trim()
      .min(1, "De um nome a colecao")
      .max(60, "O nome pode ter no maximo 60 caracteres"),
    slug: cosmeticSlugSchema,
    descricao: z
      .string()
      .trim()
      .max(240, "A descricao pode ter no maximo 240 caracteres")
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    inicioEm: dataOpcionalSchema,
    fimEm: dataOpcionalSchema,
    destaque: z.boolean().catch(false),
    ativa: z.boolean().catch(false),
    ordem: z.coerce.number().int().min(0).max(9999).catch(0),
  })
  .refine((c) => !c.inicioEm || !c.fimEm || c.fimEm > c.inicioEm, {
    message: "O fim precisa ser depois do inicio",
    path: ["fimEm"],
  });

export type ColecaoMeta = z.infer<typeof colecaoMetaSchema>;

/** Acha uma marca ASCII nos primeiros bytes. Limitado para nao varrer 10 MB. */
function contemMarca(bytes: Uint8Array, marca: string, ate = 4096): boolean {
  const alvo = [...marca].map((c) => c.charCodeAt(0));
  const fim = Math.min(bytes.length, ate) - alvo.length;
  for (let i = 0; i <= fim; i += 1) {
    let bate = true;
    for (let j = 0; j < alvo.length; j += 1) {
      if (bytes[i + j] !== alvo[j]) {
        bate = false;
        break;
      }
    }
    if (bate) return true;
  }
  return false;
}

/**
 * A imagem TEM MOVIMENTO?
 *
 * Decidido pelos BYTES, e nunca pela extensao ou pelo `Content-Type` que o
 * navegador declarou — e o mesmo principio do sniff de tipo. Travar so o GIF
 * deixaria o buraco obvio: WEBP e PNG tambem animam, e quem nao paga subiria
 * um WEBP animado como avatar contornando a regra inteira. O sintoma seria
 * "o premium nao vale nada", sem erro nenhum.
 *
 * - GIF conta como animado SEMPRE, inclusive de um quadro so. Contar quadros
 *   exigiria percorrer os blocos do arquivo, e um parser errado aqui erra
 *   para o lado de liberar. Quem quer imagem parada tem PNG, JPEG e WEBP.
 * - WEBP anima pela flag ANIM do bloco VP8X — o bit 0x02 do byte de flags.
 *   Sem VP8X nao ha animacao possivel.
 * - PNG anima no formato APNG, que se declara pelo bloco `acTL` antes do
 *   primeiro `IDAT`.
 *
 * MORA AQUI, e nao so em `apps/web/src/server/storage.ts`, porque o cliente
 * PRECISA da mesma resposta: o recorte de zoom da foto (`avatar-cropper.tsx`)
 * teria que pular avatar animado, ou a animacao morreria no primeiro quadro
 * ao passar pelo canvas. Duas implementacoes divergiriam exatamente como as
 * normalizacoes de nome de jogo do servidor e do desktop — o mesmo bug, outro
 * lugar.
 */
export function ehImagemAnimada(bytes: Uint8Array, mime: string): boolean {
  if (mime === "image/gif") return true;
  if (mime === "image/webp") {
    const temVP8X =
      bytes.length >= 21 &&
      bytes[12] === 0x56 &&
      bytes[13] === 0x50 &&
      bytes[14] === 0x38 &&
      bytes[15] === 0x58;
    return temVP8X && (bytes[20]! & 0x02) !== 0;
  }
  if (mime === "image/png") return contemMarca(bytes, "acTL");
  return false;
}

export const inviteCodeSchema = z
  .string()
  .trim()
  .min(6, "Codigo de convite invalido")
  .max(24, "Codigo de convite invalido")
  .regex(/^[a-zA-Z0-9]+$/, "Codigo de convite invalido");

export const joinServerSchema = z.object({
  code: inviteCodeSchema,
});

export const messageContentSchema = z
  .string()
  .trim()
  .min(1, "Mensagem vazia")
  .max(4000, "Mensagem longa demais");

// ---------------------------------------------------------------------------
// FASE 2 — canais, categorias, cargos
// ---------------------------------------------------------------------------

export const channelNameSchema = z
  .string()
  .trim()
  .min(1, "Nome do canal obrigatorio")
  .max(40, "Nome do canal pode ter no maximo 40 caracteres");

export const channelTopicSchema = z
  .string()
  .trim()
  .max(200, "Topico pode ter no maximo 200 caracteres");

export const channelTypeSchema = z.enum(["TEXT", "VOICE"], {
  errorMap: () => ({ message: "Tipo de canal invalido" }),
});

export const categoryNameSchema = z
  .string()
  .trim()
  .min(1, "Nome da categoria obrigatorio")
  .max(40, "Nome da categoria pode ter no maximo 40 caracteres");

/** Limite de usuarios em canal de voz. Vazio = ilimitado. */
export const userLimitSchema = z
  .union([z.coerce.number().int().min(1).max(99), z.literal("")])
  .transform((value) => (value === "" ? null : value))
  .nullable();

export const createChannelSchema = z.object({
  serverId: z.string().min(1),
  name: channelNameSchema,
  type: channelTypeSchema,
  categoryId: z.string().min(1).nullable(),
  isPrivate: z.boolean(),
  isTemporary: z.boolean(),
  userLimit: userLimitSchema,
  /** cargos liberados quando o canal e privado */
  allowedRoleIds: z.array(z.string().min(1)).default([]),
});

export const updateChannelSchema = z.object({
  channelId: z.string().min(1),
  name: channelNameSchema,
  topic: channelTopicSchema.nullable(),
  categoryId: z.string().min(1).nullable(),
  isPrivate: z.boolean(),
  isTemporary: z.boolean(),
  userLimit: userLimitSchema,
});

export const createCategorySchema = z.object({
  serverId: z.string().min(1),
  name: categoryNameSchema,
});

/** Criar uma sala de grupo (LFG) para um jogo (fase 2, estagio 3). */
export const criarSalaDeGrupoSchema = z.object({
  serverId: z.string().min(1),
  jogo: z.string().trim().min(2, "Nome muito curto").max(64, "Nome muito longo"),
});

export const definirSalasDeGrupoSchema = z.object({
  serverId: z.string().min(1),
  ligado: z.boolean(),
});

export const renameCategorySchema = z.object({
  categoryId: z.string().min(1),
  name: categoryNameSchema,
});

export const roleNameSchema = z
  .string()
  .trim()
  .min(1, "Nome do cargo obrigatorio")
  .max(32, "Nome do cargo pode ter no maximo 32 caracteres");

export const roleColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Cor precisa estar no formato #RRGGBB");

const PERMISSION_KEYS = Object.keys(Permission) as [
  PermissionKey,
  ...PermissionKey[],
];

/** Lista de permissoes vinda de um formulario (checkboxes). */
export const permissionKeysSchema = z.array(z.enum(PERMISSION_KEYS));

export const createRoleSchema = z.object({
  serverId: z.string().min(1),
  name: roleNameSchema,
  color: roleColorSchema,
});

export const updateRoleSchema = z.object({
  roleId: z.string().min(1),
  name: roleNameSchema,
  color: roleColorSchema,
  permissions: permissionKeysSchema,
  /**
   * Jogo a vincular ao cargo (fase 2, estagio 2). Ausente = telas antigas que
   * nao mexem no vinculo; string vazia = desvincula; string = vincula.
   * `updateRole` normaliza e clampa as permissoes.
   */
  jogoVinculado: z.string().trim().max(64).optional(),
});

export const definirCargoPorJogoSchema = z.object({
  serverId: z.string().min(1),
  ligado: z.boolean(),
});

export const assignRoleSchema = z.object({
  memberId: z.string().min(1),
  roleId: z.string().min(1),
});

/** Overwrite de canal: quem pode ver/entrar num canal privado. */
export const channelAccessSchema = z.object({
  channelId: z.string().min(1),
  roleIds: z.array(z.string().min(1)),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateServerInput = z.infer<typeof createServerSchema>;
export type JoinServerInput = z.infer<typeof joinServerSchema>;
export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

// ---------------------------------------------------------------------------
// FASE 6 — moderacao
// ---------------------------------------------------------------------------

/**
 * Duracoes oferecidas para banimento. Lista fechada em vez de campo livre:
 * o valor vira `expiresAt` no banco, e aceitar numero arbitrario do cliente
 * abriria espaco para banimento de mil anos por acidente de digitacao.
 */
export const BAN_DURATIONS = [
  { id: "permanent", label: "Permanente", hours: null },
  { id: "1d", label: "1 dia", hours: 24 },
  { id: "7d", label: "7 dias", hours: 24 * 7 },
  { id: "30d", label: "30 dias", hours: 24 * 30 },
] as const;

export type BanDurationId = (typeof BAN_DURATIONS)[number]["id"];

export const banDurationSchema = z.enum([
  "permanent",
  "1d",
  "7d",
  "30d",
]);

/** Motivo e opcional, mas quando existe fica no log de auditoria. */
export const moderationReasonSchema = z
  .string()
  .trim()
  .max(500, "Motivo longo demais")
  .optional();

export const kickMemberSchema = z.object({
  memberId: z.string().min(1),
  reason: moderationReasonSchema,
});

export const banMemberSchema = z.object({
  memberId: z.string().min(1),
  reason: moderationReasonSchema,
  duration: banDurationSchema,
});

export const unbanSchema = z.object({
  userId: z.string().min(1),
});

/**
 * Senha para CONFIRMAR uma acao ja autenticada (transferir posse, excluir
 * servidor) — nao para CRIAR uma senha nova. Por isso so exige "preenchida",
 * sem o minimo de 8 caracteres do `passwordSchema`: uma conta antiga com
 * senha curta, criada antes da regra existir, nao pode ficar trancada fora
 * da propria confirmacao.
 */
export const confirmPasswordSchema = z
  .string()
  .min(1, "Informe sua senha para confirmar");

export const transferOwnershipSchema = z.object({
  serverId: z.string().min(1),
  targetMemberId: z.string().min(1),
  password: confirmPasswordSchema,
});

export const deleteServerSchema = z.object({
  serverId: z.string().min(1),
  password: confirmPasswordSchema,
});

/** Converte a duracao escolhida na data de vencimento. `null` = permanente. */
export function banExpiryFrom(duration: BanDurationId): Date | null {
  const found = BAN_DURATIONS.find((option) => option.id === duration);
  if (!found || found.hours === null) return null;
  return new Date(Date.now() + found.hours * 60 * 60 * 1000);
}

/**
 * Um emoji, e nao um texto qualquer.
 *
 * O valor chega do CLIENTE — o seletor manda o caractere escolhido — e sem
 * checagem o campo viraria deposito de texto: "reagir" com um paragrafo
 * inteiro, ou com HTML, e ele apareceria na tela de todo mundo junto da
 * mensagem.
 *
 * A checagem e por PROPRIEDADE Unicode (`\p{Extended_Pictographic}`), e nao
 * por lista de emojis conhecidos. Lista envelhece: emoji novo entra no padrao
 * todo ano, e uma lista nossa recusaria os novos ate alguem lembrar de
 * atualiza-la. A propriedade acompanha o Unicode sozinha.
 *
 * O teto de 32 caracteres existe porque emoji composto e longo de verdade —
 * familia com tom de pele passa de 20 unidades, juntando ZWJ e seletores de
 * variacao. Abaixo disso cortaria emoji legitimo; muito acima, deixaria passar
 * uma sequencia inventada com dezenas de junções.
 *
 * O mesmo teto esta no CHECK do banco, de proposito: este validador cobre o
 * caminho normal de escrita, e o CHECK cobre qualquer outro que apareca.
 */
export const emojiSchema = z
  .string()
  .min(1, "Escolha um emoji")
  .max(32, "Emoji invalido")
  .refine(
    (valor) =>
      /\p{Extended_Pictographic}/u.test(valor) &&
      // So pictograma, junção e seletor — nada de letra, numero ou pontuacao
      // no meio, que e como se disfarçaria texto de emoji.
      !/[\p{L}\p{N}\p{P}\p{Z}]/u.test(valor),
    "Isso nao e um emoji",
  );
