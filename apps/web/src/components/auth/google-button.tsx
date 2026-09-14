"use client";

import { useEffect, useState } from "react";
import { isDesktopApp } from "@/lib/voice/screen-share";
import { cn } from "@/lib/utils";

/**
 * "Continuar com Google" — link simples pra `/api/auth/google`, nao um
 * `fetch`: precisa ser uma NAVEGACAO de verdade pra o `will-navigate`/
 * `will-redirect` do Electron conseguir empurrar o 302 do Google pro
 * navegador do sistema (ver `apps/desktop/src/main.js`).
 *
 * `?desktop=1` so quando `window.aetherDesktop` existe — e o sinal que o
 * callback usa pra saber que precisa devolver a sessao via `aether://`, em
 * vez de so criar o cookie (que ai ficaria preso no navegador do sistema).
 * Comeca `false` e corrige no `useEffect` pra nao divergir do HTML do
 * servidor (mesmo padrao de `OpenInDesktop`).
 */
export function GoogleButton({ next = "" }: { next?: string }) {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => setDesktop(isDesktopApp()), []);

  const params = new URLSearchParams();
  if (next) params.set("next", next);
  if (desktop) params.set("desktop", "1");
  const query = params.toString();

  return (
    // Link de verdade, nao <Button> (que so renderiza <button>) — precisa
    // ser uma navegacao pro Electron interceptar o redirect (ver acima).
    // Classes copiadas do variant "secondary" + size "lg" de `ui/button.tsx`.
    <a
      href={`/api/auth/google${query ? `?${query}` : ""}`}
      className={cn(
        "inline-flex h-11 w-full items-center justify-center gap-2.5 whitespace-nowrap rounded-md px-5 text-sm transition-colors duration-150",
        "bg-base-700 font-medium text-ink-100 hover:bg-base-600 active:bg-base-700",
        "border border-line-strong/50 hover:border-line-strong/60",
      )}
    >
      <GoogleLogo />
      Continuar com Google
    </a>
  );
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 18 18" className="h-[18px] w-[18px] shrink-0" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2582h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.6151z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.4673-.8064 5.9564-2.1805l-2.9087-2.2582c-.8064.5414-1.8368.8618-3.0477.8618-2.3441 0-4.3286-1.5831-5.036-3.7104H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71c-.1818-.5427-.2864-1.1218-.2864-1.71s.1046-1.1673.2864-1.71V4.9582H.9573C.3477 6.1732 0 7.5477 0 9s.3477 2.8268.9573 4.0418L3.964 10.71z"
      />
      <path
        fill="#EA4335"
        d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5813C13.4632.8918 11.426 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6714 5.1627 6.6559 3.5795 9 3.5795z"
      />
    </svg>
  );
}
