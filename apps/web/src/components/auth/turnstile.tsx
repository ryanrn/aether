"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Widget do Cloudflare Turnstile (CAPTCHA).
 *
 * Renderiza EXPLICITAMENTE (`window.turnstile.render`) num `<div>` proprio e
 * escreve o token num `<input type="hidden" name="turnstileToken">` — o
 * `registerAction` le esse campo do FormData e chama `verificarTurnstile`.
 *
 * Sem `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (dev, ou producao antes de configurar),
 * NAO renderiza nada e nao carrega script nenhum. O servidor, sem
 * `TURNSTILE_SECRET_KEY`, pula a verificacao — os dois lados degradam juntos.
 */

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
      theme?: "auto" | "light" | "dark";
    },
  ) => string;
  reset: (id?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromessa: Promise<void> | null = null;

function carregarScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromessa) return scriptPromessa;
  scriptPromessa = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("turnstile: script não carregou"));
    document.head.appendChild(s);
  });
  return scriptPromessa;
}

export function Turnstile() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const container = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState("");
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (!siteKey || !container.current) return;
    let widgetId: string | undefined;
    let vivo = true;

    carregarScript()
      .then(() => {
        if (!vivo || !container.current || !window.turnstile) return;
        widgetId = window.turnstile.render(container.current, {
          sitekey: siteKey,
          theme: "dark",
          callback: (t) => setToken(t),
          "error-callback": () => setErro(true),
          "expired-callback": () => setToken(""),
        });
      })
      .catch(() => setErro(true));

    return () => {
      vivo = false;
      if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
    };
  }, [siteKey]);

  if (!siteKey) return null;

  return (
    <div>
      <input type="hidden" name="turnstileToken" value={token} />
      <div ref={container} />
      {erro ? (
        <p className="mt-1 text-[12px] text-signal-dnd">
          A verificação anti-robô não carregou. Recarregue a página.
        </p>
      ) : null}
    </div>
  );
}
