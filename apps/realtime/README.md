# @aether/realtime — gateway WebSocket (FASE 3)

Servico Node separado do Next.js. Roda em `http://localhost:4000`, caminho de
socket `/ws`, com `GET /health` para monitoramento.

```bash
npm run dev:realtime      # tsx watch, le o .env da raiz
```

## Ja funciona

- **Handshake autenticado.** O gateway nao tem login proprio: le o mesmo cookie
  httpOnly `aether_session` que o app web grava e valida com a mesma funcao
  (`@aether/access`) — assinatura do JWT, linha `Session` no banco, revogacao e
  expiracao. Sessao revogada no app nao conecta aqui.
- **Recusa no middleware**, antes de qualquer handler. Nenhum evento precisa
  perguntar se o socket esta autenticado.
- **Encerramento limpo** em SIGINT/SIGTERM (solta a porta e o pool do Postgres).
- **Presenca por servidor.** Contagem por socket, nao por usuario: tres abas
  abertas e fechar uma nao deixa a pessoa offline para os outros. Status vive na
  memoria do gateway; o banco guarda so a preferencia (ONLINE/IDLE/DND).
- **Salas por permissao.** Ao entrar no servidor o socket entra tambem nas salas
  dos canais com `VIEW_CHANNEL`, calculadas por `@aether/access`.

## Falta (o resto da fase 3)

- entrada e saida de canal de voz — o gateway e a fonte de verdade de quem esta
  em qual canal;
- chat de texto em tempo real (modelo `Message` ja existe no schema);
- sinalizacao de estado de voz (mute, deafen, falando, compartilhando tela);
- canal temporario removido ao esvaziar;
- estado de voz do proprio usuario saindo do `useState` local da barra inferior.

## Decisoes

**Por que fora do Next:** o servidor do Next e serverless-friendly e reinicia a
cada build; um gateway WebSocket precisa de processo longo, memoria de estado e
escala horizontal propria.

**Por que cookie e nao token no `auth` do Socket.IO:** o cookie e httpOnly, ou
seja, o JavaScript da pagina nao consegue le-lo para mandar no payload do
handshake. Isso mantem o token fora do alcance de XSS. O preco e precisar de
`cors: { credentials: true }` e origem explicita.

**Estado em memoria:** por enquanto uma instancia so. Escalar horizontalmente
vai exigir o adapter de Redis do Socket.IO — mesma conversa do rate limit em
memoria da fase 1.

Os contratos de evento vao para `packages/shared/src/types.ts` conforme os
eventos forem existindo de fato.
