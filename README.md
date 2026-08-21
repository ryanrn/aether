# AETHER (nome provisorio)

Plataforma de comunicacao em tempo real: canais persistentes no estilo TeamSpeak
com a usabilidade do Discord — voz, compartilhamento de tela e chat.

> O nome definitivo ainda nao foi decidido. Toda a interface le o nome de
> `packages/shared/src/brand.ts`; trocar o produto de nome e alterar uma linha.

---

## Estado atual: FASES 1-4 concluidas, FASE 5 em andamento

| Fase | Escopo | Status |
| --- | --- | --- |
| 1 | Estrutura, autenticacao, usuarios, servidores, interface base | ✅ pronto |
| 2 | Canais, categorias, cargos, permissoes (CRUD + canais privados) | ✅ pronto |
| 3 | Gateway WebSocket, presenca, entrada/saida de canal, chat | ✅ pronto |
| 4 | WebRTC: microfone, audio, canais de voz (SFU) | ✅ pronto |
| 5 | Compartilhamento de tela (getDisplayMedia + distribuicao) | em andamento |
| 6 | Administracao, moderacao, logs | pendente |
| 7 | Performance, reconexao, seguranca, testes, deploy | pendente |

---

## Processo por fase

Regras de trabalho, validas para toda fase daqui em diante. **Antes** de
implementar:

1. **Analisar a arquitetura existente** — ler o que ja existe antes de escrever.
2. **Dizer quais arquivos serao criados e modificados**, antes de mexer.
3. **Explicar as decisoes tecnicas** e o porque de cada uma.

Durante e depois:

4. **Implementar apenas a fase pedida** — nada de adiantar a proxima.
5. **Nao quebrar o que ja funciona** — rodar os `scripts/verify-phase*.mjs` das
   fases anteriores como teste de regressao.
6. **Explicar como testar** ao terminar.
7. **Listar problemas e limitacoes conhecidos** — cada fase deste README tem a
   sua secao de limitacoes, e ela e escrita com honestidade.

Duas regras que valem sempre: **nenhuma alteracao grande sem explicar antes**, e
o alvo e **codigo de producao, nao demonstracao visual** — se algo e simulado ou
provisorio, isso vai escrito na secao de limitacoes.

---

## Roteiro das fases 4 a 7

### FASE 4 — voz
- WebRTC
- microfone
- audio
- canais de voz

Ja preparado: `Permissions-Policy` no `next.config.ts` libera `microphone=(self)`,
o tipo `VoiceState` existe em `packages/shared`, e o gateway da fase 3 e a fonte
de verdade de quem esta em qual canal. A midia em si vai por um SFU (LiveKit) —
malha P2P nao aguenta canal com muita gente.

### FASE 5 — tela
- compartilhamento de tela
- `getDisplayMedia`
- distribuicao do stream
- interface de screen sharing

Ja preparado: `display-capture=(self)` liberado no `next.config.ts` e a flag
`streaming` em `VoiceState`. O botao existe na UI desde a fase 1, desabilitado.

### FASE 6 — administracao
- administracao
- moderacao
- logs

Ja preparado: modelos `Ban`, `Invite` e `AuditLog` no schema, `audit.ts` no app
web, e as permissoes `KICK_MEMBERS`, `BAN_MEMBERS`, `MUTE_MEMBERS`,
`DEAFEN_MEMBERS`, `MOVE_MEMBERS` e `VIEW_AUDIT_LOG` ja definidas no bitfield.

### FASE 7 — endurecimento
- performance
- reconexao
- seguranca
- testes
- deploy

Aqui entram as dividas registradas nas limitacoes das fases anteriores: rate
limit em memoria virando Redis, adapter de Redis para o gateway escalar
horizontalmente, revalidacao de sessao em conexao ja aberta, e a primeira
suite de testes automatizados de verdade.

---

## Stack

- **Next.js 15** (App Router, Server Actions) + **React 19** + **TypeScript** estrito
- **Tailwind CSS 4** com design tokens proprios
- **PostgreSQL** (Supabase) + **Prisma 6**
- **Sessao propria**: JWT HS256 (`jose`) em cookie httpOnly + linha `Session` no
  banco para permitir revogacao
- **scrypt** nativo do Node para hash de senha (sem modulo nativo para compilar)

Fases seguintes: Socket.IO (fase 3) e LiveKit como SFU (fases 4 e 5).

---

## Estrutura

```
aether/
├── apps/
│   ├── web/                    Next.js — interface + server actions
│   │   └── src/
│   │       ├── app/            rotas (App Router)
│   │       ├── components/     UI (layout, auth, servers, ui)
│   │       ├── lib/            utilitarios de cliente
│   │       └── server/         TUDO que so roda no servidor
│   │           ├── actions/    server actions (entrada validada)
│   │           ├── auth/       senha, cookie de sessao, rate limit
│   │           ├── services/   camada de dados reaproveitavel
│   │           ├── guards.ts   autenticacao + autorizacao
│   │           └── audit.ts    log de auditoria
│   └── realtime/               gateway WebSocket (FASE 3)
│       └── src/
│           ├── env.ts          configuracao validada no boot
│           ├── auth.ts         handshake autenticado pelo cookie de sessao
│           └── index.ts        servidor Socket.IO
└── packages/
    ├── db/                     schema Prisma + cliente singleton
    ├── shared/                 tipos, permissoes, validacao Zod, marca
    └── access/                 sessao + permissao efetiva (web E gateway)
```

Regra de ouro da arquitetura: **nada de logica de negocio em componente**.
Componente chama action, action chama guard e service, service fala com o banco.

Segunda regra, que nasceu na fase 3: **regra de autorizacao mora em um lugar so**.
`apps/web` e `apps/realtime` sao apps irmaos e nenhum importa do outro; o que
os dois precisam saber sobre sessao e permissao vive em `@aether/access`. Duas
copias da regra de permissao divergem, e permissao divergente nao e bug de tela,
e falha de autorizacao.

---

## Como rodar

Pre-requisitos: Node 20.11+ e npm.

```bash
# 1. dependencias  (ja instaladas nesta maquina)
npm install
#    npm 12+ bloqueia install scripts: se aparecer o aviso "allow-scripts",
#    rode  npm approve-scripts @prisma/client @prisma/engines prisma esbuild sharp
#    (o package.json ja tem esses aprovados)

# 2. variaveis de ambiente
#    O arquivo e .env NA RAIZ do monorepo (nao .env.local, e nao dentro de apps/web):
#    todos os comandos injetam esse arquivo via dotenv-cli, entao Prisma e Next
#    leem exatamente as mesmas variaveis.
#    Ja existe nesta maquina com o AUTH_SECRET gerado.
#
#    Senha do Postgres — NAO edite a URL na mao (senhas do Supabase costumam ter
#    @ / ? & que quebram a URL). Use:
npm run db:password -- "senha-crua-do-dashboard"
npm run db:diagnose         # confere usuario/host/encoding sem imprimir a senha

# 3. cliente Prisma + tabelas
npm run db:generate
npm run db:deploy           # aplica a migration inicial (cria as 13 tabelas)

# 4. (opcional) dados de teste: usuarios ryan/joao, senha senha123
npm run db:seed

# 5. subir
npm run dev                 # http://localhost:3000
```

---

## Como testar a FASE 2

Verificacao automatica (com o dev server rodando em outro terminal):

```bash
npx dotenv -e .env -- node scripts/verify-phase2.mjs
```

O script cria sessoes reais no banco, assina o mesmo JWT do app e faz
requisicoes HTTP autenticadas — testa o caminho real (middleware, guards,
filtro de canais privados), nao uma reimplementacao da regra. Ele limpa tudo
o que cria.

Roteiro manual:

1. Entre como `ryan` / `senha123`.
2. Passe o mouse sobre uma categoria: aparecem renomear, excluir e **+**.
3. **Novo canal** → escolha Voz, marque **Canal privado** e libere so o cargo
   Moderator. Salve.
4. Em outra janela anonima, entre como `joao` / `senha123`: o canal privado
   **nao aparece** na arvore. Cole a URL dele: responde 404.
5. Como ryan, engrenagem no topo → **Cargos**: marque `Mutar usuarios` no
   cargo Member e salve. Volte em **Membros** e de o cargo Moderator ao joao.
6. Recarregue a janela do joao: o canal privado agora aparece.
7. Ainda como joao, tente abrir `/app/s/<id>/settings`: 404, porque Member nao
   tem `MANAGE_ROLES`.

### Regras de hierarquia que a interface mostra

- Cargo acima do seu abre em modo leitura.
- Permissao que voce nao possui aparece travada — conceder o que nao se tem
  seria escalada de privilegio, e o servidor recusa mesmo se o cliente enviar.
- O cargo do dono nao pode ser editado, excluido ou atribuido por ninguem.

---

## Como testar a FASE 1

1. `http://localhost:3000` redireciona para `/login`.
2. Crie uma conta em `/register`.
3. Sem servidores, o app mostra o estado vazio. Clique no **+** da barra lateral
   → **Criar servidor**. Sao criados automaticamente: 5 cargos
   (Owner/Administrator/Moderator/Member/Guest), as categorias GERAL e PRIVADO,
   os canais de exemplo e um convite.
4. O botao **Convidar** no topo gera/reaproveita um codigo de 8 caracteres.
5. Abra uma janela anonima, crie uma segunda conta e entre com o codigo
   (**+** → *Entrar com convite*, ou `http://localhost:3000/invite/<codigo>`).
6. A segunda conta aparece no painel da direita agrupada pelo cargo Member.

### Verificacoes de seguranca (o que deve falhar)

- Acessar `/app/s/<id-de-servidor-que-voce-nao-participa>` → **404**
  (nao 403: nao revelamos que o servidor existe).
- Acessar `/app/s/<seu-servidor>/c/<canal-de-outro-servidor>` → **404**.
- Sair da conta e abrir `/app` → redireciona para `/login`.
- Errar a senha 10x em 5 minutos → bloqueio temporario por IP.
- O botao **Convidar** so aparece para quem tem a permissao `CREATE_INVITE` —
  e a action revalida a permissao no servidor, entao chamar a action direto
  sem permissao tambem falha.

---

## Limitacoes conhecidas da FASE 5

Compartilhamento de tela publicado pelo SFU, com destaque, miniaturas, tela
cheia e picture-in-picture.

- **Qualidade nao tem trava artificial.** Sao tres perfis (Leitura, Equilibrado,
  Movimento) que mudam resolucao, quadros e sobretudo o `contentHint` — que
  decide o que sacrificar quando a banda aperta: nitidez ou fluidez. O teto real
  e o seu upload, a CPU e o plano do SFU.
- **Audio do sistema depende do navegador e da escolha do usuario.** Pedimos,
  mas em muitos casos o navegador so oferece audio ao compartilhar uma ABA. Sem
  ele, o video vai sozinho — nao e erro.
- **Sem controle de volume por transmissao.** O audio da tela toca junto com o
  resto da sala.
- **Nao ha limite de quantas pessoas transmitem ao mesmo tempo.** O grid
  aguenta, a banda de quem assiste talvez nao.
- **Trocar de canal encerra a transmissao** — a faixa pertence a sala anterior.
- **Sem gravacao** e sem historico de quem transmitiu (fase 6, junto do log).

---

## Limitacoes conhecidas da FASE 4

Audio confirmado funcionando entre dois clientes: entrar, falar, ouvir, mutar,
ensurdecer e sair.

- **So funciona em localhost por enquanto.** O LiveKit Cloud faz o relay da
  midia, mas o app (Next e gateway) roda na sua maquina. Usar com outras
  pessoas exige deploy — e a fase 7.
- **Sem seletor de dispositivo.** Usa o microfone padrao do sistema; trocar de
  entrada ou de saida exige mexer no sistema operacional.
- **Sem volume por usuario** e sem mute administrativo — o `serverMuted` do
  `VoiceState` existe e e sempre falso.
- **Sem indicador de qualidade de conexao** (ping, perda de pacote).
- **Compartilhamento de tela ainda nao existe**, mas o token ja autoriza a
  fonte `screen_share` para quem tem a permissao. E a fase 5.
- **Reconexao do SFU nao foi exercitada** em queda real de rede; o LiveKit
  reconecta sozinho, mas isso nao foi testado aqui.
- **Uma sala por canal, uma instancia de gateway.** A conta do LiveKit Cloud
  tem limites de banda; video consome bem mais que voz.

---

## Limitacoes conhecidas da FASE 3

Pronto: gateway autenticado, presenca em tempo real, **chat de texto** e
**ocupacao de canal de voz** (quem entrou aparece sob o canal, para todos).

- **Ninguem ouve ninguem.** A voz da fase 3 e ocupacao e sinalizacao: entrar,
  sair, mutar, ensurdecer, e o indicador de quem esta falando. Nao existe
  WebRTC, nao existe transporte de audio, ninguem escuta ninguem — isso e a
  fase 4.
- **O microfone e aberto, mas so localmente.** Para acender a bordinha de "esta
  falando" o navegador precisa ouvir voce, entao ele pede permissao de
  microfone ao entrar numa call. O sinal e analisado na sua maquina
  (`AnalyserNode`, energia RMS) e o que sai pelo socket e **um booleano**. O
  audio nao e transmitido, nem gravado, nem guardado. Negar a permissao nao
  quebra nada: a call continua, so a bordinha nao acende.
- **Editar e excluir mensagem nao existem.** O modelo tem `editedAt` e
  `deletedAt`, o historico ja respeita o soft delete, mas nao ha evento de
  socket nem interface. Ficou fora deste bloco por decisao de escopo.
- **Canal temporario ainda nao some ao esvaziar.** O gateway ja sabe quando o
  ultimo saiu; falta o evento que atualiza a arvore de canais no cliente.
- **Aviso sonoro de entrada e saida de call** e sintetizado no navegador
  (osciladores Web Audio), nao e arquivo de audio. Nao existe controle de
  volume nem opcao de desligar alem de ficar ensurdecido.
- **Sem indicador de nao-lido.** O socket ja recebe mensagens de todos os
  canais visiveis, entao o dado existe — falta contar e mostrar.
- **Sem "esta digitando".**
- **Mensagem que falha nao tem botao de reenviar** — ela fica marcada com o
  erro, e reenviar significa copiar e colar.
- **Presenca e voz vivem na memoria do gateway.** Reiniciar o processo zera
  quem esta online e quem esta em call ate os clientes reconectarem. E de
  proposito: esses dados sao efemeros. O `User.status` do banco guarda so a
  PREFERENCIA (a pessoa escolheu DND), nao quem esta conectado.
- **Uma instancia so.** O estado em memoria nao e compartilhado entre
  processos; escalar horizontalmente exige o adapter de Redis do Socket.IO.
  Mesma conversa do rate limit.
- **Sala nao se recalcula sozinha.** Se um cargo mudar enquanto voce esta
  conectado, as salas em que o socket ja esta continuam como estavam ate
  reconectar ou trocar de servidor. Escrita permanece protegida (revalida
  sempre, a cada mensagem); o que pode ficar velho e a leitura. Correcao
  prevista para a fase 7, junto com a revalidacao de sessao em conexao aberta.
- **Ainda nao existe seletor de status na interface.** O evento
  `presence:set` funciona e persiste, mas nenhum botao o dispara.

---

## Limitacoes conhecidas da FASE 2

- **Reordenar canal e por setas**, nao arrastar e soltar. A coluna `position`
  ja suporta DnD; so muda a forma de calcular o destino.
- **Reordenar cargos ainda nao existe** na interface. A hierarquia funciona
  (position), mas so muda quando um cargo e criado.
- **Canal temporario** guarda a flag e mostra o selo `tmp`, mas so sera
  removido ao esvaziar na fase 3 — quem sabe se um canal esvaziou e o gateway.
- **Overwrite por membro** existe no banco e no calculo de permissoes, mas a
  interface so expoe overwrite por cargo.
- **Sem realtime**: dois navegadores abertos nao veem a mudanca um do outro sem
  recarregar. Isso e exatamente o que a fase 3 resolve.
- **Excluir canal e definitivo** e a confirmacao e um `window.confirm`.

---

## Limitacoes conhecidas da FASE 1

- **Presenca e sempre OFFLINE.** O campo existe no banco, mas quem atualiza e o
  gateway da fase 3.
- **Botoes de microfone/audio** guardam apenas preferencia local; nao abrem
  dispositivo nenhum. Nao existe audio simulado em lugar algum do codigo.
- **Compartilhamento de tela** esta desabilitado (fase 5).
- ~~Canais e cargos sem CRUD~~ — resolvido na fase 2.
- **Rate limit em memoria**: funciona com uma instancia. Ao escalar
  horizontalmente precisa migrar para Redis (a interface ja isola isso).
- **Upload de avatar e icone de servidor** ainda nao existe; os campos estao no
  banco e a UI ja cai no avatar gerado por iniciais.
- **Sem testes automatizados** ainda (fase 7).
