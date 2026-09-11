/**
 * AETHER Assistant — bot de utilidades pronto pra rodar de verdade.
 *
 * Diferente do bot-exemplo.mjs (que so tem "!ping" pra ensinar o basico),
 * este tem varios comandos, cooldown pra nao estourar o rate limit da API, e
 * trata erro de rede/reconexao — pensado pra ficar ligado por horas, nao so
 * pra demonstrar.
 *
 * LIMITACOES DA PLATAFORMA (nao deste bot): sem evento de "membro entrou",
 * sem apagar/editar mensagem pela API ainda. Por isso os comandos sao todos
 * "alguem escreveu algo, o bot responde" — nao ha boas-vindas automatica nem
 * moderacao que apaga mensagem. Ver docs/developer-platform.md.
 *
 * Rodar:
 *   npm install socket.io-client
 *   AETHER_BOT_TOKEN=aeb_seu_token node examples/bot-utilidades.mjs
 *
 * Deixar rodando 24h: qualquer coisa que mantenha um processo Node vivo serve
 * (pm2, um servico do Windows, uma VPS pequena, um Fly Machine). O script em
 * si nao muda - so onde ele roda.
 */
import { io } from "socket.io-client";

// --- configuracao --------------------------------------------------------------

const TOKEN = process.env.AETHER_BOT_TOKEN ?? "aeb_COLE_SEU_TOKEN_AQUI";
const API = process.env.AETHER_API ?? "https://aether-mocha-phi.vercel.app";
const GATEWAY = process.env.AETHER_GATEWAY ?? "https://aether-gateway-earnest-dew-229.fly.dev";
const PREFIXO = process.env.AETHER_PREFIXO ?? "!";

if (!TOKEN.startsWith("aeb_")) {
  console.error("Falta o token do bot. Rode assim:");
  console.error("  AETHER_BOT_TOKEN=aeb_... node examples/bot-utilidades.mjs");
  process.exit(1);
}

// --- cooldown por canal ----------------------------------------------------------

/**
 * O limite da API e 5 mensagens / 5s POR CANAL (API_LIMITES.envioPorCanal).
 * Um cooldown de 1.2s entre respostas do bot no MESMO canal deixa margem —
 * ninguem em uso normal manda 5 comandos por segundo, mas se mandar, o bot
 * ignora em silencio em vez de tomar 429 e logar erro toda hora.
 */
const COOLDOWN_MS = 1200;
const ultimaRespostaPorCanal = new Map();

function podeResponder(channelId) {
  const agora = Date.now();
  const ultima = ultimaRespostaPorCanal.get(channelId) ?? 0;
  if (agora - ultima < COOLDOWN_MS) return false;
  ultimaRespostaPorCanal.set(channelId, agora);
  return true;
}

// --- comandos --------------------------------------------------------------------

/** Cada comando recebe (args, msg) e devolve a string de resposta (ou null p/ nao responder). */
const COMANDOS = {
  ajuda() {
    const lista = Object.keys(COMANDOS)
      .map((c) => `${PREFIXO}${c}`)
      .join(", ");
    return `Comandos: ${lista}`;
  },

  ping() {
    return "pong";
  },

  oi(_args, msg) {
    return `oi, ${msg.author.displayName}!`;
  },

  moeda() {
    return Math.random() < 0.5 ? "cara" : "coroa";
  },

  /** "!dado" = 1d20. "!dado 2d6" = dois dados de 6 lados. */
  dado(args) {
    const entrada = args[0] ?? "1d20";
    const casado = /^(\d{1,2})d(\d{1,3})$/i.exec(entrada);
    if (!casado) return `formato invalido. use ${PREFIXO}dado NdM, ex: ${PREFIXO}dado 2d6`;

    const quantidade = Math.min(Number(casado[1]), 20);
    const lados = Math.min(Number(casado[2]), 1000);
    const rolagens = Array.from(
      { length: quantidade },
      () => 1 + Math.floor(Math.random() * lados),
    );
    const soma = rolagens.reduce((a, b) => a + b, 0);

    return quantidade === 1
      ? `🎲 ${soma}`
      : `🎲 ${rolagens.join(" + ")} = ${soma}`;
  },

  bola8(args) {
    if (args.length === 0) return `pergunte algo: ${PREFIXO}bola8 vai chover amanha?`;
    const respostas = [
      "sim.",
      "nao.",
      "talvez.",
      "com certeza.",
      "melhor nao contar com isso.",
      "pergunte de novo mais tarde.",
      "as chances sao boas.",
      "duvidoso.",
    ];
    const r = respostas[Math.floor(Math.random() * respostas.length)];
    return `🎱 ${r}`;
  },
};

// --- conexao -----------------------------------------------------------------

const socket = io(`${GATEWAY}/gateway`, {
  path: "/ws",
  transports: ["websocket"],
  auth: { token: TOKEN, intents: ["messages"] },
});

let meuId = null;

socket.on("ready", (info) => {
  meuId = info.bot.id;
  const nomes = info.servers.map((s) => s.name).join(", ") || "nenhum";
  console.log(`[${new Date().toISOString()}] ligado como "${info.bot.displayName}" (@${info.bot.username})`);
  console.log(`instalado em: ${nomes}`);
  console.log(`prefixo de comando: "${PREFIXO}"`);
});

socket.on("dispatch", async (evento) => {
  if (evento.t !== "MESSAGE_CREATE") return;
  const msg = evento.d;

  // ANTI-LOOP: nao reagir as proprias mensagens nem as de outros bots.
  if (msg.author.id === meuId || msg.author.bot) return;

  const texto = msg.content.trim();
  if (!texto.startsWith(PREFIXO)) return;

  const [nomeComando, ...args] = texto.slice(PREFIXO.length).split(/\s+/);
  const comando = COMANDOS[nomeComando?.toLowerCase()];
  if (!comando) return; // texto comeca com o prefixo mas nao e comando conhecido — ignora

  if (!podeResponder(msg.channelId)) return;

  let resposta;
  try {
    resposta = comando(args, msg);
  } catch (erro) {
    console.error("comando falhou:", nomeComando, erro);
    return;
  }
  if (resposta) await responder(msg.channelId, resposta);
});

socket.on("connect_error", (erro) => {
  console.error(`[${new Date().toISOString()}] conexao recusada:`, erro.message);
  // token invalido/revogado cai aqui — nao adianta ficar tentando de novo.
  if (erro.message === "unauthorized") process.exit(1);
});

socket.on("disconnect", (motivo) => {
  console.log(`[${new Date().toISOString()}] desconectado (${motivo}) — o socket.io reconecta sozinho.`);
});

// nao deixa o processo morrer por uma promise rejeitada solta (erro de rede etc.)
process.on("unhandledRejection", (erro) => {
  console.error("erro nao tratado:", erro);
});

// --- responder (REST) ------------------------------------------------------------

async function responder(channelId, conteudo) {
  try {
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
  } catch (erro) {
    console.error("falha de rede ao responder:", erro.message);
  }
}
