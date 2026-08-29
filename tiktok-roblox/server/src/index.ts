/**
 * Sobe a ponte: le os jogos, abre as conexoes com o TikTok e serve a API.
 *
 * Uso:
 *   npm start            # conecta na live de verdade
 *   npm run sim          # comentarios falsos, sem live e sem npm install
 */
import { env } from "./env.ts";
import { describeProfile } from "./commands.ts";
import { loadGames } from "./games.ts";
import { createHub } from "./hub.ts";
import { createHttpServer } from "./http.ts";
import { createDoorbell } from "./push.ts";

const games = loadGames(env.gamesFile);
const doorbell = createDoorbell(env.openCloudKey);
const hub = createHub({ doorbell });

hub.reconcile(games.list());
games.onChange((updated) => hub.reconcile(updated));

const server = createHttpServer({ games, hub });

server.listen(env.port, env.host, () => {
  console.log("");
  console.log(`ponte no ar em http://${env.host}:${env.port} (fonte: ${env.source})`);
  for (const game of games.list()) {
    console.log(`  jogo "${game.id}" (${game.name}) <- @${game.tiktok}`);
    console.log(`    GET /v1/games/${game.id}/pull?since=0&wait=20000`);
  }
  console.log("");
  console.log("comandos do perfil default:");
  for (const line of describeProfile("default")) console.log(`  ${line}`);
  console.log("");
  if (env.host !== "127.0.0.1" && env.host !== "localhost") {
    console.warn(
      `ATENCAO: escutando em ${env.host} — a fila fica exposta na rede. ` +
        "O caminho recomendado e 127.0.0.1 + tunel com TLS (veja o README).",
    );
  }
});

/**
 * Encerramento limpo. Sem isto, o `disconnect` do TikTok nao acontece e a conta
 * fica com uma sessao pendurada do lado deles — que atrapalha a reconexao
 * seguinte.
 */
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (closing) process.exit(1);
    closing = true;
    console.log("\nencerrando...");
    server.close();
    void hub.stop().then(() => {
      doorbell.stop();
      games.stop();
      process.exit(0);
    });
  });
}
