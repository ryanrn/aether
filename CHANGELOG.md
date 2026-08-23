# Historico de atualizacoes

Formato pensado para o site: cada versao tem um resumo de uma linha e os itens
agrupados por tipo. O que e limitacao conhecida esta dito como limitacao, e nao
escondido — o [README](README.md) tem o detalhe tecnico de cada uma.

---

## v0.1.4 — 23 de agosto de 2026

**Correcao: jogo com anti-cheat mostrava o icone errado.**

### Correcoes

- **Jogos com Easy Anti-Cheat apareciam com a logo do anti-cheat** em vez da
  do jogo — notado no Fall Guys. O anti-cheat sobe antes do jogo, e o icone
  capturado nesse instante ficava preso ate fechar o jogo. Agora o app ignora
  anti-cheat, instaladores e relatores de erro na hora de pegar o icone, e o
  icone se corrige sozinho assim que o jogo termina de abrir.

### Tambem no app (chegou sem precisar reinstalar)

- Layout reestruturado: quatro colunas, controles de voz flutuando no centro
- Cores novas, mais calmas
- Clicar no seu nome abre um cartao com a call e quem esta nela
- Status: Disponivel, Ausente, Nao perturbe e Invisivel

---

## v0.1.3 — 23 de agosto de 2026

**O app passa a se atualizar sozinho.**

### Novidades

- **Atualizacao automatica.** O app verifica se ha versao nova, baixa em
  segundo plano e avisa quando estiver pronta. Voce escolhe a hora de
  reiniciar — nada te tira de uma call no meio, e quem deixar para depois
  recebe a atualizacao no proximo fechamento.

  **Esta e a ultima vez que voce precisa baixar o instalador na mao.** Quem
  estiver na 0.1.2 ou anterior instala esta uma vez; dali em diante e sozinho.

### Limitacoes desta versao

- **So Windows.** macOS e Linux precisariam ser compilados em cada sistema.
- O instalador continua sem assinatura digital, entao o Windows mostra "editor
  desconhecido" na primeira execucao.
- Se o GitHub estiver fora do ar ou nao houver internet, a verificacao falha em
  silencio e o app funciona normalmente — atualizar nunca atrapalha quem so
  quer conversar.

---

## v0.1.2 — 22 de agosto de 2026

**AETHER Activity: veja o que cada pessoa esta fazendo, sem perguntar.**

### Novidades

- **Deteccao de jogo.** O app percebe quando voce abre um jogo da **Steam ou
  da Epic Games** e mostra "Jogando Grand Theft Auto V" no seu cartao, com o
  tempo de sessao — **com o icone do jogo**, lido do proprio arquivo do jogo,
  sem consultar nada na internet. Funciona com qualquer jogo dessas lojas, sem
  precisar cadastrar nada — inclusive os que voce instalar depois.

  **Vem desligada.** Voce liga em Configuracoes > Atividade. A leitura acontece
  so no seu computador: o servidor recebe apenas o nome do jogo, nunca a lista
  dos seus programas.

- **Aba "Atividade" propria.** A opcao de mostrar o jogo saiu de "Voz e video",
  onde nao tinha nada a ver com microfone. A aba nova mostra tambem qual jogo
  foi detectado agora, para voce conferir que esta funcionando.

- **Fonte nova.** A interface passou a usar Rubik — moderna e desenhada para
  ser lida em tamanho pequeno, que e o que este app mais tem. A marca AETHER
  ganhou uma fonte propria, angular.

- **Cartao de atividade.** Clique em alguem — na arvore de canais ou na lista
  de membros — e veja num cartao: se esta online, em qual canal de voz esta, em
  qual servidor, quantas pessoas dividem o canal e ha quanto tempo esta ali.
- **Estado ao vivo.** O cartao mostra "Em chamada", "Falando" ou "Compartilhando
  a tela", com os indicadores de mudo e surdo. Ele se atualiza sozinho enquanto
  esta aberto: se a pessoa mutar ou comecar a transmitir, muda na hora.
- **Relogio da atividade.** Conta ha quanto tempo a pessoa esta no canal, com o
  horario carimbado pelo servidor. Trocar de canal reinicia a contagem; uma
  queda de conexao nao.
- **Entrar no canal com um clique.** Se a pessoa esta num canal de voz e voce
  nao, o cartao oferece o botao para entrar junto.
- **Apelido em destaque.** Quem tem apelido no servidor aparece com ele, e o
  nome real fica visivel logo abaixo.

### Limitacoes desta versao

- **A deteccao de jogo pega Steam e Epic.** GOG, Battle.net, Xbox e jogos
  avulsos ainda nao aparecem.
- **Deteccao de jogo so no app de desktop**, e so no Windows: o navegador nao
  consegue ver os programas abertos.
- **O icone e o do programa, nao a arte de capa.** A capa que outros apps
  mostram vem do catalogo de imagens deles; aqui o icone sai do proprio
  executavel, em 48x48.
- **Sem detalhes de dentro do jogo** (placar, fase, grupo). Mostrar isso
  exigiria que cada jogo conversasse com o AETHER de proposito.
- A deteccao verifica a cada 15 segundos, entao abrir ou fechar um jogo leva
  ate 15 segundos para refletir.
- Nao mostra "assistindo a transmissao de alguem": ninguem rastreia quem esta
  olhando qual tela — apenas quem publica.
- Nao ha status personalizado nem musica. Fica para depois.
- Reiniciar o servidor de tempo real zera o relogio e o jogo de todo mundo,
  porque presenca e voz vivem em memoria.

---

## v0.1.1 — 22 de agosto de 2026

**Audio: escolher para onde o som vai, e parar de brigar com o som que sai.**

### Novidades

- **Seletor de alto-falante.** Em Configuracoes > Voz e video agora da para
  escolher por qual dispositivo voce ouve os outros e o som das transmissoes.
  A troca vale na hora, no meio da call, sem derrubar ninguem.
- **Tela de configuracoes do proprio app.** Antes havia duas engrenagens que
  faziam a mesma coisa (as duas abriam as configuracoes do SERVIDOR) e nenhuma
  para voce. Agora a de cima e do servidor; a de baixo, ao lado do seu nome, e
  sua — com "Minha conta" e "Voz e video".
- **Teste de microfone.** Botao para falar e ver a barra de nivel se mexer, sem
  precisar entrar numa call e perguntar para alguem se esta funcionando. O som
  do teste nao sai da sua maquina.
- **Escolha de microfone** tambem na tela de configuracoes, alem do menu que ja
  existia na barra de baixo.

### Correcoes

- **Compartilhar tela nao trava mais quando o som do sistema falha.** Em
  algumas maquinas o Windows recusa abrir a captura de som — e como o pedido de
  tela e tudo-ou-nada, a tela tambem nao ia. Agora o app percebe, desliga o som
  sozinho e avisa: e so clicar de novo que a tela vai normalmente.
- **A janela de configuracoes deixou de cortar o conteudo.** Estava estreita
  demais, com barra de rolagem lateral e botao de "Remover" cortado pela metade.

### Limitacoes desta versao

- **Som do sistema em fone sem fio ainda falha.** O Windows so deixa capturar o
  som da saida que ele considera PADRAO, e alguns dispositivos sem fio nao
  abrem para captura. Verificado: um Logitech PRO X2 funciona ligado no cabo
  P2 e falha no receptor USB sem fio. O contorno e trocar a saida padrao do
  Windows para o dispositivo com fio ou onboard antes de compartilhar. O
  seletor de alto-falante do app NAO resolve isso — ele decide para onde voce
  OUVE, nao de onde o som e capturado para enviar.
- O seletor de alto-falante nao funciona no Firefox, que nao tem a API. A tela
  avisa em vez de fingir que funcionou.
- O app ainda nao se atualiza sozinho: correcoes do site chegam sozinhas, mas
  uma versao nova do programa em si pede baixar o instalador de novo.
- O instalador nao e assinado, entao o Windows mostra "editor desconhecido" na
  primeira execucao.

---

## v0.1.0 — 22 de agosto de 2026

**Primeira versao.**

- Comunicacao por voz
- Canais de voz
- Compartilhamento de tela
- Chat de texto
- Servidores
- Presenca de usuarios
- Administracao
- Moderacao
