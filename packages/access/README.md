# @aether/access — identidade e autorizacao

Responde a duas perguntas, e so a essas duas:

1. **Quem e voce?** (`tokens.ts`, `session.ts`)
2. **O que voce pode fazer neste servidor / neste canal?** (`member.ts`, `channels.ts`)

## Por que existe

Ate a fase 2 esse calculo morava em `apps/web/src/server/`. A partir da fase 3 o
gateway WebSocket tambem precisa dele: para decidir quem recebe evento de qual
canal, quem pode enviar mensagem e quem pode entrar em voz.

Um gateway em `apps/realtime` nao pode importar de `apps/web` — sao dois apps
irmaos, cada um com seu build. A alternativa seria reimplementar a regra do lado
do gateway, e duas copias da regra de permissao **divergem**; quando divergem, o
resultado nao e um bug de tela, e uma falha de autorizacao.

Entao a regra mora aqui, em um lugar so, e os dois apps consomem a mesma funcao.

## Fronteiras

- **Nada de Next aqui.** Sem `server-only`, sem `next/headers`, sem `react`.
  O que depende de request HTTP (ler cookie, gravar cookie, memoizar por
  request com `cache()`) fica em `apps/web/src/server/auth/session.ts`, que
  chama este pacote.
- **`server-only` continua valendo no app web.** Este pacote nao carrega esse
  marcador porque o gateway quebraria com ele; a protecao contra importar isto
  de um componente de cliente continua sendo o `server-only` dos modulos de
  `apps/web/src/server/` que fazem a ponte.
- `./tokens` e um subpath proprio de proposito: o middleware do Next roda no
  Edge runtime e nao pode carregar Prisma. Importar `@aether/access/tokens`
  traz so `jose`.

## Contrato

`MemberAccess` e o contexto minimo para calcular permissao: servidor, membro,
cargos, bitfield efetivo. O `MemberContext` do app web **estende** essa
interface (ele acrescenta a sessao HTTP), entao qualquer funcao daqui aceita os
dois sem conversao.
