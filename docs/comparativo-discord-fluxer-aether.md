# Comparativo Discord × Fluxer × Aether (02/11/2026)

Junta três fontes:

- **Discord:** documentação pública de desenvolvedor e observação de caixa-preta
  (`docs/discord-research.md`, no PR #11). Nenhum binário do Discord foi
  desempacotado, instrumentado ou automatizado.
- **Fluxer:** leitura do código-fonte, fora do Aether
  ([fluxer-research.md](fluxer-research.md)).
- **Aether:** auditoria do código (`docs/aether-audit.md`, no PR #11) e os PRs
  abertos desde então.

## Legenda

**Discord:**
- **D-doc:** descrito na documentação pública.
- **D-obs:** precisa ser observado usando o app normalmente (lista no fim).

**Fluxer:**
- **F-código:** visto no código, com arquivo citado em `fluxer-research.md`.
- **F-nv:** não verificado.

**Aether:**
- **Validado:** implementado e testado.
- **Parcial:** existe com limitação.
- **Interface:** só a tela, sem a operação real.
- **Ausente:** não existe.
- **No PR:** pronto num PR aberto, sem merge e sem teste ao vivo.

## Mensagens

| Funcionalidade | Discord | Fluxer | Aether | Lacuna principal |
| --- | --- | --- | --- | --- |
| Enviar e receber em tempo real | D-doc | F-código | Validado | — |
| Histórico paginado | D-doc (`before/after/around`, até 100) | F-nv | Validado (cursor) | — |
| Editar | D-doc (só o autor) | F-nv | No PR (#12) | publicar |
| Apagar | D-doc | F-nv | Validado | apagar em massa ausente |
| Responder | D-doc | F-nv | Validado | — |
| Reações | D-doc | F-nv | Validado (Unicode) | emoji personalizado |
| Menções `@pessoa`, `@cargo`, `@everyone` | D-doc | F-código (contador por worker) | No PR (#15) | edição não recalcula; sem `@here` |
| Não lidas que sobrevivem a recarregar | D-obs | F-código (cursor + contador) | No PR (#13); migração já aplicada | publicar |
| Indicador de digitação | D-obs | F-código (10 s / 1,5 s) | Ausente | P1 |
| Busca | D-doc (índice assíncrono) | F-código (Elasticsearch + filtro de permissão) | Ausente | P1 |
| Fixar mensagens | D-doc | F-nv | Ausente | P1 |
| Tópicos (threads) | D-doc | F-código (`channel_threads`) | Ausente | P2 |
| Anexos | D-doc (25 MiB) | F-nv | Validado (R2, limite por plano) | — |
| Prévia de link | D-doc (embeds) | F-código (serviço `fluxer_unfurl`) | Parcial (só GIF) | P2, com proteção contra SSRF |
| Lista virtualizada | D-obs | F-código (`@tanstack/react-virtual`) | Ausente | P2 |
| DM em grupo | D-doc | F-nv | Ausente | P1 |

## Notificações e presença

| Funcionalidade | Discord | Fluxer | Aether | Lacuna principal |
| --- | --- | --- | --- | --- |
| Notificação do sistema | D-obs | F-código (desktop e push) | **Em andamento na pasta local** (sem commit) | ver nota abaixo |
| Preferência por servidor e canal (todas / menções / nada, silenciar) | D-doc | F-código (`UserGuildSettingsRow`) | Ausente | P1, junto do P1-4 |
| Presença sem piscar em queda curta | D-obs | F-código (5 s de carência) | **Ausente** (offline na hora) | **G-1, novo** |
| Retomada sem perder eventos | D-doc (Resume com `seq`) | F-código (60 s, 4096 eventos) | Ausente | **G-1, novo** |
| Ausente automático | D-obs | F-código (`VoiceIdleActivityBridge`) [I] | Ausente | P1 |
| Status personalizado | D-obs | F-nv | Ausente | P2 |

## Voz, vídeo e tela

| Funcionalidade | Discord | Fluxer | Aether | Lacuna principal |
| --- | --- | --- | --- | --- |
| Canal de voz no SFU | D-obs | F-código (LiveKit) | Validado (LiveKit) | — |
| Mudo, surdo, dispositivos | D-obs | F-código | Validado | — |
| Push-to-talk | D-doc (`USE_VAD`) | F-código (gancho nativo com tecla solta) | **Interface** ("ainda não disponível") | decisão de dependência |
| Supressão de ruído | D-obs | F-nv | Parcial (RNNoise) | medir |
| Tela com áudio | D-obs | F-código (áudio por processo no Windows) | Parcial (áudio do sistema inteiro, só desktop) | P2 |
| Tela depois de queda | D-obs | F-código (encerra de forma consistente) | Parcial (estado fica errado) | P1-6, redefinido |
| Criptografia de ponta a ponta na voz | D-obs | F-código (E2EE do LiveKit) | Ausente | P3, diferencial |

## Servidores e moderação

| Funcionalidade | Discord | Fluxer | Aether | Lacuna principal |
| --- | --- | --- | --- | --- |
| Servidores, canais, categorias | D-doc | F-nv | Validado | — |
| Cargos e overwrites | D-doc | F-código (`VIEW_CHANNEL` + `READ_MESSAGE_HISTORY`) | Validado (22 bits) | bits finos |
| Reordenar cargos | D-doc | F-nv | Ausente | P1 |
| Convites | D-doc | F-nv | Validado (web) | — |
| Expulsar, banir, auditoria | D-doc | F-nv | Validado | — |
| Castigo (timeout), modo lento | D-doc | F-nv | Ausente | P1 |

## Desktop e segurança

| Ponto | Discord | Fluxer | Aether | Lacuna principal |
| --- | --- | --- | --- | --- |
| Instalador assinado e atualização verificada | D-obs | F-código (assinatura por plataforma) | **Ausente** (P0-A do REA) | certificado |
| Remetente do IPC conferido | — | F-código | Ausente (P1-B) | P1 |
| `openExternal` com lista de protocolos | — | F-código (`https:`, `mailto:`) | Ausente (P1-A) | P1, pequeno |
| Vínculo Google seguro | — | — | No PR (#11) | publicar |
| Segredo próprio da API interna | — | — | No PR (#11), Fly com o segredo em *Staged* | publicar |

## O que mudou no roadmap

Os itens P0/P1 de `aether-roadmap.md` continuam valendo. A investigação acrescenta
ou redefine:

1. **G-1 (P1, novo): resiliência do gateway.** Carência de alguns segundos antes
   de anunciar offline (decidida no Redis quando houver várias instâncias) e
   `connectionStateRecovery` do Socket.IO com janela curta. Pequeno, sem
   migração, e resolve presença piscando e eventos perdidos.
2. **P1-6 redefinido:** primeiro, estado honesto da transmissão depois da queda
   (encerrar e avisar quem transmite); religar sozinho, depois.
3. **P1-5 (push-to-talk) precisa de decisão:** gancho de teclado nativo (módulo
   novo no desktop, com `keyup`) ou primeira versão só com a janela em foco. Nos
   dois casos, soltar a tecla ao suspender ou bloquear a tela.
4. **P1-A e P1-B do desktop sobem de importância** e o P1-C (sandbox) desce: a
   referência aberta mantém `sandbox: false` na janela principal e se protege
   pelo IPC e pelo `openExternal`.
5. **P2 de escala, novo:** contador de menções salvo com o `@everyone`
   distribuído por uma fila de tarefas, quando a contagem na conexão pesar.
6. **P3, diferencial:** criptografia de ponta a ponta na voz (o LiveKit oferece).

## Sobre a nota "em andamento na pasta local"

Durante esta investigação, a pasta `C:\Users\Ryu\Desktop\aether` estava sendo
editada por outra sessão, na branch `feat/mencoes`:

- o merge do #11 e do #12 dentro do #15 foi concluído (`511d65d`, `1ab77a2`,
  `664e539`), sem push;
- havia arquivos de notificação sem commit (`notificacoes-tab.tsx`,
  `lib/notifications/`, mudanças no desktop).

Este documento não avalia esse trabalho, que estava em curso. O P1-4 foi
deixado para quem o está fazendo, para não duplicar.

## Checklist de observação do Discord (para fazer à mão)

Usar o app normalmente, numa conta própria, e anotar o comportamento:

1. Quanto tempo uma queda de rede curta (desligar o Wi-Fi por 3 s) leva para
   aparecer para outra pessoa como offline.
2. Como a lista de canais diferencia "não lida" de "menção", e quando o
   contador some (ao abrir, ao rolar até o fim, ao marcar como lido).
3. Quando o indicador de digitação some depois que a pessoa para de digitar.
4. O que acontece com a transmissão de tela de quem transmite depois de uma
   queda de rede.
5. As opções de notificação de um servidor e de um canal, e a diferença entre
   silenciar e "só menções".
6. O que o push-to-talk faz quando a janela não está em foco, e quando o
   computador é bloqueado com a tecla apertada.
