# Progresso de implementação

Registro do que saiu de [aether-roadmap.md](aether-roadmap.md). Um item só é
**concluído** com teste relevante passando; **em produção** exige deploy.

| Data | Item | Estado | Validação | Deploy |
| --- | --- | --- | --- | --- |
| 01/11/2026 | P0-1 Vínculo Google seguro | commitado em `fix/p0-seguranca` (`02ade84`) | `tests/unit/google-vinculo.test.ts` (4 casos; 2 falham contra o código antigo), suíte 862/862, typecheck web e testes limpos | **não** |
| 01/11/2026 | P0-2 Segredo da API interna — gateway e web | commitado em `fix/p0-seguranca` (`82f4c52`); scripts e `.env.example` pendentes | `tests/unit/internal-auth.test.ts` (5 casos), suíte 867/867, typecheck realtime limpo | **não** |

## P0-1 — Vínculo Google seguro

- **Problema:** `resolverUsuarioGoogle` vinculava a identidade Google a
  qualquer conta com o mesmo e-mail, inclusive a que nunca confirmou o e-mail,
  mantendo a senha, as sessões e o 2FA de quem cadastrou.
- **O que mudou:** `apps/web/src/server/services/google-auth.ts`.
  - Conta com e-mail confirmado: só grava o `googleId`, como antes.
  - Conta sem confirmação: `assumirContaNaoVerificada` roda uma única
    `$transaction` que grava o `googleId` e marca o e-mail como verificado,
    zera senha e 2FA, apaga os códigos de backup, revoga as sessões e invalida
    reset, verificação e códigos de login do desktop pendentes. Registra
    `web.google.assumiu_conta`.
- **Sem migração.** Só mudou um comentário no `schema.prisma`.
- **Como testar:**
  `npx vitest run tests/unit/google-vinculo.test.ts`. Ponta a ponta (precisa de
  um banco que não seja o de produção e das credenciais Google): cadastrar
  `x@gmail.com` com senha e sem confirmar → entrar com o Google `x@gmail.com`
  → a senha antiga deve falhar e a sessão antiga deve cair.
- **Limitações:** no README, seção "Login com Google", em "Limitações conhecidas".

## Não feito, e por quê

- **Engenharia reversa do cliente Discord com REA**
  (`C:\Users\Ryu\AppData\Local\Discord`): não executada. Os Termos do
  Discord proíbem "reverse engineer or decompile our software or services".
  Ver [discord-research.md](discord-research.md) §1. A referência de produto
  continua sendo a documentação pública e o uso normal do app.
- `github.com/discord/discord-open-source` não é o código do cliente: é só a
  lista que alimenta a página discord.com/open-source.

## P0-2 — Segredo próprio da API interna (parcial)

- **Feito (gateway):** `apps/realtime/src/env.ts` lê `INTERNAL_API_SECRET`
  (opcional; o boot falha se tiver menos de 32 caracteres ou for igual ao
  `AUTH_SECRET`) e `INTERNAL_API_ACEITA_LEGADO`. `internal.ts` autentica por
  `verificarSegredoInterno` (`internal-auth.ts`) e avisa uma vez por processo
  quando ainda recebe o legado. Sem `INTERNAL_API_SECRET`, o comportamento é
  idêntico ao anterior; dá para publicar sozinho.
- **Pendente, edição manual:**
  - `apps/web/src/server/realtime-notify.ts`: as 6 leituras de
    `process.env.AUTH_SECRET` (linhas 34, 87, 247, 287, 323, 355) passam a
    usar `INTERNAL_API_SECRET`, com o `AUTH_SECRET` como reserva enquanto ele
    não existir.
  - O header `x-aether-internal` em `verify-phase6`, `verify-phase7b`,
    `verify-phase-bots`, `verify-friends-live` e `verify-igdb-live`.
  - `INTERNAL_API_SECRET` no payload de `fly-secrets.mjs` e de
    `vercel-env.mjs`, e as duas variáveis no `.env.example`.
- **Ordem do deploy:**
  1. Gateway no Fly.
  2. Gerar `INTERNAL_API_SECRET` e configurá-lo no Fly e na Vercel.
  3. Web na Vercel.
  4. Conferir que o aviso `gateway.internal.legado` parou e pôr
     `INTERNAL_API_ACEITA_LEGADO=nao` no Fly.
