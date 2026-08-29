/**
 * O dicionario: palavra digitada na live -> acao dentro do jogo.
 *
 * ESTE e o unico lugar que le texto de espectador. O Roblox recebe `kind` ja
 * decidido e nunca faz `if comentario == "pular"`. Duas copias da tabela de
 * palavras divergiriam na primeira vez que alguem quisesse aceitar "pula" alem
 * de "pular", e a divergencia so apareceria ao vivo.
 */
import type { ActionSource, RawEvent } from "./types.ts";

export interface CommandRule {
  kind: string;
  /** Ja normalizadas: minusculas, sem acento. */
  keywords: string[];
  /** `rest` guarda o que veio depois da palavra em `params.arg`. */
  arg?: "none" | "rest";
  /** Intervalo minimo entre dois usos DA MESMA pessoa. */
  cooldownMs?: number;
}

/**
 * Perfil "default", em portugues com apelidos em ingles. Para adicionar um
 * comando: uma linha aqui + um handler em `Actions.luau`. Se so um dos dois
 * existir, nada quebra — a ponte enfileira e o jogo ignora com log, ou a
 * palavra simplesmente nao casa.
 */
const DEFAULT_RULES: CommandRule[] = [
  { kind: "spawn", keywords: ["entrar", "eu", "join", "spawn", "aparecer", "vim"] },
  { kind: "jump", keywords: ["pular", "pula", "jump", "salto"], cooldownMs: 1_500 },
  { kind: "bomb", keywords: ["bomba", "boom", "explodir", "bomb"], cooldownMs: 6_000 },
  { kind: "sphere", keywords: ["bola", "esfera", "ball", "bolinha"], cooldownMs: 4_000 },
  { kind: "rocket", keywords: ["foguete", "rocket", "voar", "fly", "subir"], cooldownMs: 8_000 },
  { kind: "dance", keywords: ["dancar", "danca", "dance", "dancinha"], cooldownMs: 5_000 },
  { kind: "sprint", keywords: ["correr", "corre", "run"], cooldownMs: 6_000 },
  { kind: "giant", keywords: ["gigante", "crescer", "big"], cooldownMs: 10_000 },
  { kind: "color", keywords: ["cor", "color", "pintar"], arg: "rest", cooldownMs: 3_000 },
  { kind: "despawn", keywords: ["sumir", "sair", "remover", "bye"], cooldownMs: 2_000 },
  /**
   * Vincular conta do Roblox. O `arg` e o nome de usuario; quem resolve para
   * userId e a ponte (`roblox-users.ts`), porque o HttpService do Roblox e
   * PROIBIDO de chamar dominios roblox.com — a requisicao falha sempre.
   */
  { kind: "link", keywords: ["roblox", "avatar", "vincular"], arg: "rest", cooldownMs: 15_000 },
];

const PROFILES: Record<string, CommandRule[]> = {
  default: DEFAULT_RULES,
};

/** Palavra -> regra, montado uma vez por perfil. */
const INDEX = new Map<string, Map<string, CommandRule>>();
for (const [profile, rules] of Object.entries(PROFILES)) {
  const index = new Map<string, CommandRule>();
  for (const rule of rules) {
    for (const keyword of rule.keywords) {
      if (index.has(keyword)) {
        throw new Error(`palavra "${keyword}" repetida no perfil "${profile}"`);
      }
      index.set(keyword, rule);
    }
  }
  INDEX.set(profile, index);
}

export function profileExists(profile: string): boolean {
  return INDEX.has(profile);
}

/** Lista de comandos, para o log de boas-vindas e para o README. */
export function describeProfile(profile: string): string[] {
  return (PROFILES[profile] ?? DEFAULT_RULES).map(
    (rule) => `${rule.kind}: ${rule.keywords.join(", ")}`,
  );
}

/**
 * Minuscula, sem acento, sem pontuacao de comando, sem espaco duplicado.
 *
 * `\p{M}` depois do NFD apaga o acento como marca combinante — sem isso,
 * "dancar" com e sem cedilha viram comandos diferentes e metade da live acha
 * que o sistema esta quebrado.
 */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/^[!/.]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Texto que vai aparecer na cabeca do boneco.
 *
 * `\p{C}` tira controle, largura zero e BOM; o segundo filtro guarda so letra,
 * numero, pontuacao e espaco — simbolo e emoji o Roblox desenha como
 * retangulo. O corte de tamanho existe porque BillboardGui com 200 caracteres
 * cobre o mapa inteiro.
 *
 * ISTO NAO E MODERACAO. Quem filtra palavrao e o `TextService:FilterStringAsync`
 * do lado do Roblox — exigido pelas regras da plataforma para qualquer texto de
 * terceiro exibido no jogo. Aqui so tiramos o que quebra o render.
 */
export function sanitizeText(text: string, max = 40): string {
  const clean = text
    .replace(/\p{C}/gu, "")
    .replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  // As reticencias contam para o limite: `max` e o tamanho final, nao o do corte.
  return clean.length > max ? `${clean.slice(0, Math.max(1, max - 3))}...` : clean;
}

export interface ParsedCommand {
  kind: string;
  keyword: string | null;
  params: Record<string, string | number | boolean>;
  rule: CommandRule | null;
}

/**
 * Decide o que um evento vira.
 *
 * `spawnOnAnyComment` transforma comentario solto em `spawn`: e o que faz o
 * ciclo de engajamento fechar sozinho — a pessoa comenta qualquer coisa, se ve
 * no jogo, comenta de novo. Sem isso so quem ja sabe a palavra participa.
 */
export function parseEvent(
  event: RawEvent,
  options: { profile: string; spawnOnAnyComment: boolean },
): ParsedCommand | null {
  if (event.source !== "chat") return parseNonChat(event);

  const normalized = normalize(event.text);
  if (normalized === "") return null;

  const index = INDEX.get(options.profile) ?? INDEX.get("default")!;
  const [first = "", ...rest] = normalized.split(" ");
  const rule = index.get(first);

  if (rule) {
    const params: Record<string, string | number | boolean> = {};
    if (rule.arg === "rest") {
      const arg = rest.join(" ").trim();
      if (arg === "") return null; // "cor" sozinho nao diz nada
      params.arg = sanitizeText(arg, 32);
    }
    params.text = sanitizeText(event.text);
    return { kind: rule.kind, keyword: first, params, rule };
  }

  if (!options.spawnOnAnyComment) return null;
  return {
    kind: "spawn",
    keyword: null,
    params: { text: sanitizeText(event.text) },
    rule: null,
  };
}

/** Like, presente, follow e share nao passam por dicionario: viram acao direto. */
function parseNonChat(event: RawEvent): ParsedCommand | null {
  const kindBySource: Partial<Record<ActionSource, string>> = {
    gift: "gift",
    like: "like",
    follow: "follow",
    share: "share",
  };
  const kind = kindBySource[event.source];
  if (!kind) return null;
  return { kind, keyword: null, params: { ...event.params }, rule: null };
}
