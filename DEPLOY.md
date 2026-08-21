# Deploy

Quatro pecas. Duas ja estao hospedadas:

| peca | onde | estado |
| --- | --- | --- |
| Banco (Postgres) | Supabase, `sa-east-1` | ja hospedado |
| SFU (midia) | LiveKit Cloud | ja hospedado |
| Gateway WebSocket | **Fly.io, regiao `gru`** | a fazer |
| App web (Next) | **Vercel, regiao `gru1`** | a fazer |

**Por que GRU nos dois:** o gateway consulta o Postgres a cada mensagem
enviada, e as Server Actions do Next tambem falam com o banco. Com o Supabase
em Sao Paulo, hospedar em outra regiao faria cada operacao pagar a viagem de
ida e volta.

**O audio nao passa por nenhum dos dois.** Ele vai do navegador direto para o
edge do LiveKit. A escolha de regiao afeta chat e presenca, nao a qualidade da
voz.

---

## Antes de comecar

### 1. Aumentar o limite de conexoes do banco

O `DATABASE_URL` do Supabase vem com `connection_limit=1`. Isso serializa as
consultas — e o gateway faz uma por mensagem enviada.

No **gateway** isso e corrigido automaticamente pelo `scripts/fly-secrets.mjs`.
Na **Vercel** voce ajusta a mao ao colar a variavel:

```
...?pgbouncer=true&connection_limit=5
```

### 2. Escolher os nomes

O `fly.toml` assume `app = "aether-gateway"`. Se o nome ja estiver em uso,
troque no arquivo antes do primeiro deploy.

---

## Gateway (Fly.io)

Instale o `flyctl` ([fly.io/docs/flyctl/install](https://fly.io/docs/flyctl/install/))
e, na raiz do repositorio:

```bash
fly auth login
```

```bash
fly launch --no-deploy --copy-config --region gru
```

O `--copy-config` faz o Fly reaproveitar o `fly.toml` do repositorio. Confirme
que ele nao criou banco nem Redis — nao precisamos.

Duas coisas esperadas neste passo: o Fly **gera um nome proprio** e ignora
`--name` (o endereco do gateway nao e voltado ao usuario, entao tanto faz), e
ele **reescreve o fly.toml**. Depois de rodar, confira que
`auto_stop_machines = "off"` e `min_machines_running = 1` continuam la — se a
maquina dormir, a presenca de quem esta online e apagada e a primeira conexao
espera o processo subir.

Depois os segredos. Use o utilitario em vez de digita-los: ele le do `.env`
e passa pela entrada padrao do flyctl, entao nenhum valor aparece na tela nem
no historico do terminal.

```bash
node scripts/fly-secrets.mjs https://SEU-APP.vercel.app
```

Ele tambem sobe o `connection_limit` de 1 para 5 na URL de producao — com 1 as
consultas serializam, e o gateway faz uma por mensagem enviada.

> `AUTH_SECRET` tem de ser **exatamente o mesmo** nos dois lados: e ele que
> valida o ticket de handshake. Segredos diferentes = ninguem conecta.
>
> A URL passada como argumento vira a **origem liberada no CORS** do gateway.
> Se estiver errada, o navegador recusa toda conexao. Na primeira vez voce
> ainda nao tem a URL da Vercel — passe um valor provisorio e rode o comando de
> novo depois, com o endereco real.

```bash
fly deploy
```

Confira:

```bash
curl https://aether-gateway.fly.dev/health
```

Deve responder `{"ok":true,...}`.

---

## App web (Vercel)

O painel da Vercel so oferece importar de um repositorio Git. Como o projeto e
local, use o CLI — mesmo caminho do Fly, sem publicar codigo em lugar nenhum.

```bash
npx vercel login
```

```bash
npx vercel link
```

Responda que e um projeto novo e aceite o diretorio atual (a RAIZ do monorepo,
nao `apps/web`).

Agora as variaveis, antes do deploy:

```bash
node scripts/vercel-env.mjs https://SEU-GATEWAY.fly.dev
```

**A ordem importa.** Variaveis `NEXT_PUBLIC_*` sao embutidas no bundle em tempo
de BUILD. Definir `NEXT_PUBLIC_REALTIME_URL` depois do deploy nao muda nada ate
o proximo build — o navegador continuaria tentando `localhost:4000`.

```bash
npx vercel --prod
```

### O que o vercel.json resolve

- `buildCommand: npm run build:ci` — o `build` normal injeta o `.env` da raiz
  via dotenv-cli, e esse arquivo nao existe na Vercel; o build falharia antes de
  comecar.
- `outputDirectory: apps/web/.next` — em monorepo a saida do Next nao fica na
  raiz. Sem isso o build passa e o deploy falha com "no output directory".
- `regions: gru1` — as Server Actions falam com o banco, que esta em Sao Paulo.

### Variaveis

| variavel | de onde vem |
| --- | --- |
| `AUTH_SECRET` | o mesmo do gateway — e ele que valida o ticket |
| `DATABASE_URL` | Supabase, com `connection_limit=5` |
| `DIRECT_URL` | conexao direta (porta 5432) |
| `NEXT_PUBLIC_REALTIME_URL` | endereco do gateway no Fly |

`NEXT_PUBLIC_APP_URL` **nao** entra aqui: o app web nao a usa. Quem le essa
variavel e o gateway, para saber qual origem liberar no CORS.

---

## Como o login atravessa dois dominios

O app fica em `.vercel.app` e o gateway em `.fly.dev` — **sites diferentes**.
O navegador nao envia um cookie `SameSite=Lax` para outro site, entao o
handshake nao pode depender do cookie de sessao.

A solucao e o **ticket**: antes de abrir o socket, o app emite um token curto
(5 minutos), de uso unico, com publico proprio (`aether-socket`). O gateway
verifica a assinatura, consome o `jti` uma unica vez e **ainda assim revalida a
linha `Session` no banco** — revogar login continua derrubando o acesso.

A alternativa seria afrouxar o cookie para `SameSite=None`, o que jogaria fora
a protecao contra CSRF da aplicacao inteira para resolver um unico endpoint.

Em desenvolvimento o cookie continua funcionando, porque `localhost:3000` e
`localhost:4000` sao o mesmo site.

---

## Ordem do primeiro deploy

1. Suba o gateway e anote a URL.
2. Suba a web com `NEXT_PUBLIC_REALTIME_URL` apontando para ela.
3. Volte no Fly e ajuste `NEXT_PUBLIC_APP_URL` para a URL real da Vercel
   (`fly secrets set` reinicia a maquina sozinho).

Sem o passo 3 o CORS do gateway aponta para o lugar errado e toda conexao e
recusada.

---

## Estado atual (verificado)

| peca | endereco |
| --- | --- |
| App web | https://aether-mocha-phi.vercel.app |
| Gateway | https://aether-gateway-earnest-dew-229.fly.dev |

Use sempre o endereco **aliased** da Vercel, nao o do deploy especifico
(`aether-<hash>-...`): o segundo muda a cada `vercel --prod` e quebraria o CORS
do gateway toda vez.

Verificado contra producao: verify-phase3 42/42, verify-phase4 17/17, CORS
liberando a origem certa com credenciais, sessao valida atravessando Vercel e
Fly, e o bundle apontando para o gateway (nenhuma ocorrencia de localhost).

---

## Verificacao

Com as URLs de producao:

```bash
VERIFY_BASE_URL="https://SEU-APP.vercel.app" VERIFY_REALTIME_URL="https://aether-gateway.fly.dev" npx dotenv -e .env -- node scripts/verify-phase3.mjs
```

Os scripts falam HTTP e WebSocket reais, entao servem para producao tambem —
mas eles **escrevem no banco** (criam sessoes e mensagens de teste, e limpam
depois). Aponte para o banco de producao com essa consciencia.

---

## Uma maquina, sempre

O `fly deploy` sobe DUAS maquinas por padrao quando a organizacao tem metodo
de pagamento (alta disponibilidade). Para este servico isso quebra:

- presenca, ocupacao de voz e rate limit vivem na memoria do processo;
- com duas maquinas o balanceador divide as conexoes e existem dois universos
  de presenca — quem cai na maquina A nao ve quem caiu na B;
- e falha de forma INTERMITENTE, porque as vezes os dois caem na mesma.

Depois de qualquer deploy que recrie maquinas, confira e corrija:

```bash
fly status
```

```bash
fly scale count 1
```

---

## Limitacoes conhecidas deste deploy

- **Uma instancia de gateway, sem hibernar.** Presenca, ocupacao de voz e rate
  limit vivem na memoria do processo: uma segunda maquina criaria dois
  universos de presenca, e deixar a maquina dormir apagaria quem esta online.
  Escalar horizontalmente exige o adapter de Redis do Socket.IO.
- **O gateway roda por `tsx` em producao.** Funciona, mas compilar para
  JavaScript deixaria a imagem menor e o boot mais rapido.
- **A imagem instala o workspace inteiro**, inclusive o app web que ela nao
  executa. Desperdicio de espaco, nao de correcao.
- **Sem CI.** Os `verify-phase*.mjs` sao rodados a mao.
- **Sem dominio proprio.** Os enderecos `.vercel.app` e `.fly.dev` funcionam;
  trocar por um dominio depois nao exige mudanca de codigo, so das variaveis.
