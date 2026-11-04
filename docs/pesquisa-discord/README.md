# Pesquisa: Discord como referência de produto (02/11/2026)

O que o Discord faz em três áreas que o dono do produto marcou como
prioritárias, comparado com o Aether, e o que fazer a respeito.

| Documento | Assunto |
| --- | --- |
| [deteccao-de-jogos.md](deteccao-de-jogos.md) | Como o Discord descobre o que você está jogando, e por que a nossa parece pior do que é |
| [loja-e-cosmeticos.md](loja-e-cosmeticos.md) | A loja do Discord (decorações, efeitos, placas de nome, Orbs) e a nossa |
| [gravacao-de-chamada.md](gravacao-de-chamada.md) | Gravar a chamada atual numa pasta do computador: o Discord não tem, nós podemos ter |
| [observacao-manual.md](observacao-manual.md) | O que observar usando o Discord normalmente, para confirmar o que as fontes não dizem |

## Método, e o que não foi feito

- **Fontes:** documentação de desenvolvedor do Discord
  (`docs.discord.com/developers`), blog oficial (`discord.com/blog`) e, quando
  as páginas oficiais recusaram acesso automatizado (a central de ajuda
  respondeu 403), guias de terceiros, sempre marcados como tal.
- **O app do Discord não foi analisado com o REA, nem desempacotado,
  instrumentado ou automatizado.** Os Termos de Serviço do Discord proíbem
  fazer engenharia reversa ou decompilar o software, seja qual for a
  finalidade, e o Aether é um concorrente direto: além do risco para a conta
  de quem fizesse, o código do Aether ficaria exposto à acusação de ter sido
  escrito a partir do deles. O REA continua sendo usado no app do **próprio**
  Aether (`docs/rea-bundle-audit.md`).
- **Legenda:** **[oficial]** fonte do próprio Discord · **[terceiros]** guia ou
  matéria de fora · **[código]** lido no Aether, com arquivo citado ·
  **[proposta]** recomendação.
