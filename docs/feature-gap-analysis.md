# Análise de lacunas — Aether × Discord (01/11/2026)

Fontes: [aether-audit.md](aether-audit.md) (estado do Aether, com arquivo e
linha) e [discord-research.md](discord-research.md) (referência; **[F]** =
documentação oficial lida, **[H]** = comportamento conhecido, não verificado
nesta sessão).

Prioridade segue o [roadmap](aether-roadmap.md): P0 crítico · P1 essencial ·
P2 experiência · P3 diferenciação.

## 1. Matriz

### Segurança e integridade (prioridade sobre qualquer feature)

| Funcionalidade | Discord | Aether | Lacuna | Prioridade |
| --- | --- | --- | --- | --- |
| Vínculo de conta por login social | — | PARCIAL | vincula Google a conta com e-mail não verificado; mantém senha/sessões do possível invasor | **P0** |
| Credencial da API interna | — | PARCIAL | `AUTH_SECRET` cru em header; correção existe solta e não importada | **P0** |
| Distribuição do desktop | instalador assinado [H] | PARCIAL | sem assinatura + auto-update automático | **P0** (processo) |
| Bloqueio x chamada ativa | — | PARCIAL | token de 1 h continua valendo | P1 |
| Hardening Electron | — | PARCIAL | `openExternal` sem filtro, `sandbox:false`, Electron 44.0.0 | P1 |

### Servidores e moderação

| Funcionalidade | Discord | Aether | Lacuna | Prioridade |
| --- | --- | --- | --- | --- |
| Texto / voz / categorias | [F] | FUNCIONAL | — | — |
| Permissões e overwrites | [F] 52 flags | FUNCIONAL, 22 flags | faltam flags finas (anexo, embed, reação, fixar, timeout, slowmode, VAD) | P1 |
| Reordenar cargos | [F] | AUSENTE | não há action que mude `Role.position` | P1 |
| Timeout | [F] | AUSENTE | | P1 |
| Slowmode | [F] 0–21 600 s | AUSENTE | | P1 |
| AutoMod / filtro | [H] | AUSENTE | | P2 |
| Apagar em massa | [F] 2–100, ≤14 dias | AUSENTE | | P2 |
| Canal de anúncios | [F] | AUSENTE | | P2 |
| Fórum | [F] | AUSENTE | depende de threads | P2 |
| Palco | [F] até 10 000 | AUSENTE | | P3 |
| Eventos agendados | [F] `MANAGE_EVENTS` | AUSENTE | | P3 |
| Lista de membros grande | [H] carregamento lazy | PARCIAL | carrega todos de uma vez | P1 |

### Mensagens

| Funcionalidade | Discord | Aether | Lacuna | Prioridade |
| --- | --- | --- | --- | --- |
| Enviar / tempo real / histórico | [F] | FUNCIONAL | — | — |
| Editar | [F] só o autor | **AUSENTE** | coluna existe, sem fluxo | **P1** |
| Menções @user/@cargo/@everyone | [F] | **AUSENTE** | bit existe, sem parser | **P1** |
| Não lidas persistidas / entre aparelhos | [H] | PARCIAL | só memória, recarregar zera | **P1** |
| Notificações nativas | [H] | AUSENTE | | **P1** |
| Indicador de digitação | [H] | AUSENTE | | P1 |
| Busca | [F] indexada | AUSENTE | | P1 |
| Fixar | [F] | AUSENTE | | P1 |
| DM em grupo | [F] tipo 3 | AUSENTE | modelo de DM é par | P1 |
| Threads | [F] | AUSENTE | | P2 |
| Embeds de link | [F] | PARCIAL | só GIF | P2 |
| Emoji personalizado / stickers | [F] | AUSENTE / VISUAL | aba "em breve" | P2 |
| Encaminhar | [F] snapshot | AUSENTE | | P3 |
| Enquetes | [F] `SEND_POLLS` | AUSENTE | | P3 |
| Lista virtualizada | [H] | AUSENTE | DOM cresce sem limite | P2 |

### Voz e vídeo

| Funcionalidade | Discord | Aether | Lacuna | Prioridade |
| --- | --- | --- | --- | --- |
| Entrar/sair, mudo, surdo, dispositivos | [H] | FUNCIONAL | — | — |
| Push-to-talk | [H] + `USE_VAD` [F] | **VISUAL** | texto "ainda não disponível" | **P1** |
| Sensibilidade manual do VAD | [H] | VISUAL | idem | P1 |
| Supressão de ruído | [H] | PARCIAL (RNNoise) | sem validação medida | P2 |
| Tela com áudio | [H] | PARCIAL | só desktop | P2 |
| Retomada após queda | [H] | PARCIAL | tela/câmera não voltam sozinhas | **P1** |
| Bitrate / qualidade de vídeo por canal | [F] | AUSENTE | | P2 |
| Chamada direta | [H] | PARCIAL | E2E só local; sem chamada perdida no histórico | P1 |

### Usuários e presença

| Funcionalidade | Discord | Aether | Lacuna | Prioridade |
| --- | --- | --- | --- | --- |
| Status manual | [H] | FUNCIONAL | — | — |
| Ausente automático | [H] | AUSENTE | | P1 |
| Status personalizado | [H] | AUSENTE | | P2 |
| Bloqueio esconde mensagens | [H] | PARCIAL | só fecha DM | P1 |
| Amigos | [H] | FUNCIONAL | — | — |
| Preferências sincronizadas | [H] | PARCIAL | `localStorage` | P2 |

## 2. Falsos prontos (o mais perigoso)

Itens que parecem prontos na tela, ou que algum documento dá como prontos,
mas não estão:

1. **Correções de segurança marcadas `[x]`** em `auditoria-2026-09-28.md`
   que não estão no código (ver auditoria §2.1).
2. **Push-to-talk** aparece nas Configurações como seção, mas é só texto.
3. **Olimpo / loja**: botões e preços desenhados, compra "em breve". O plano
   funciona só por chave dada pela equipe.
4. **Contador de não lidas**: confiável dentro de uma aba; some ao recarregar e
   diverge entre aparelhos — usuário lê como "notificação perdida".
5. **`MENTION_EVERYONE`** aparece na tela de cargos como permissão que se pode
   dar, mas não faz nada (`permissions.ts:74` admite isso).
6. **README** diz que DM não tem lista lateral nem reply — falso hoje, no
   sentido contrário (o código está à frente do documento).

## 3. Erros silenciosos e estados inconsistentes observados

- Após queda de rede, eventos que não são mensagem (reação, apagar, presença)
  das conversas fechadas não são reenviados — o estado local diverge sem
  aviso até recarregar.
- Transmissão de tela ativa cai na reconexão do SFU e não volta; quem assiste
  vê a tela sumir sem mensagem de erro do lado de quem transmite.
- Invisível volta a visível no próximo login (proposital, mas não avisado na UI).
- GIF sem `GIPHY_API_KEY` vira "em breve" sem log de configuração faltando.
