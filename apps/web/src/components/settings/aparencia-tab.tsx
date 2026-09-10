"use client";

import { useEffect, useState } from "react";
import {
  hidratarPrefsDoChat,
  larguraDaSarjeta,
  LIMITES,
  usePrefsDoChat,
  type Densidade,
  type ModoTimestamp,
} from "@/lib/chat/prefs";
import { MessageGroup } from "@/components/chat/message-group";
import type { ChatMessage } from "@/lib/stores/realtime-store";
import type { PublicUser } from "@aether/shared";
import { cn } from "@/lib/utils";

/**
 * Aparencia do CHAT — densidade, fonte, avatares, espacamentos, timestamps.
 * Escala da interface e os toggles de acessibilidade ficam na aba
 * Acessibilidade (sao globais, nao so do chat).
 *
 * O preview no topo usa o mesmo `<MessageGroup>` do chat de verdade e le as
 * mesmas variaveis — mexer num slider muda o preview na hora.
 */

const DENSIDADES: { valor: Densidade; rotulo: string }[] = [
  { valor: "compacta", rotulo: "Compacta" },
  { valor: "confortavel", rotulo: "Confortavel" },
  { valor: "espacosa", rotulo: "Espacosa" },
];

const TIMESTAMPS: { valor: ModoTimestamp; rotulo: string }[] = [
  { valor: "sempre", rotulo: "Sempre" },
  { valor: "hover", rotulo: "No hover" },
  { valor: "nunca", rotulo: "Nunca" },
];

export function AparenciaTab({ user }: { user: PublicUser }) {
  const prefs = usePrefsDoChat();

  useEffect(() => hidratarPrefsDoChat(), []);

  return (
    <section className="flex flex-col gap-6">
      <Preview user={user} />

      <Grupo titulo="Densidade">
        <div className="flex gap-2">
          {DENSIDADES.map((d) => (
            <button
              key={d.valor}
              type="button"
              onClick={() => prefs.definir("densidade", d.valor)}
              className={cn(
                "flex-1 rounded-md border px-3 py-2 text-[12px] font-medium transition-colors",
                prefs.densidade === d.valor
                  ? "border-accent-600/60 bg-accent-600/10 text-accent-200"
                  : "border-line bg-base-900 text-ink-300 hover:border-line-strong",
              )}
            >
              {d.rotulo}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-ink-500">
          Escolher um preset redefine os ajustes abaixo. Depois da para afinar
          cada um.
        </p>
      </Grupo>

      <Grupo titulo="Ajuste fino">
        <LinhaSlider
          rotulo="Tamanho da fonte"
          valor={prefs.fontSize}
          unidade="px"
          min={LIMITES.fontSize[0]}
          max={LIMITES.fontSize[1]}
          onChange={(v) => prefs.definir("fontSize", v)}
        />
        <LinhaSlider
          rotulo="Tamanho dos avatares"
          valor={prefs.tamanhoAvatar}
          unidade="px"
          min={LIMITES.tamanhoAvatar[0]}
          max={LIMITES.tamanhoAvatar[1]}
          onChange={(v) => prefs.definir("tamanhoAvatar", v)}
        />
        <LinhaSlider
          rotulo="Espaco entre mensagens"
          valor={prefs.gapMensagem}
          unidade="px"
          min={LIMITES.gapMensagem[0]}
          max={LIMITES.gapMensagem[1]}
          onChange={(v) => prefs.definir("gapMensagem", v)}
        />
        <LinhaSlider
          rotulo="Espaco entre grupos"
          valor={prefs.gapGrupo}
          unidade="px"
          min={LIMITES.gapGrupo[0]}
          max={LIMITES.gapGrupo[1]}
          onChange={(v) => prefs.definir("gapGrupo", v)}
        />
      </Grupo>

      <Grupo titulo="Horario das mensagens">
        <div className="flex gap-2">
          {TIMESTAMPS.map((t) => (
            <button
              key={t.valor}
              type="button"
              onClick={() => prefs.definir("timestamps", t.valor)}
              className={cn(
                "flex-1 rounded-md border px-3 py-2 text-[12px] font-medium transition-colors",
                prefs.timestamps === t.valor
                  ? "border-accent-600/60 bg-accent-600/10 text-accent-200"
                  : "border-line bg-base-900 text-ink-300 hover:border-line-strong",
              )}
            >
              {t.rotulo}
            </button>
          ))}
        </div>
      </Grupo>

      <button
        type="button"
        onClick={() => prefs.restaurar()}
        className="self-start text-[12px] text-ink-400 underline-offset-2 hover:text-ink-200 hover:underline"
      >
        Restaurar o padrao
      </button>
    </section>
  );
}

function Grupo({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-500">
        {titulo}
      </h3>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function LinhaSlider({
  rotulo,
  valor,
  unidade,
  min,
  max,
  onChange,
}: {
  rotulo: string;
  valor: number;
  unidade: string;
  min: number;
  max: number;
  onChange: (valor: number) => void;
}) {
  return (
    <div className="border-t border-line-soft py-3 first:border-t-0">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-ink-200">{rotulo}</span>
        <span className="font-mono text-[11px] tabular-nums text-ink-500">
          {valor}
          {unidade}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={valor}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={rotulo}
        className="mt-2 block w-full accent-accent-500"
      />
    </div>
  );
}

/** Preview vivo — o mesmo componente do chat, lendo as mesmas variaveis. */
function Preview({ user }: { user: PublicUser }) {
  const { fontSize, gapMensagem, gapGrupo, tamanhoAvatar, densidade, timestamps } =
    usePrefsDoChat();
  const [outro] = useState<PublicUser>(() => ({
    id: "preview-outro",
    username: "aether",
    displayName: "Aether",
    avatarUrl: null,
    status: "ONLINE",
    kind: "HUMAN",
    plano: "FREE",
    moldura: null,
    decoracao: null,
  }));

  const msg = (autor: PublicUser, texto: string, i: number): ChatMessage => ({
    id: `preview-${i}`,
    conversationId: "preview",
    content: texto,
    author: autor,
    createdAt: new Date(Date.now() - (5 - i) * 60000).toISOString(),
    editedAt: null,
    reactions: i === 1 ? [{ emoji: "\u{1F44B}", count: 2, mine: false }] : [],
    anexos: [],
    replyTo: null,
  });

  const grupos = [
    {
      chave: "p1",
      autor: user,
      mensagens: [msg(user, "assim fica o meu chat", 0), msg(user, "da pra ler bem", 1)],
    },
    { chave: "p2", autor: outro, mensagens: [msg(outro, "combinado \u{1F44D}", 2)] },
  ];

  return (
    <div
      data-density={densidade}
      data-chat-ts={timestamps}
      style={
        {
          "--chat-font": `${fontSize}px`,
          "--chat-gap-msg": `${gapMensagem}px`,
          "--chat-gap-group": `${gapGrupo}px`,
          "--chat-avatar": `${tamanhoAvatar}px`,
          "--chat-gutter": `${larguraDaSarjeta(tamanhoAvatar)}px`,
        } as React.CSSProperties
      }
      className="chat-root overflow-hidden rounded-lg border border-line bg-base-900 py-3"
    >
      <ul>
        {grupos.map((g) => (
          <MessageGroup key={g.chave} grupo={g} />
        ))}
      </ul>
    </div>
  );
}
