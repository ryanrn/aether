/**
 * Bot de exemplo do AETHER — responde "!ping" com "pong".
 *
 * O menor bot util possivel: conecta no Gateway, espera o `ready`, escuta
 * `MESSAGE_CREATE` e responde pela REST. Serve de molde para qualquer bot de
 * texto (comandos, moderacao, jogos).
 *
 * Rodar:
 *   npm install socket.io-client
 *   # cole o token do bot no lugar de AEB_TOKEN (aba Bot -> Gerar token)
 *   node examples/bot-exemplo.mjs
 *
 * Enquanto este processo estiver rodando, escreva "!ping" num canal que o bot
 * enxerga. Feche o processo e o bot fica mudo.
 *
 * Documentacao: docs/developer-platform.md
 */
import { io } from "socket.io-client";

// --- configuracao --------------------------------------------------------------

const TOKEN = process.env.AETHER_BOT_TOKEN ?? "aeb_COLE_SEU_TOKEN_AQUI";
const API = process.env.AETHER_API ?? "https://aether-mocha-phi.vercel.app";
const GATEWAY = process.env.AETHER_GATEWAY ?? "https://aether-gateway-earnest-dew-229.fly.dev";

if (!TOKEN.startsWith("aeb_")) {
  console.error("Falta o token do bot. Edite TOKEN no topo do arquivo, ou:");
  console.error("  AETHER_BOT_TOKEN=aeb_... node examples/bot-exemplo.mjs");
  process.exit(1);
}

// --- conexao -----------------------------------------------------------------

const socket = io(`${GATEWAY}/gateway`, {
  path: "/ws",
  transports: ["websocket"],
  auth: { token: TOKEN, intents: ["messages"] },
});

/** id do proprio bot — vem no `ready`, usado para nao responder a si mesmo. */
let meuId = null;

socket.on("ready", (info) => {
  meuId = info.bot.id;
  const nomes = info.servers.map((s) => s.name).join(", ") || "nenhum";
  console.log(`ligado como "${info.bot.displayName}" (@${info.bot.username})`);
  console.log(`instalado em: ${nomes}`);
  console.log('escutando... escreva "!ping" num canal.');
});

socket.on("dispatch", async (evento) => {
  if (evento.t !== "MESSAGE_CREATE") return;
  const msg = evento.d;

  // ANTI-LOOP: o bot recebe as proprias mensagens de volta. Sem esta linha,
  // um bot que responde a mensagens conversa com ele mesmo para sempre.
  if (msg.author.id === meuId) return;

  const texto = msg.content.trim();

  if (texto === "!ping") {
    await responder(msg.channelId, "pong");
  } else if (texto === "!oi") {
    await responder(msg.channelId, `ola, ${msg.author.displayName}!`);
  }
});

socket.on("connect_error", (erro) => {
  console.error("conexao recusada:", erro.message);
  // token invalido/revogado cai aqui — nao adianta reconectar.
  process.exit(1);
});

socket.on("disconnect", (motivo) => {
  console.log("desconectado:", motivo, "- o socket.io tenta reconectar sozinho.");
});

// --- responder (REST) ------------------------------------------------------------

async function responder(channelId, conteudo) {
  const resposta = await fetch(`${API}/api/v1/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ content: conteudo }),
  });

  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => null);
    console.error(
      `falhei ao responder (${resposta.status}):`,
      corpo?.error?.code ?? "erro desconhecido",
    );
  }
}
