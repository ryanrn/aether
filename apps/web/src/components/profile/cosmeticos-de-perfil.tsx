/**
 * As camadas de dois cosmeticos de perfil que so DESENHAM uma imagem: a placa
 * de nome (fundo da linha na lista de membros) e o efeito de perfil (por cima
 * do cartao). A URL chega ja resolvida contra plano e `ativo`
 * (`imagemEfetiva`); aqui nao ha regra, so render.
 */

/**
 * O fundo de uma linha com placa. O pai precisa de `relative isolate
 * overflow-hidden`: a camada fica em `-z-10` dentro desse contexto, atras do
 * conteudo da linha e na frente do fundo do painel.
 *
 * O degrade escurece o lado esquerdo, onde ficam avatar e nome — a arte e de
 * terceiros e nao da para garantir contraste com o texto de outra forma.
 */
export function FundoDePlaca({ url }: { url: string }) {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="h-full w-full object-cover" />
      <span className="absolute inset-0 bg-gradient-to-r from-base-950/75 via-base-950/35 to-transparent" />
    </span>
  );
}

/**
 * O efeito por cima do cartao de perfil. O pai precisa estar posicionado
 * (`relative`/`fixed`). Nao captura clique (`pointer-events-none`) — o cartao
 * continua usavel embaixo.
 *
 * O recorte (`overflow-hidden` + o arredondado herdado) fica NESTA camada, e
 * nao no cartao: clipar o cartao cortaria a decoracao do avatar, que estoura o
 * topo dele de proposito.
 */
export function CamadaDeEfeito({ url }: { url: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-[inherit]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="h-full w-full object-cover" />
    </span>
  );
}
