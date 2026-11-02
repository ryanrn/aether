# Detecção de jogos

## Como o Discord faz

1. **Detecção automática.** O app desktop percebe o jogo aberto e mostra
   "Jogando X" no perfil e na lista de membros. Funciona só no desktop:
   navegador e celular não têm a lista de jogos registrados nem o overlay
   [terceiros: [guia de detecção](https://www.guidingtech.com/fix-discord-game-detection-not-working-windows/),
   [golinuxcloud](https://www.golinuxcloud.com/add-games-to-discord/)].
2. **Jogos registrados.** Em Configurações → Jogos registrados, a pessoa vê o
   que foi detectado e usa "Adicione!" para escolher um programa aberto que não
   foi reconhecido. **Vale na hora, só para ela**, e some do perfil quando o
   programa fecha [terceiros: [itgeared](https://www.itgeared.com/how-to-show-what-you-are-playing-on-discord)].
   Os guias recomendam escolher o processo do jogo, e não o do launcher.
3. **Detecção, nome e overlay são coisas separadas.** Um jogo pode aparecer no
   status e o overlay não funcionar; adicionar à mão corrige o nome, mas não
   cria Rich Presence [terceiros: guia de detecção].
4. **Rich Presence** é o jogo contar ao Discord o que está acontecendo dentro
   dele: texto do que a pessoa faz (fase, mapa), tempo de partida, tamanho do
   grupo, imagens e um botão "Entrar" para amigos [oficial:
   [Rich Presence](https://docs.discord.com/developers/rich-presence/overview)].
   Vem pelo SDK do Discord, integrado pelo próprio jogo.
5. **O formato de uma atividade** [oficial:
   [Activity Object](https://docs.discord.com/developers/events/gateway-events)]:
   - tipos: Jogando, Transmitindo, Ouvindo, Assistindo, Status personalizado,
     Competindo;
   - campos: nome, início e fim, detalhes, estado, grupo (`[atual, máximo]`),
     imagens grande e pequena, até **2 botões**;
   - o cliente pode mudar a atividade no máximo **5 vezes a cada 20 s**.
6. **De onde vem o "este programa é o jogo Y"** não está na documentação
   pública. [Hipótese] o Discord mantém uma lista própria de executáveis
   conhecidos, somada ao que cada pessoa registra. **Não confirmado**, e não
   foi investigado no binário (ver o README desta pasta).

## Como o Aether faz hoje [código]

`apps/desktop/src/game-detect.js` (1.601 linhas), `apps/desktop/src/main.js`,
`apps/web/src/components/settings/adicionar-jogo.tsx`, modelo
`JogoDaComunidade` no schema:

- **Pergunta à loja onde ela instalou**, em vez de manter uma tabela de
  executáveis: Steam (pasta + `appmanifest`), Epic (manifestos JSON), Riot
  (YAML), Ubisoft e GOG (registro), Xbox (pasta), EA (`machine.ini` e config do
  anti-cheat). Cobre qualquer jogo dessas lojas, sem cadastro.
- **Lista da comunidade** (`JogoDaComunidade`: executável → nome), para jogos
  fora de loja, **com revisão da equipe**.
- **Capa pelo IGDB**, ícone tirado do próprio executável, conexão com a Steam.
- **Privacidade bem resolvida:** a lista de processos nunca sai da máquina; só
  o nome do jogo já identificado vai ao servidor.
- **Cargo automático por jogo**, salas de grupo por jogo e "Procurar grupo"
  usam a detecção. **Isso o Discord não tem.**

Na estrutura, o desenho é tão bom quanto o do Discord, e melhor em
privacidade. **O que deixa a experiência ruim são as decisões em volta:**

| Problema | Onde | Efeito para quem usa |
| --- | --- | --- |
| **A detecção começa desligada** | `game-detect.js` ("começa DESLIGADA"), `game-prefs.json` | A maioria nunca liga, e o recurso parece não existir |
| **Adicionar à mão vai para uma fila da equipe** | `adicionar-jogo.tsx` | A pessoa adiciona o jogo e nada acontece até alguém aprovar |
| **Verifica a cada 15 s** | `POLL_MS = 15_000` | Abrir e fechar um jogo leva até 15 s para aparecer |
| **Com dois jogos abertos, mostra um só**, o primeiro em ordem alfabética | README, limitações | O jogo errado aparece |
| **Battle.net e jogos avulsos não são detectados** | README | Overwatch, Diablo, CoD (Battle.net) e indies sem loja não aparecem |
| **GOG e Xbox nunca foram testados** numa instalação real | README | Pode não funcionar e ninguém sabe |
| **Não persiste:** reiniciar o gateway apaga o jogo de todos | README | Some depois de cada deploy |
| **Só Windows** | README | Mac e Linux sem detecção |
| **Sem detalhes de dentro do jogo** (o equivalente ao Rich Presence) | README | Só "Jogando X", sem fase, grupo ou "Entrar" |

## O que fazer [proposta]

Em ordem de impacto por esforço:

1. **Detecção ligada por padrão no desktop**, com aviso claro na primeira vez
   ("o Aether mostra para seus amigos o jogo que você está jogando; desligue em
   Configurações") e o interruptor de compartilhar separado do de detectar,
   como no Discord. A privacidade continua igual: a lista de processos não sai
   da máquina. **Decisão de produto:** ligar por padrão muda a privacidade de
   quem não escolheu.
2. **"Adicionar jogo" vale na hora, para você.** Registro pessoal, guardado no
   desktop (e opcionalmente no perfil), que já detecta no próximo ciclo. A fila
   da comunidade continua existindo, mas como **sugestão para todos**, não como
   condição para você ver o seu jogo.
3. **Ciclo mais rápido sem custo de CPU:** checar a cada 3–5 s só a lista de
   processos (barata) e reler os manifestos das lojas só quando a lista mudar.
4. **Vários jogos:** escolher o que abriu por último, que é o jogo em que a
   pessoa acabou de entrar, em vez do primeiro em ordem alfabética.
5. **Battle.net** (o `product.db` dela guarda a biblioteca) e um teste real
   em GOG e Xbox.
6. **Persistir a atividade no Redis** com prazo curto, para um deploy do
   gateway não apagar o jogo de todo mundo.
7. **Depois, o diferencial:** um "Rich Presence" próprio, uma API local
   pequena no desktop para o jogo (ou um mod) contar fase, grupo e link de
   entrada. Amarra com as salas de grupo por jogo, que o Discord não tem.
