import {
  quebrarEmMencoes,
  SEM_MENCOES,
  type MencoesDaMensagem,
} from "@aether/shared";
import { TextoComEmoji } from "@/components/ui/emoji";
import { quebrarEmLink, temLink } from "@/lib/links";

/**
 * O corpo de uma mensagem: emoji vira Twemoji (`TextoComEmoji`), link vira
 * `<a>` clicavel. Continua TEXTO — sem `dangerouslySetInnerHTML`; o `href` so
 * aceita o que `quebrarEmLink` reconheceu, que e so `http(s)://`, entao colar
 * `javascript:...` numa mensagem nunca vira um link executavel.
 *
 * Sem preview rico (titulo/miniatura) de proposito — buscar metadado de uma
 * URL que qualquer um cola é abrir a porta pra SSRF; fica pra quando tiver
 * uma fila/whitelist pensada pra isso.
 *
 * Mencoes (P1-2): o texto guarda marcadores (`<@id>`, `<@&id>`); aqui eles
 * viram "@Nome" com o nome que veio em `mencoes`. Marcador sem nome conhecido
 * (pessoa que nao valeu como mencao) aparece neutro, sem revelar quem e.
 */
export function TextoDeMensagem({
  texto,
  mencoes = SEM_MENCOES,
}: {
  texto: string;
  mencoes?: MencoesDaMensagem;
}) {
  const pedacos = quebrarEmMencoes(texto);
  if (pedacos.length === 1 && pedacos[0]!.tipo === "texto") {
    return <TextoComLinks texto={texto} />;
  }

  const usuarios = new Map(mencoes.usuarios.map((u) => [u.id, u.nome]));
  const cargos = new Map(mencoes.cargos.map((c) => [c.id, c]));

  return (
    <>
      {pedacos.map((p, i) => {
        if (p.tipo === "texto") return <TextoComLinks key={i} texto={p.valor} />;
        if (p.tipo === "usuario") {
          const nome = usuarios.get(p.id);
          return (
            <Mencao key={i} valida={nome !== undefined}>
              @{nome ?? "alguém"}
            </Mencao>
          );
        }
        if (p.tipo === "cargo") {
          const cargo = cargos.get(p.id);
          return (
            <Mencao key={i} valida={cargo !== undefined} cor={cargo?.cor ?? null}>
              @{cargo?.nome ?? "cargo"}
            </Mencao>
          );
        }
        // `@everyone` so ganha destaque se valeu (autor com permissao).
        return mencoes.todos ? (
          <Mencao key={i} valida>
            @everyone
          </Mencao>
        ) : (
          <TextoComLinks key={i} texto="@everyone" />
        );
      })}
    </>
  );
}

function Mencao({
  valida,
  cor = null,
  children,
}: {
  valida: boolean;
  cor?: string | null;
  children: React.ReactNode;
}) {
  if (!valida) return <span className="text-ink-400">{children}</span>;
  return (
    <span
      className="rounded px-0.5 font-medium text-accent-200 bg-accent-500/18"
      style={cor ? { color: cor, backgroundColor: `${cor}2e` } : undefined}
    >
      {children}
    </span>
  );
}

function TextoComLinks({ texto }: { texto: string }) {
  if (!temLink(texto)) return <TextoComEmoji texto={texto} />;
  return (
    <>
      {quebrarEmLink(texto).map((pedaco, i) =>
        pedaco.tipo === "link" ? (
          <a
            key={i}
            href={pedaco.valor}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent-300 underline decoration-accent-300/40 underline-offset-2 hover:text-accent-200"
          >
            {pedaco.valor}
          </a>
        ) : (
          <TextoComEmoji key={i} texto={pedaco.valor} />
        ),
      )}
    </>
  );
}
