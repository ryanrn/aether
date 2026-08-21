# Aether — instrucoes de trabalho

Plataforma de comunicacao em tempo real (voz, tela, texto). Monorepo npm
workspaces: `apps/web` (Next 15), `apps/realtime` (gateway Socket.IO),
`packages/{db,shared,access}`.

O projeto e construido em 7 fases. Estado atual, escopo de cada fase e
limitacoes conhecidas estao no [README](README.md) — leia antes de propor
qualquer coisa.

## Regra de processo (obrigatoria em toda fase)

Antes de implementar:

1. **Analisar a arquitetura existente.** Ler o codigo que ja existe; nao supor.
2. **Dizer quais arquivos serao criados e modificados**, antes de mexer.
3. **Explicar as decisoes tecnicas** e o porque de cada uma.

Durante e depois:

4. **Implementar apenas a fase pedida.** Nao adiantar a proxima.
5. **Nao quebrar o que ja funciona.** Rodar os `scripts/verify-phase*.mjs` das
   fases anteriores como regressao.
6. **Explicar como testar.**
7. **Listar problemas e limitacoes conhecidos**, na secao de limitacoes do
   README da fase.

**Nenhuma alteracao grande sem explicar antes.** O alvo e **codigo de producao,
nao demonstracao visual**: se algo for simulado ou provisorio, isso vai escrito
nas limitacoes em vez de passar por pronto.

## Regras de arquitetura

- **Nada de logica de negocio em componente.** Componente chama action, action
  chama guard e service, service fala com o banco.
- **Regra de autorizacao mora em um lugar so:** `@aether/access`. `apps/web` e
  `apps/realtime` nao importam um do outro. Duas copias da regra de permissao
  divergem, e permissao divergente e falha de autorizacao, nao bug de tela.
- **O frontend nunca decide permissao** — so esconde/mostra UI. Toda action
  revalida no servidor.
- **Nao revelamos existencia de recurso:** acesso indevido responde 404, nao 403.

## Comandos

```bash
npm run dev                 # app web (3000)
npm run dev:realtime        # gateway WebSocket (4000)
npm run typecheck           # todos os workspaces
npm run db:generate         # cliente Prisma
npm run db:seed             # dados de exemplo (usuarios ryan / joao)

# regressao — precisam dos servicos no ar
npx dotenv -e .env -- node scripts/verify-phase2.mjs
npx dotenv -e .env -- node scripts/verify-phase3.mjs
```

O `.env` fica **na raiz** do monorepo (nao `.env.local`, nao dentro de
`apps/web`): web e gateway precisam do mesmo `AUTH_SECRET` para validar o mesmo
cookie de sessao.
