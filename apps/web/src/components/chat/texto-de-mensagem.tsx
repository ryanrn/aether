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
 */
export function TextoDeMensagem({ texto }: { texto: string }) {
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
