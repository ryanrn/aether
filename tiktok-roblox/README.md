# Ponte TikTok LIVE -> Roblox

Le os comentarios de uma live do TikTok em tempo real e transforma cada um em
acao dentro de uma experiencia do Roblox. O espectador comenta, o boneco dele
aparece no mapa com o `@` na cabeca, e o ciclo se fecha sozinho: ele se ve,
comenta de novo, e outra pessoa quer o mesmo.

O jogo roda sem ninguem no teclado.

```
  TikTok LIVE
      |  websocket (tiktok-live-connector)
      v
  +-----------------------------------------------+
  |  PONTE (Node, roda na sua maquina)            |
  |  comentario -> palavra-chave -> acao          |
  |  dedupe . limite por pessoa . limite global   |
  |  fila com cursor e prazo de validade          |
  +-----------------------------------------------+
      |  HTTP long polling (o Roblox pergunta)
      v
  +-----------------------------------------------+
  |  ROBLOX (script de servidor)                  |
  |  kind -> funcao no mapa                       |
  |  bonecos com teto, prazo e despejo            |
  +-----------------------------------------------+
      |
      v
  OBS -> TikTok LIVE Studio
```

---

## Por que o desenho e este

Quatro decisoes que mudam o resultado e nao sao obvias:

**O Roblox pergunta; a ponte nao empurra.** Um servidor de jogo do Roblox nao
tem endereco publico e nao aceita conexao de fora. O `HttpService` so sabe
fazer requisicao de saida. Entao quem pergunta e o jogo — e o jeito de isso
nao virar latencia e o **long polling**: o Roblox pede com `wait=20000` e a
ponte segura a resposta ate ter comentario novo. Latencia de milissegundos
gastando ~3 requisicoes por minuto, dentro do limite de 500/min por servidor.

**A fila tem cursor, nao tem `pop`.** O Roblox diz "ja processei ate a acao
128". Se uma resposta HTTP se perder no caminho — e ela se perde: tunel, wi-fi,
servidor do Roblox migrando de datacenter — nada foi consumido, e a proxima
volta busca de novo. Com `pop`, a acao ja teria saido da fila e ninguem mais a
veria.

**Acao vence.** Nada com mais de 45 segundos e entregue. Se o jogo ficar tres
minutos fora do ar, despejar tres minutos de comentario de uma vez trava o
servidor e mostra reacao a um assunto que a live ja deixou para tras. Perder e
melhor que atrasar.

**As palavras-chave moram na ponte, os efeitos moram no jogo.** Trocar "pular"
por "pula" e salvar um arquivo. Se a tabela de palavras estivesse no Luau,
seria republicar o jogo — o que derruba o servidor no meio da transmissao.

---

# Parte 1 — o middleware (Node)

## Instalar

Precisa de **Node 22.18 ou mais novo** (ele executa TypeScript direto, sem
compilar).

```bash
cd tiktok-roblox
npm install
cp .env.example .env
cp games.example.json games.json
```

Edite o `games.json` (a proxima secao explica cada campo) e suba:

```bash
npm start          # conecta na live de verdade
npm run sim        # comentarios falsos, sem live e sem live no ar
```

O `npm run sim` e o modo em que voce vai passar a maior parte do tempo de
desenvolvimento: ele entrega ao Roblox exatamente o mesmo JSON que a live
entregaria, sem voce precisar abrir uma transmissao para testar se a bomba
explode no lugar certo.

## Como adicionar os jogos

Um "jogo" aqui e **um place do Roblox** ligado a **uma conta do TikTok**. Tudo
mora no `games.json`:

```json
{
  "games": [
    {
      "id": "obby",
      "name": "Obby da Live",
      "key": "cole-aqui-uma-chave-longa-e-aleatoria",
      "tiktok": "@seu_usuario",
      "profile": "default",
      "spawnOnAnyComment": true,
      "universeId": null
    },
    {
      "id": "arena",
      "name": "Arena PVP",
      "key": "outra-chave-completamente-diferente",
      "tiktok": "@seu_usuario",
      "profile": "default",
      "spawnOnAnyComment": false
    }
  ]
}
```

| campo | o que faz |
| --- | --- |
| `id` | entra na URL (`/v1/games/<id>/pull`). So `a-z`, `0-9`, `-` e `_`. |
| `key` | segredo compartilhado com o script do Roblox. Minimo 12 caracteres. **Uma por jogo** — chave repetida faz um jogo ler a fila do outro. |
| `tiktok` | a conta cuja live alimenta este jogo. |
| `profile` | conjunto de palavras-chave. Hoje so existe `default`. |
| `spawnOnAnyComment` | `true` faz qualquer comentario invocar o boneco de quem falou. E o que fecha o ciclo de engajamento; `false` deixa so quem sabe as palavras participar. |
| `universeId` | opcional, so para a campainha via Open Cloud (veja "latencia" adiante). |

Para gerar uma chave decente:

```bash
node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"
```

**Depois de salvar, nao reinicie nada.** O arquivo recarrega sozinho. Isso nao
e conveniencia: reiniciar derruba a conexao com o TikTok, e reconectar durante
a live esbarra no limite de taxa deles. Se o JSON estiver quebrado, a ponte
avisa no terminal e continua valendo a versao anterior.

Casos que isso resolve:

- **varios jogos, uma live** — cada place tem seu `id` e sua chave, e todos
  recebem os mesmos comentarios. Util para rodar uma versao nova em paralelo
  com a que esta no ar.
- **varias lives, uma ponte** — `tiktok` diferentes; a ponte abre uma conexao
  por conta e nao duas para a mesma (abrir duas so acelera o limite de taxa).
- **trocar a chave no meio da live** — salve o arquivo e atualize o Config no
  Studio. A fila do jogo nao e zerada.

## A API

Tudo pede a chave no header `x-bridge-key`.

```
GET  /                          estado em texto (sem segredo)
GET  /health                    o mesmo em JSON
GET  /v1/games/:id/pull         a fila:  ?since=<cursor>&max=40&wait=20000
POST /v1/games/:id/heartbeat    o jogo avisando que esta vivo
```

Resposta do `pull`:

```json
{
  "ok": true,
  "agora": 1788031325909,
  "cursor": 128,
  "perdidas": 0,
  "fila": 4,
  "acoes": [
    {
      "seq": 128,
      "at": 1788031325124,
      "kind": "jump",
      "keyword": "pular",
      "source": "chat",
      "viewer": {
        "id": "tiktok:7123456789",
        "handle": "fulano",
        "nickname": "Fulano",
        "avatarUrl": "https://...",
        "robloxUserId": null
      },
      "params": { "text": "pular" }
    }
  ]
}
```

**Chave errada e jogo inexistente respondem a mesma coisa: 404.** E a regra do
projeto — nao confirmamos a existencia de um recurso para quem nao tem acesso a
ele. Quem varrer a internet atras do seu tunel nao descobre nem que o jogo
existe.

---

# Parte 2 — o Roblox (Luau)

## Ligar o HttpService (obrigatorio)

Sem isto, o script lanca erro na primeira linha util:

- **Studio -> Home -> Game Settings -> Security -> Allow HTTP Requests**

ou, mais rapido, na barra de comandos (`View -> Command Bar`):

```lua
game:GetService("HttpService").HttpEnabled = true
```

Duas coisas que poupam meia hora de confusao:

1. **HttpService so funciona em script de SERVIDOR.** LocalScript nao faz
   requisicao HTTP no Roblox, e nao existe configuracao que libere.
2. **O Roblox se recusa a chamar dominios `roblox.com`.** E por isso que quem
   resolve nome de usuario do Roblox para `userId` e a ponte, nao o jogo.

## Instalar os scripts

**Com Rojo** (recomendado — o codigo fica versionado neste repositorio):

```bash
rojo serve tiktok-roblox/roblox/default.project.json
```

e, no Studio, o plugin do Rojo -> Connect.

**Sem Rojo**, arrastando a mao no Explorer:

| arquivo | vai em |
| --- | --- |
| `TikTokBridge.server.luau` | `ServerScriptService` (Script) |
| `Config.luau`, `Bridge.luau`, `Filter.luau`, `ActorPool.luau`, `Effects.luau`, `Actions.luau` | `ServerStorage/TikTok` (ModuleScript, pasta chamada `TikTok`) |
| `AntiAfk.client.luau` | `StarterPlayer/StarterPlayerScripts` (LocalScript) |

O `BindableEvent` e o `RemoteEvent` sao criados pelo proprio script — nao ha
instancia para esquecer.

## Configurar

Em `ServerStorage/TikTok/Config.luau`:

```lua
Config.baseUrl = "http://localhost:8080"   -- Studio; publicado precisa de tunel
Config.gameId  = "obby"                    -- o mesmo id do games.json
Config.key     = "a-chave-do-games.json"   -- so para desenvolvimento
```

Em jogo **publicado**, tire a chave do arquivo e use o Secrets Store: Creator
Dashboard -> a experiencia -> Configuracoes -> Secrets, nome
`tiktok_bridge_key`. O `Config.resolveKey()` le de la sozinho, e o valor nunca
aparece em log — a Roblox censura. (O `Secret` so pode ser usado em header de
`RequestAsync`; e mais um motivo para nao ligar `Config.useGetAsync`.)

## Os comandos

| o espectador digita | acontece |
| --- | --- |
| `entrar`, `eu`, `join`, `aparecer` | o boneco dele aparece com `@nome` na cabeca |
| `pular`, `pula`, `jump` | o boneco pula |
| `bomba`, `boom`, `explodir` | explosao inofensiva (empurra, nao machuca) |
| `bola`, `esfera` | esfera com fisica e o nome dele |
| `foguete`, `voar` | o boneco sobe |
| `dancar`, `danca` | emote (ou pulinhos, se a animacao nao carregar) |
| `correr` | sai correndo por alguns segundos |
| `gigante` | cresce por 10 segundos |
| `cor vermelho` | pinta o boneco |
| `sumir`, `sair` | tira o boneco do mapa |
| `roblox <usuario>` | invoca o **avatar real** dessa conta do Roblox |
| presente | confete proporcional aos diamantes |
| like | brilho, se a pessoa ja tem boneco |
| seguir / compartilhar | confete grande |

Com `spawnOnAnyComment: true`, **qualquer** comentario ja invoca o boneco.

Para criar um comando novo sao duas linhas em dois arquivos:

1. `server/src/commands.ts` — a palavra (`{ kind: "chuva", keywords: ["chuva"] }`)
2. `roblox/src/ServerStorage/TikTok/Actions.luau` — o efeito (`handlers.chuva = function(action, ctx) ... end`)

Se so um dos dois existir nada quebra: ou a palavra nao casa, ou a acao chega e
e ignorada com um aviso no Output.

## Plugar no seu jogo

O script dispara dois eventos que o resto do seu jogo pode ouvir:

```lua
-- servidor -> servidor: a mecanica do SEU jogo reage sem conhecer a ponte
local actionEvent = game:GetService("ServerStorage").TikTok.ActionEvent
actionEvent.Event:Connect(function(action)
    if action.kind == "gift" then
        abrirPortaSecreta()
    end
end)

-- servidor -> cliente: interface, som, contador na tela
local feed = game:GetService("ReplicatedStorage").TikTokFeed
feed.OnClientEvent:Connect(function(action)
    mostrarNaTela("@" .. action.viewer.handle .. " " .. action.kind)
end)
```

O cliente so **recebe**. Cliente que pudesse disparar acao seria uma porta
aberta: quem manda comando aqui e a live, nao o jogador.

---

# Ambiente local e latencia

## No Studio (desenvolvimento)

O Studio roda na **sua** maquina, entao `http://localhost:8080` alcanca a ponte
direto. Latencia: milissegundos. Nao precisa de tunel, nao precisa publicar.

```bash
# terminal 1
cd tiktok-roblox && npm run sim

# terminal 2 (opcional, para ver a fila)
curl -H "x-bridge-key: SUA-CHAVE" "http://localhost:8080/v1/games/obby/pull?since=0"
```

No Studio: F5 (Play). O Output mostra `[TikTok] ligando em http://localhost:8080`
e os bonecos comecam a cair.

## Em jogo publicado (a live de verdade)

**`localhost` nao funciona.** O servidor do jogo esta num datacenter da Roblox;
`localhost` la e a maquina de la. Voce precisa expor a ponte com um endereco
publico:

```bash
# opcao 1 — cloudflared (nao pede cadastro para um tunel rapido)
cloudflared tunnel --url http://localhost:8080

# opcao 2 — ngrok
ngrok http 8080
```

Copie a URL `https://...` que aparecer para `Config.baseUrl` e publique o jogo.

Sobre a latencia: o caminho fica **TikTok -> sua maquina -> tunel -> datacenter
da Roblox**. Na pratica, do comentario ao boneco aparecer da algo entre 300ms e
1,5s, dominado pelo proprio TikTok e pela distancia ate o servidor do jogo. O
long polling ja tira a espera de fila da conta; o resto e rede.

Duas coisas ajudam de verdade:

- **Servidor privado com regiao fixa.** Servidor sorteado do outro lado do
  mundo custa mais que qualquer otimizacao daqui.
- **`universeId` + `ROBLOX_OPEN_CLOUD_KEY`** (opcional). Liga uma campainha via
  MessagingService. Ela **nao** carrega a acao — so avisa "tem coisa nova" — e
  so serve se voce baixar `Config.longPollMs` para `0`. Com long polling
  ligado, ela nao acrescenta nada, porque a resposta ja volta no instante em
  que o comentario chega. Nao funciona no Studio.

## Anti-inatividade (o jogo rodando sozinho)

A Roblox desconecta quem fica ~20 minutos sem enviar entrada. **Duas camadas**,
e vale saber o que cada uma garante:

**Dentro do jogo** (`AntiAfk.client.luau`): reage ao evento `Player.Idled`,
tenta o `VirtualUser` dentro de `pcall` e faz micro-movimento e um giro
minusculo de camera a cada 2 minutos. So mexe no personagem do host — visitante
nao tem o personagem controlado por script.

**No sistema operacional** (`host/anti-afk-windows.ahk`,
`host/anti-afk-linux.sh`): manda uma tecla de camera (`,` e `.`, que giram a
visao e nada mais) para a janela do Roblox de tempos em tempos.

A segunda e a que **garante**. O contador de inatividade e alimentado por
entrada de usuario lida pelo cliente da Roblox; mover o personagem por codigo
nao alimenta esse contador, e o `VirtualUser` pode ser barrado por nivel de
seguranca dependendo do contexto — o script registra no console qual dos dois
casos e o seu. Deixe o script do sistema rodando junto com o OBS.

## Levar a imagem para o TikTok (o OBS e opcional)

Alguma coisa precisa capturar a tela e mandar video — nao existe caminho com
zero software. O que nao precisa e ser o OBS.

**1. TikTok LIVE Studio sozinho** (Windows). E o app oficial da propria TikTok e
ele ja captura janela ou jogo e transmite. Caminho mais curto: sem OBS, sem
chave RTMP, sem passo intermediario. E o que eu recomendo para comecar.

**2. Pelo celular.** Roblox no celular e a LIVE aberta pelo app da TikTok. Se a
sua versao do app oferecer compartilhamento de tela na LIVE, da para transmitir
sem PC nenhum na captura. Aqui a ponte **precisa** de tunel, porque o jogo esta
publicado (veja a secao anterior).

**3. Qualquer outro encoder com chave RTMP** — Streamlabs, XSplit, vMix, ffmpeg.
A TikTok entrega a chave para contas elegiveis; e a mesma ideia do OBS, so que
com outro programa.

**Quando o OBS passa a valer a pena:** cena com a lista de comandos na tela,
alerta de presente, contador de espectadores, varias fontes ao mesmo tempo — e
macOS/Linux, ja que o LIVE Studio e so Windows.

O jogo nao sabe da existencia de nenhum deles. Para o Roblox e uma sessao comum
com um jogador.

**Enquadramento.** A TikTok e 9:16. O jeito pratico e capturar a janela do
Roblox em 16:9 e deixar o LIVE Studio (ou o OBS) cortar para vertical — perde as
laterais. A alternativa e redimensionar a janela do Roblox para uma proporcao
alta: nao corta nada, mas o campo de visao encolhe. Vale ajustar
`Config.spawnRadius` junto, para os bonecos nascerem dentro do que aparece.

---

# Passo a passo da primeira live

A ordem importa: cada etapa termina num ponto onde da para conferir que
funcionou antes de seguir. Nao pule para a etapa 5 no primeiro dia.

## Etapa 0 — o que precisa existir antes

- **Node 22.18+** na maquina (`node -v`).
- **Roblox Studio** e uma experiencia sua (pode ser um baseplate vazio).
- **Conta do TikTok com permissao de LIVE.** Hoje a exigencia e da ordem de mil
  seguidores e maioridade, e a TikTok mexe nisso de tempos em tempos — confira
  no proprio app antes de contar com a data.
- Windows, se voce for pelo caminho do LIVE Studio.

## Etapa 1 — ponte no ar, sem live nenhuma

```bash
cd tiktok-roblox
npm install
cp .env.example .env
cp games.example.json games.json

# gere uma chave de verdade e cole no games.json
node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"
```

No `games.json`: troque `key` pela chave gerada e `tiktok` pelo seu @. O `id`
pode ficar `obby`.

```bash
node verify.mjs    # 57 verificacoes; se falhar aqui, nao adianta seguir
npm run sim        # comentarios falsos
```

**Confira:** abra `http://localhost:8080` no navegador. Tem que aparecer
`@seu_usuario: connected`. Se o terminal reclamar da chave, e porque o
`games.json` ainda esta com a do exemplo — e proposital.

## Etapa 2 — o jogo respondendo, ainda com comentario falso

1. Copie os scripts para o Studio (Rojo ou a mao — veja "Instalar os scripts").
2. **Ligue o HttpService**: Game Settings -> Security -> Allow HTTP Requests.
3. Em `Config.luau`: `gameId` igual ao do `games.json`, `key` igual a chave, e
   `baseUrl` em `http://localhost:8080`.
4. F5 no Studio.

**Confira:** o Output mostra `[TikTok] ligando em http://localhost:8080` e em
segundos comecam a cair bonecos com nomes falsos. Se aparecer erro de
HttpService, volte ao passo 2. Se aparecer `HTTP 404`, a chave ou o `gameId`
estao diferentes dos dois lados.

Esta etapa e a que mais importa: ela valida o sistema inteiro **sem voce estar
ao vivo**. Nao va para a proxima antes daqui funcionar.

## Etapa 3 — a live de verdade, ainda pelo Studio

Pare o `npm run sim` e suba a ponte no modo real:

```bash
npm start
```

**Pode subir antes de ficar ao vivo.** Enquanto a live nao existe, a ponte
tenta de novo com espera crescente e escreve o motivo no terminal; no instante
em que voce abrir a transmissao, ela conecta sozinha.

Agora abra a LIVE no TikTok, deixe o Studio rodando (F5) e comente
`entrar` voce mesmo — comentario do host tambem e evento de chat. Seu boneco
tem que aparecer.

**Confira:** `http://localhost:8080/health` mostra `estado: connected` e o
contador de `aceitas` subindo.

Para uma primeira live curta, isso ja basta e **nao precisa de tunel**: o Studio
roda na sua maquina, entao `localhost` alcanca a ponte. O Studio nao foi feito
para ficar horas de pe, entao para live longa siga para a etapa 4.

## Etapa 4 — jogo publicado (para live longa)

1. Publique a experiencia.
2. Abra o tunel: `cloudflared tunnel --url http://localhost:8080`.
3. Cole a URL `https://...` em `Config.baseUrl` e publique de novo.
4. Tire a chave do `Config.luau` e ponha no Secrets Store, com o nome
   `tiktok_bridge_key`.
5. Entre por um **servidor privado**, para a live nao depender de qual servidor
   o sorteio te dá e para a regiao ficar fixa.

**Confira:** o Output do jogo publicado mostra as mesmas linhas da etapa 2. Se
der erro de rede, o `baseUrl` provavelmente ficou em `localhost` — que no jogo
publicado aponta para o datacenter da Roblox, nao para o seu PC.

## Etapa 5 — anti-inatividade e captura

1. Rode o script do sistema: `host/anti-afk-windows.ahk` (clique duplo, com o
   AutoHotkey v2 instalado) ou `host/anti-afk-linux.sh`. **Sem ele, conte com a
   desconexao em ~20 minutos.**
2. Abra o TikTok LIVE Studio, escolha a janela do Roblox como fonte e ajuste o
   corte para vertical. (Ou o OBS, se quiser sobreposicoes.)
3. Comece a transmitir.

## Etapa 6 — durante a live

- **Fixe um comentario com a lista de comandos.** Sem isso, so quem ja conhece
  participa — e com `spawnOnAnyComment: true` qualquer comentario ja invoca o
  boneco, o que puxa o resto.
- Deixe `http://localhost:8080/health` aberto numa aba: `aceitas`, `recusadas`,
  `fila` e `ultimoSinalDeVidaMs`. Se o sinal de vida parar de atualizar, o jogo
  caiu (e o anti-AFK falhou) mesmo que a imagem ainda pareca viva.
- `recusadas` subindo muito e sinal de que os limites estao apertados demais
  para o tamanho da sua live: mexa em `VIEWER_RATE_*` e `GLOBAL_RATE_PER_SEC`
  no `.env`.
- Precisou trocar alguma coisa no `games.json`? Salve e pronto — recarrega
  sozinho, sem derrubar a conexao com o TikTok.

---

# Como testar

```bash
cd tiktok-roblox
node verify.mjs
```

57 verificacoes, sem live, sem `npm install` e sem o Roblox aberto. Ela sobe o
processo de verdade e fala HTTP com ele. Cobre:

- dicionario (acento, prefixo, argumento, comentario solto, presente)
- fila (cursor sem repeticao, prazo, capacidade, descarte reportado, cursor de
  outra encarnacao da ponte)
- long polling (acorda na acao nova; respeita o teto; teto do servidor vence o
  pedido do cliente)
- limites (balde por pessoa, dedupe, cooldown por comando)
- API (404 identico para chave errada e jogo inexistente, chave de um jogo nao
  abre o outro, lote limitado, heartbeat, `/health` sem vazar chave)

Tipos:

```bash
npx tsc --noEmit
```

Teste de ponta a ponta com o Studio: `npm run sim`, F5 no Studio, e voce ve os
bonecos caindo com nomes falsos. Para testar com a live real sem publicar o
jogo, basta `npm start` — o Studio alcanca `localhost` normalmente.

---

# Limitacoes conhecidas

Escritas com honestidade, como manda o processo do projeto.

**A conexao com o TikTok e nao-oficial.** O `tiktok-live-connector` le o
protocolo do site. Nao ha contrato: mudanca do lado deles quebra a conexao sem
aviso. O ponto onde isso aparece esta isolado em `sources/tiktok.ts`, e a
leitura dos campos e defensiva (`content` ou `comment`, `displayId` ou
`uniqueId`) — mas isolar nao e imunizar.

**Live cheia precisa de chave de assinatura.** Sem `TIKTOK_SIGN_API_KEY`
(EulerStream), a conexao usa o servidor de assinatura publico, que tem limite
baixo e derruba a conexao em live com muita gente.

**Tudo mora na memoria.** Fila, vinculos de conta e limites somem se o processo
cair. E deliberado: replay de comentario velho seria pior que perder. Nao ha
persistencia e nao ha ponte redundante — se ela cai, o jogo fica sem acao ate
voltar (e volta sozinho, com backoff).

**Uma instancia.** Os limites por pessoa vivem no processo. Duas pontes
atendendo a mesma live dobrariam o limite de cada espectador. Escalar
horizontalmente pediria Redis — mesma divida do rate limit do Aether.

**O anti-AFK de dentro do jogo nao garante nada sozinho.** Explicado acima. Sem
o script do sistema operacional rodando, conte com a desconexao.

**A escala de "gigante" so funciona em R15.** Em R6 os `NumberValue` de escala
nao existem; a acao chega e nao faz nada, sem erro.

**A animacao de "dancar" depende de asset publico.** `rbxassetid://507771019` e
o padrao; se a Roblox recusar carregar, o `Actions.luau` cai em tres pulinhos.
Trocar por uma animacao sua e uma linha no `Config`.

**Like nao invoca boneco.** Uma live media manda milhares deles; cada um virando
um `Humanoid` novo derruba o servidor em minutos. Like so brilha em quem ja
esta no mapa.

**O filtro de texto atribui tudo ao host.** O `TextService` exige o `userId` de
alguem presente na experiencia, e quem comentou esta no TikTok. Usamos o dono da
live. Se o filtro falhar, o texto vira "espectador" — falha fechada, de
proposito.

**Nao ha painel.** O acompanhamento e o terminal e o `GET /health`. Uma tela
web em cima do `/health` seria util e nao foi feita.

**O `verify.mjs` nao cobre o lado Luau.** Nao ha runtime de Roblox aqui: o
script cobre a ponte inteira e o contrato HTTP; o comportamento dentro do jogo
foi escrito para ser lido, e precisa ser testado no Studio.

**Automatizar entrada e area cinzenta.** Os scripts de `host/` existem para
manter a SUA sessao viva na SUA experiencia. Usar isso para farmar recompensa ou
em conta de terceiro e outra conversa, e nao e para isso que eles estao aqui.
