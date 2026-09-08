"use client";

/**
 * Quando o conteudo de uma mensagem E, sozinho, uma URL de midia confiavel
 * (hoje: GIF/MP4 do Tenor, enviado pelo botao GIF), a mensagem desenha a midia
 * em vez do texto. E o embed minimo — sem tabela de embeds, sem schema novo.
 *
 * A lista de hosts confiaveis casa com o `img-src`/`media-src` da CSP: so o que
 * o navegador consegue carregar entra aqui, e nada mais vira `<img>`.
 */

const HOSTS_CONFIAVEIS = /^https:\/\/media\.tenor\.com\//;
const EXT = /\.(gif|mp4|webp)(\?|$)/i;

export function ehMidiaEmbutivel(conteudo: string): string | null {
  const t = conteudo.trim();
  if (/\s/.test(t)) return null;
  if (!HOSTS_CONFIAVEIS.test(t) || !EXT.test(t)) return null;
  try {
    const u = new URL(t);
    return u.protocol === "https:" ? t : null;
  } catch {
    return null;
  }
}

export function MidiaEmbutida({ url }: { url: string }) {
  const ehVideo = /\.mp4(\?|$)/i.test(url);
  return (
    <div className="mt-0.5 max-w-[min(420px,80%)] overflow-hidden rounded-lg border border-line bg-base-950">
      {ehVideo ? (
        <video
          src={url}
          autoPlay
          loop
          muted
          playsInline
          className="block h-auto w-full"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="GIF" loading="lazy" className="block h-auto w-full" />
      )}
    </div>
  );
}
