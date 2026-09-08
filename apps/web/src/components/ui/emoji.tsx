"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { quebrarEmEmoji, temEmoji, urlTwemoji } from "@/lib/emoji/twemoji";

/**
 * Um emoji desenhado como Twemoji — `<img>` do SVG servido de `/twemoji/`.
 *
 * Cai no proprio caractere se o SVG nao existir (emoji novo demais para o
 * pacote, nome fora da regra): melhor um emoji do sistema do que um quadrado.
 * O tamanho acompanha a fonte (`1.3em`), entao escala junto com o chat.
 */
export function Emoji({
  char,
  className,
}: {
  char: string;
  className?: string;
}) {
  const [falhou, setFalhou] = useState(false);
  if (falhou) return <span className={className}>{char}</span>;
  return (
    <img
      src={urlTwemoji(char)}
      alt={char}
      draggable={false}
      loading="lazy"
      onError={() => setFalhou(true)}
      className={cn("emoji-tw", className)}
    />
  );
}

/**
 * Texto com os emojis trocados por Twemoji. Se nao ha emoji nenhum, devolve a
 * string crua — sem alocar array nem componente a toa (o caso comum).
 */
export function TextoComEmoji({
  texto,
  className,
}: {
  texto: string;
  className?: string;
}) {
  if (!temEmoji(texto)) return <>{texto}</>;
  return (
    <>
      {quebrarEmEmoji(texto).map((pedaco, i) =>
        pedaco.tipo === "emoji" ? (
          <Emoji key={i} char={pedaco.valor} className={className} />
        ) : (
          <span key={i}>{pedaco.valor}</span>
        ),
      )}
    </>
  );
}
