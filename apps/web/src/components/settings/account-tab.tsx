"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  AVATAR_MIME_TYPES,
  MOLDURAS,
  limiteDoAvatar,
  planoAtende,
  podeAvatarAnimado,
  type PublicUser,
} from "@aether/shared";
import {
  removeAvatarAction,
  setMolduraAction,
  setAllowServerDmsAction,
  setAllowServerFriendRequestsAction,
  setNicknameAction,
  updateDisplayNameAction,
  uploadAvatarAction,
} from "@/server/actions/profile";
import { Avatar } from "@/components/ui/avatar";
import { AvatarCropper } from "./avatar-cropper";
import { MOLDURA_ESTILO } from "@/components/ui/molduras";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input } from "@/components/ui/field";
import { ToggleRow } from "@/components/ui/switch";

/**
 * Minha conta: foto, nome de exibicao e apelido no servidor atual.
 *
 * Era um modal proprio (aberto pelo avatar na barra inferior). Virou aba
 * porque agora existe uma tela de configuracoes do app, e ter dois lugares
 * para editar a mesma coisa e como ter duas engrenagens de servidor — mais
 * caminho para manter, sem nada a mais para a pessoa.
 *
 * A validacao de tamanho e tipo aqui e so conveniencia: o servidor revalida os
 * dois, e o tipo ele confere pelos BYTES do arquivo, nao pelo que o navegador
 * declarou.
 */
export function AccountTab({
  user,
  server,
}: {
  /**
   * O usuario publico mais as preferencias de contato. Como extensao de
   * `PublicUser`, e nao campo a campo: a copia repetida obrigava a mexer aqui
   * a cada campo novo do perfil, e foi assim que plano e moldura quase
   * ficaram de fora desta tela.
   */
  user: PublicUser & {
    allowServerDms: boolean;
    allowServerFriendRequests: boolean;
  };
  /**
   * Servidor aberto agora — o apelido vale so nele. `null` quando as
   * configuracoes sao abertas fora de um servidor: o campo de apelido some.
   */
  server: { id: string; memberId: string; nickname: string | null } | null;
}) {
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const [moldura, setMoldura] = useState(user.moldura);
  /**
   * O arquivo escolhido mas AINDA NAO enviado, com a URL local da previa.
   *
   * A previa existe porque trocar foto e uma acao que a pessoa quer conferir
   * antes: sem ela, descobrir que escolheu o arquivo errado custa um upload
   * inteiro e uma volta ao seletor.
   */
  const [previa, setPrevia] = useState<{
    url: string;
    arquivo: File;
    animado: boolean;
  } | null>(null);

  /*
   * `createObjectURL` prende o arquivo na memoria ate ser revogado. Sem esta
   * limpeza, escolher dez fotos numa sessao deixa dez arquivos presos.
   */
  useEffect(() => {
    if (!previa) return;
    return () => URL.revokeObjectURL(previa.url);
  }, [previa]);

  /**
   * A foto ORIGINAL escolhida, antes do recorte — guardada a parte para o
   * botao "Ajustar" poder reabrir o zoom sobre a fonte de verdade, e nao
   * sobre um recorte de um recorte (cada rodada perderia nitidez e cortaria
   * cada vez mais para dentro).
   *
   * So existe para foto PARADA: avatar animado nunca passa pelo recorte, veja
   * `AvatarCropper`.
   */
  const [arquivoOriginal, setArquivoOriginal] = useState<File | null>(null);
  const [recortando, setRecortando] = useState(false);

  const podeAnimar = podeAvatarAnimado(user.plano);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [nickname, setNickname] = useState(server?.nickname ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [aceitaDeServidor, setAceitaDeServidor] = useState(user.allowServerDms);
  const [aceitaPedidos, setAceitaPedidos] = useState(
    user.allowServerFriendRequests,
  );
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Grava na hora, sem botao de salvar.
   *
   * O estado local vira antes da resposta para a caixa nao ficar "presa" ate a
   * rede voltar. Se a acao falhar, ele volta ao que era — caixa que mostra um
   * valor que o servidor nao tem e pior do que caixa lenta, porque a pessoa vai
   * embora achando que desligou.
   */
  function salvarChave(
    valor: boolean,
    anterior: boolean,
    aplicar: (v: boolean) => void,
    acao: (v: boolean) => Promise<{ ok: boolean; error?: string }>,
  ) {
    aplicar(valor);
    setError(null);
    startTransition(async () => {
      const resultado = await acao(valor);
      if (!resultado.ok) {
        // Volta ao que era: caixa mostrando valor que o servidor nao tem e
        // pior que caixa lenta — a pessoa vai embora achando que desligou.
        aplicar(anterior);
        setError(resultado.error ?? "Nao consegui salvar.");
        return;
      }
      setSaved(true);
    });
  }

  /**
   * Escolher arquivo agora so PREPARA a previa. O envio virou um segundo passo
   * deliberado — trocar a propria cara nao deveria acontecer no mesmo clique
   * em que se escolhe o arquivo.
   *
   * As checagens daqui sao conveniencia: o servidor revalida tudo, e o tipo
   * ele confere pelos BYTES, nao pelo que o navegador declarou. Um `type`
   * mentiroso passa aqui e morre la.
   */
  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // permite reescolher o mesmo arquivo depois
    if (!file) return;

    setError(null);
    if (!AVATAR_MIME_TYPES.includes(file.type as never)) {
      setError("Envie PNG, JPEG, WEBP ou GIF");
      return;
    }

    const animado = file.type === "image/gif";
    if (animado && !podeAnimar) {
      setError("Avatar animado e exclusivo do Olimpo Pro");
      return;
    }
    const teto = limiteDoAvatar(file.type);
    if (file.size > teto) {
      setError(`Imagem maior que ${Math.round(teto / 1024 / 1024)}MB`);
      return;
    }

    /*
     * Imagem PARADA passa pelo recorte antes de virar previa — e onde se
     * escolhe zoom e posicao. Animada vai direto, do jeito que sempre foi: um
     * canvas so enxerga um quadro, e recortar destruiria a animacao.
     */
    if (animado) {
      setPrevia({ url: URL.createObjectURL(file), arquivo: file, animado });
    } else {
      setArquivoOriginal(file);
      setRecortando(true);
    }
  }

  /** O recorte foi confirmado: a foto CORTADA e o que vira previa e upload. */
  function aoConfirmarRecorte(recortado: File) {
    setPrevia({
      url: URL.createObjectURL(recortado),
      arquivo: recortado,
      animado: false,
    });
    setRecortando(false);
  }

  function enviarPrevia() {
    if (!previa) return;
    const formData = new FormData();
    formData.set("avatar", previa.arquivo);

    setError(null);
    startTransition(async () => {
      const result = await uploadAvatarAction(formData);
      if (result.ok) {
        setAvatarUrl(result.data.avatarUrl);
        setPrevia(null);
      } else {
        setError(result.error);
      }
    });
  }

  /**
   * Troca a moldura de forma otimista e volta atras se o servidor recusar.
   *
   * Mesmo raciocinio das chaves de privacidade logo acima: mostrar um valor
   * que o servidor nao tem e pior do que demorar, porque a pessoa vai embora
   * achando que aplicou.
   */
  function escolherMoldura(id: string | null) {
    const anterior = moldura;
    setMoldura(id);
    setError(null);
    startTransition(async () => {
      const result = await setMolduraAction(id);
      if (!result.ok) {
        setMoldura(anterior);
        setError(result.error);
      }
    });
  }

  function removeAvatar() {
    setError(null);
    startTransition(async () => {
      const result = await removeAvatarAction();
      if (result.ok) setAvatarUrl(null);
      else setError(result.error);
    });
  }

  function saveName() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateDisplayNameAction(displayName);
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  }

  function saveNickname() {
    if (!server) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await setNicknameAction(server.id, {
        memberId: server.memberId,
        nickname,
      });
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative">
          <Avatar
            userId={user.id}
            name={displayName || user.username}
            /* A previa manda enquanto existe: e o ponto da previa. */
            src={previa?.url ?? avatarUrl}
            moldura={moldura}
            size="lg"
          />
          {previa?.animado ? (
            /*
             * GIF parece imagem parada no primeiro quadro. Sem dizer que e
             * animado, a pessoa nao sabe se o movimento sobreviveu ao envio —
             * e essa duvida e exatamente o que ela veio conferir.
             */
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-[4px] border border-amber-400/40 bg-base-900 px-1 py-[1px] text-[9px] font-bold uppercase tracking-[0.06em] text-amber-300">
              GIF
            </span>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setError(null);
                inputRef.current?.click();
              }}
              disabled={pending}
            >
              {pending ? "Enviando..." : "Escolher foto"}
            </Button>
            {previa ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  onClick={enviarPrevia}
                  disabled={pending}
                >
                  {pending ? "Enviando..." : "Salvar foto"}
                </Button>
                {/*
                  So para foto PARADA: reabre o recorte sobre o arquivo
                  ORIGINAL, e nao sobre a previa ja cortada — recortar um
                  recorte perderia nitidez a cada rodada.
                */}
                {!previa.animado && arquivoOriginal ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setRecortando(true)}
                    disabled={pending}
                  >
                    Ajustar
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPrevia(null);
                    setArquivoOriginal(null);
                  }}
                  disabled={pending}
                >
                  Descartar
                </Button>
              </>
            ) : avatarUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={removeAvatar}
                disabled={pending}
              >
                Remover
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-ink-500">
            PNG, JPEG ou WEBP ate 2MB.{" "}
            {podeAnimar ? (
              <span className="text-amber-300">GIF animado ate 10MB.</span>
            ) : (
              "GIF animado e do Olimpo Pro."
            )}
          </p>
        </div>
      </div>

      {/*
        MOLDURAS. A tela mostra o catalogo INTEIRO, e nao so o que a pessoa
        pode usar: esconder o que existe atras do plano nao vende nada, porque
        ninguem deseja o que nao sabe que existe. O que nao esta liberado vem
        apagado e nao clica — e a autorizacao de verdade e a action, que
        recusa id de moldura acima do plano mesmo que alguem a chame na mao.
      */}
      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400">
          Moldura do avatar
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => escolherMoldura(null)}
            disabled={pending}
            aria-pressed={moldura === null}
            title="Sem moldura"
            className={cn(
              "grid h-9 w-9 place-items-center rounded-full border text-[10px] text-ink-500 transition-colors",
              moldura === null
                ? "border-accent-400 bg-base-800"
                : "border-line hover:bg-base-850",
            )}
          >
            —
          </button>

          {MOLDURAS.map((m) => {
            const liberada = planoAtende(user.plano, m.tier);
            const ativa = moldura === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => liberada && escolherMoldura(m.id)}
                disabled={pending || !liberada}
                aria-pressed={ativa}
                title={
                  liberada
                    ? m.nome
                    : `${m.nome} — pede ${m.tier === "PRO" ? "Olimpo Pro" : "Olimpo"}`
                }
                className={cn(
                  "relative grid h-9 w-9 place-items-center rounded-full transition-transform",
                  MOLDURA_ESTILO[m.id],
                  ativa &&
                    "ring-2 ring-accent-400 ring-offset-2 ring-offset-base-900",
                  liberada
                    ? "hover:scale-105"
                    : "cursor-not-allowed opacity-30",
                )}
              >
                {/* o miolo escuro deixa a amostra parecer o que ela e: um anel */}
                <span className="h-5 w-5 rounded-full bg-base-900" />
                {!liberada ? (
                  <span className="absolute inset-0 grid place-items-center text-[11px]">
                    &#128274;
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_MIME_TYPES.join(",")}
        onChange={onFileChange}
        className="hidden"
      />

      <AvatarCropper
        open={recortando}
        file={arquivoOriginal}
        onCancel={() => setRecortando(false)}
        onConfirm={aoConfirmarRecorte}
      />

      <Field
        label="Nome de exibicao"
        hint={`Vale em todos os servidores. Seu usuario @${user.username} nao muda.`}
      >
        <Input
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.target.value);
            setSaved(false);
          }}
          maxLength={32}
        />
      </Field>

      {server ? (
        <div className="border-t border-line pt-5">
          <Field
            label="Apelido neste servidor"
            hint="Vale so aqui. Vazio volta ao seu nome de exibicao."
          >
            <Input
              value={nickname}
              onChange={(event) => {
                setNickname(event.target.value);
                setSaved(false);
              }}
              placeholder={displayName}
              maxLength={32}
            />
          </Field>
        </div>
      ) : null}

      {/*
        PRIVACIDADE, separada dos campos de identidade por uma linha: nome e
        avatar sao "quem eu sou"; isto e "quem pode me alcancar". Misturar os
        dois num bloco so faz a chave passar despercebida.
      */}
      <div className="border-t border-line pt-5">
        <h3 className="mb-1 text-[13px] font-semibold text-ink-100">
          Privacidade
        </h3>
        <div className="flex flex-col">
          <ToggleRow
            checked={aceitaDeServidor}
            disabled={pending}
            onCheckedChange={(v) =>
              salvarChave(
                v,
                aceitaDeServidor,
                setAceitaDeServidor,
                setAllowServerDmsAction,
              )
            }
            title="Receber mensagens diretas de quem divide um servidor comigo"
            description="Seus amigos sempre conseguem falar com voce, com isto ligado ou nao. Desligar nao apaga conversa nenhuma — quem ja falou com voce volta a alcancar se voce religar."
          />
          <ToggleRow
            checked={aceitaPedidos}
            disabled={pending}
            onCheckedChange={(v) =>
              salvarChave(
                v,
                aceitaPedidos,
                setAceitaPedidos,
                setAllowServerFriendRequestsAction,
              )
            }
            title="Receber pedidos de amizade de quem divide um servidor comigo"
            description="Desligando, so quem souber seu nome de usuario exato consegue te mandar pedido."
          />
        </div>
      </div>

      <FieldError>{error}</FieldError>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          onClick={saveName}
          disabled={pending || displayName.trim() === user.displayName}
        >
          {pending ? "Salvando..." : "Salvar nome"}
        </Button>
        {server ? (
          <Button
            variant="secondary"
            onClick={saveNickname}
            disabled={pending || nickname.trim() === (server.nickname ?? "")}
          >
            Salvar apelido
          </Button>
        ) : null}
        {saved ? (
          <span className="text-[13px] text-signal-online">Salvo.</span>
        ) : null}
      </div>
    </section>
  );
}
