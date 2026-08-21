import { z } from "zod";
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

/** Converte a duracao escolhida na data de vencimento. `null` = permanente. */
export function banExpiryFrom(duration: BanDurationId): Date | null {
  const found = BAN_DURATIONS.find((option) => option.id === duration);
  if (!found || found.hours === null) return null;
  return new Date(Date.now() + found.hours * 60 * 60 * 1000);
}
