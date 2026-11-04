/**
 * Balanceador TCP minimo, para a bateria de integracao com MAIS DE UM gateway
 * (fase 7e, item 3). So para teste — producao usa o proxy da Fly.
 *
 * Por que TCP (camada 4) e nao um proxy HTTP: o WebSocket do Socket.IO e uma
 * conexao longa que comeca como HTTP e vira outra coisa no `Upgrade`. Repassar
 * bytes crus funciona para os dois casos sem entender nenhum, e sem dependencia
 * nova (nginx/haproxy exigiriam Docker, e este script tambem roda fora do CI).
 *
 * Por que round-robin SEM sticky: e o pior caso de proposito. Cada conexao de
 * socket nova vai para a proxima instancia, entao dois clientes de um mesmo
 * teste (ryan e joao) caem em gateways DIFERENTES — exatamente o cenario em que
 * um `io.sockets.sockets.get()` local, ou um estado que so existe em memoria,
 * quebraria. Os clientes dos `verify-*` usam `transports: ["websocket"]`, que
 * nao precisa de sticky (so o long-polling precisa).
 *
 * Duas filas de rodizio separadas — conexoes de WebSocket e o resto (HTTP:
 * `/health`, `/internal/*` vindas do web). Com uma fila so, um teste que
 * alternasse "chamada HTTP, socket, chamada HTTP, socket" mandaria TODOS os
 * sockets para a mesma instancia, e o teste passaria sem provar nada.
 */
import net from "node:net";

/** A primeira leitura e um pedido de WebSocket do Socket.IO? */
function ehWebSocket(primeiroPedaco) {
  const cabecalho = primeiroPedaco.subarray(0, 4096).toString("latin1");
  return /^GET [^\r\n]*\/ws\//.test(cabecalho) && /\r\nupgrade:\s*websocket/i.test(cabecalho);
}

/**
 * @param {{ porta: number, alvos: number[], host?: string }} opcoes
 * @returns {Promise<{ sockets: number[], http: number[], fechar: () => Promise<void> }>}
 *   `sockets[i]`/`http[i]` = quantas conexoes de cada tipo foram para `alvos[i]`.
 */
export function iniciarBalanceador({ porta, alvos, host = "127.0.0.1" }) {
  const sockets = alvos.map(() => 0);
  const http = alvos.map(() => 0);
  let proximoSocket = 0;
  let proximoHttp = 0;
  const abertas = new Set();

  const servidor = net.createServer((cliente) => {
    abertas.add(cliente);
    cliente.on("close", () => abertas.delete(cliente));
    cliente.on("error", () => cliente.destroy());

    cliente.once("data", (primeiro) => {
      cliente.pause();
      const ws = ehWebSocket(primeiro);
      const i = ws ? proximoSocket++ % alvos.length : proximoHttp++ % alvos.length;
      (ws ? sockets : http)[i] += 1;

      const destino = net.connect({ host, port: alvos[i] });
      abertas.add(destino);
      destino.on("close", () => abertas.delete(destino));
      // Instancia fora do ar: derruba o cliente, como um LB sem health check
      // faria. O cliente do Socket.IO reconecta e cai na proxima.
      destino.on("error", () => {
        destino.destroy();
        cliente.destroy();
      });
      destino.on("connect", () => {
        destino.write(primeiro);
        cliente.pipe(destino);
        destino.pipe(cliente);
        cliente.resume();
      });
      cliente.on("close", () => destino.destroy());
      destino.on("close", () => cliente.destroy());
    });
  });

  return new Promise((resolve, reject) => {
    servidor.once("error", reject);
    servidor.listen(porta, host, () => {
      resolve({
        sockets,
        http,
        fechar: () =>
          new Promise((fim) => {
            for (const s of abertas) s.destroy();
            servidor.close(() => fim());
          }),
      });
    });
  });
}
