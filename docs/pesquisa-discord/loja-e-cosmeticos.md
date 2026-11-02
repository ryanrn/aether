# Loja e cosméticos

## Como o Discord faz

- **Itens à venda:** decorações de avatar (moldura em volta da foto), efeitos
  de perfil (animação ao abrir o cartão), placas de nome (fundo atrás do nome
  na lista de membros, na DM ao passar o mouse e na barra de configurações) e
  molduras de perfil [oficial: [placas de nome](https://discord.com/blog/nameplates-land-in-the-shop);
  terceiros: [Digital Citizen](https://www.digitalcitizen.life/what-is-the-discord-shop-and-how-to-use-it-to-customise-your-profile/)].
- **Aberta a todos**, sem precisar do plano pago; quem assina o Nitro tem
  desconto em tudo [oficial: placas de nome].
- **Prévia antes de comprar** [oficial: placas de nome].
- **Organizada em coleções temáticas** (Cyberpunk, Galaxy, Anime) que entram e
  saem [oficial: placas de nome]. Há pacotes e itens por tempo limitado
  [terceiros].
- **Orbs, a moeda que se ganha** [oficial: [Orbs](https://discord.com/blog/discord-orbs)]:
  - ganhos completando **Missões** (Quests), que mudam com frequência; algumas
    são de uma plataforma só;
  - compram itens da loja (o item mostra preço em dinheiro **e** em Orbs),
    itens exclusivos de Orbs, uma insígnia de perfil e créditos de 3 dias de
    Nitro;
  - **não** compram presente para outra pessoa, item de parceiro, assinatura
    recorrente nem impulso de servidor;
  - ficam na conta até serem usados; o item ganho com Orbs vale em todas as
    plataformas.
- **Preços de referência:** de uns US$ 3,50 a US$ 12 por item, variando com a
  coleção [terceiros: [Slaykeys](https://slaykeys.com/en/guides/discord-shop-prices);
  pode estar desatualizado].

## Como o Aether faz hoje [código]

Schema (`Cosmetic`, `UserCosmetic`, `CosmeticType`),
`apps/web/src/components/loja/loja-screen.tsx` (768 linhas),
`equiparCosmeticoAction`:

- **Dois tipos de item:** `DECORATION` (moldura) e `BANNER`. Não há efeito de
  perfil nem placa de nome.
- **Como se ganha um item:** de graça, por plano (`tierMinimo`) ou dado pela
  equipe. **Não existe compra:** item pago mostra o preço e "em breve"
  (`loja-screen.tsx:542,741`).
- **O campo `precoMoedas` existe e não é usado** em lugar nenhum.
- **Equipar é bem feito:** o servidor revalida plano, posse e se o item está
  ativo; a decoração tem especificação própria (tela de 512, camada a 180%) e
  o upload é normalizado.
- **Painel da equipe** para criar e ativar itens.

O que faz a loja parecer ruim não é o visual, é que **não há nada a fazer
nela**: não dá para comprar, não dá para ganhar, e o catálogo tem só dois
tipos de item.

| Falta | Peso |
| --- | --- |
| Uma forma de **conseguir** item (comprar ou ganhar) | o principal |
| Mais tipos: **efeito de perfil** e **placa de nome** | grande |
| **Coleções**, destaque da semana, itens por tempo limitado | médio, dá vida à loja |
| **Prévia no seu próprio perfil** e no cartão de membro | médio |
| **Presentear** | médio |
| Histórico do que você tem, com data e origem | pequeno (a coluna `origem` já existe) |

## O que fazer [proposta]

A ordem importa, porque cada passo depende de uma decisão de produto.

1. **Decidir a economia (decisão de produto, de custo e jurídica):**
   - **A. Moeda que se ganha** (o equivalente aos Orbs): missões ligadas ao
     que o Aether já mede, como horas em voz, jogos detectados, entrar em
     salas de grupo, convidar amigos. Sem dinheiro de verdade, sem
     processador de pagamento, sem nota fiscal. Dá vida à loja rápido.
   - **B. Compra com dinheiro** (Mercado Pago ou Stripe, com Pix): receita,
     mas exige processador de pagamento, política de reembolso, impostos e
     termos de venda.
   - **C. As duas**, como o Discord. Recomendação: começar por **A** e deixar
     a moeda e o modelo de preço prontos para B.
2. **Placa de nome e efeito de perfil** como tipos novos (`CosmeticType` ganha
   valores; migração só adiciona). A placa aparece na lista de membros e no
   chat, o efeito no cartão de perfil.
3. **Coleções e rotação:** um agrupamento de itens com datas de entrada e
   saída, e a vitrine montada a partir dele.
4. **Prévia no seu perfil** antes de equipar (o cartão de perfil já existe).
5. **Presente:** comprar ou trocar moeda por um item para um amigo.

Para a moeda, o que precisa ser garantido no banco desde o primeiro dia:
saldo que nunca fica negativo, cada ganho e gasto registrado num livro-razão
(nunca só um número que muda), compra de item e débito na mesma transação, e
missões que não podem ser resgatadas duas vezes.
