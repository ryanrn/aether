"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import {
  areaDeRecorte,
  escalaDeCobertura,
  limitarPosicao,
  limitesDeArrasto,
  type Tamanho,
} from "./avatar-cropper-math";

/** Lado do quadro de recorte NA TELA, em pixels. So afeta o desenho aqui. */
const JANELA_PX = 260;

/** 1 = a foto so cobre o quadro, sem sobra para escolher o que fica de fora. */
const ZOOM_MIN = 1;
const ZOOM_MAX = 3;

/**
 * Ajuste de zoom e posicao do avatar, antes de enviar.
 *
 * POR QUE EXISTE: ate aqui, a foto ia direto para o servidor e o recorte era
 * o que o CSS (`object-fit: cover`) decidisse sozinho — sempre o centro
 * exato da imagem, sem escolha nenhuma. Numa foto de retrato tirada na
 * vertical, o centro geometrico raramente e o rosto.
 *
 * SO PARA IMAGEM PARADA. Um avatar animado (GIF, ou WEBP/APNG animado — ver
 * `ehImagemAnimada` em `@aether/shared`) perderia a animacao ao passar por um
 * canvas, que so enxerga um quadro. `account-tab.tsx` NAO chama este
 * componente para esse caso: o Olimpo Pro continua indo direto, do jeito que
 * ja funcionava. E uma limitacao aceita, nao um esquecimento — refazer o
 * recorte preservando animacao pediria decodificar e recodificar cada quadro,
 * o que e um recurso a parte, bem maior que "deixar posicionar a foto".
 *
 * SEM BIBLIOTECA NOVA: arrastar (Pointer Events, que ja cobrem mouse, caneta
 * e toque) mais um `input[type=range]` para o zoom e um `canvas` para gerar o
 * recorte final. O gesto e pequeno o bastante para nao justificar mais uma
 * dependencia so para isto.
 *
 * A MATEMATICA DO RECORTE MORA A PARTE, em `avatar-cropper-math.ts`: e a
 * unica parte deste componente facil de errar por um sinal trocado, e a
 * unica que compensa testar isolada de DOM e canvas.
 */
export function AvatarCropper({
  open,
  file,
  tamanhoSaida = 512,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  /** A foto ORIGINAL escolhida — nunca a ja recortada, para nao empilhar recortes. */
  file: File | null;
  /** Lado do quadrado final, em pixels. Fixo: e o mesmo avatar em qualquer canto do app. */
  tamanhoSaida?: number;
  onCancel: () => void;
  onConfirm: (recortado: File) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<Tamanho | null>(null);
  const [zoom, setZoom] = useState(ZOOM_MIN);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const arrastando = useRef<{ x: number; y: number; offX: number; offY: number } | null>(null);

  /*
   * Tudo reseta quando a FOTO muda: URL do object, zoom, posicao. A posicao
   * de uma foto anterior nao significa nada para a proxima, e reabrir o
   * ajuste na mesma foto (botao "Ajustar") deve comecar do centro, nao de
   * onde a pessoa tinha deixado da ultima vez — sem isso ela precisaria
   * lembrar de recentralizar antes de mexer de novo.
   */
  useEffect(() => {
    setNatural(null);
    setZoom(ZOOM_MIN);
    setOffset({ x: 0, y: 0 });
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!file || !url) return null;

  const baseScale = natural ? escalaDeCobertura(natural, JANELA_PX) : 0;

  /**
   * Reenquadra contra um zoom PASSADO por parametro, e nao lido do estado: o
   * controle de zoom precisa recalcular o limite contra o valor NOVO no
   * mesmo instante em que muda, antes do proximo render.
   */
  function limitar(o: { x: number; y: number }, z: number) {
    if (!natural) return o;
    return limitarPosicao(o, limitesDeArrasto(natural, JANELA_PX, baseScale * z));
  }

  const escalaAtual = baseScale * zoom;
  const larguraExibida = natural ? natural.w * escalaAtual : 0;
  const alturaExibida = natural ? natural.h * escalaAtual : 0;

  function aoPressionar(evento: React.PointerEvent<HTMLDivElement>) {
    evento.currentTarget.setPointerCapture(evento.pointerId);
    arrastando.current = {
      x: evento.clientX,
      y: evento.clientY,
      offX: offset.x,
      offY: offset.y,
    };
  }

  function aoMover(evento: React.PointerEvent<HTMLDivElement>) {
    if (!arrastando.current) return;
    const dx = evento.clientX - arrastando.current.x;
    const dy = evento.clientY - arrastando.current.y;
    setOffset(
      limitar(
        { x: arrastando.current.offX + dx, y: arrastando.current.offY + dy },
        zoom,
      ),
    );
  }

  function aoSoltar() {
    arrastando.current = null;
  }

  /** Desenha o que esta DENTRO do quadro num canvas do tamanho final. */
  function confirmar() {
    const img = imgRef.current;
    if (!img || !natural) return;

    const { sx, sy, lado } = areaDeRecorte(natural, JANELA_PX, baseScale * zoom, offset);

    const canvas = document.createElement("canvas");
    canvas.width = tamanhoSaida;
    canvas.height = tamanhoSaida;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, sx, sy, lado, lado, 0, 0, tamanhoSaida, tamanhoSaida);

    /*
     * JPEG com qualidade alta, e nao PNG: o tamanho de um PNG cresce com o
     * detalhe da imagem, e uma foto de verdade em 512x512 podia flertar com o
     * teto de 2MB. JPEG a 92% fica previsivelmente pequeno para uma foto de
     * perfil, e a perda e imperceptivel neste tamanho.
     */
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onConfirm(new File([blob], "avatar.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92,
    );
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Ajustar foto"
      description="Arraste para posicionar. Use o controle para o zoom."
    >
      <div className="flex flex-col items-center gap-4 p-4">
        <div
          className="relative touch-none select-none overflow-hidden rounded-full border border-line bg-base-950"
          style={{ width: JANELA_PX, height: JANELA_PX, cursor: "grab" }}
          onPointerDown={aoPressionar}
          onPointerMove={aoMover}
          onPointerUp={aoSoltar}
          onPointerLeave={aoSoltar}
        >
          <img
            ref={imgRef}
            src={url}
            alt=""
            draggable={false}
            onLoad={(evento) => {
              const alvo = evento.currentTarget;
              setNatural({ w: alvo.naturalWidth, h: alvo.naturalHeight });
            }}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: larguraExibida || undefined,
              height: alturaExibida || undefined,
              maxWidth: "none",
              transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
            }}
          />
        </div>

        <input
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={0.01}
          value={zoom}
          disabled={!natural}
          onChange={(evento) => {
            const novoZoom = Number(evento.target.value);
            setZoom(novoZoom);
            // Reenquadra contra o zoom NOVO: sem isto, diminuir o zoom depois
            // de arrastar para a quina deixava um vao vazio na foto.
            setOffset((atual) => limitar(atual, novoZoom));
          }}
          className="w-full max-w-[260px] accent-[var(--color-accent-500)]"
        />

        <div className="flex w-full max-w-[260px] justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" size="sm" onClick={confirmar} disabled={!natural}>
            Usar esta foto
          </Button>
        </div>
      </div>
    </Modal>
  );
}
