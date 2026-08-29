/**
 * O rate limit e o consumo de ticket, contra um Redis DE VERDADE.
 *
 * POR QUE EXISTE: o teste de unidade dubla o `fetch`. Ele cobre o contrato —
 * que a chamada sai com os argumentos certos, que a chave leva prefixo, e o
 * que acontece quando o Redis cai. O que ele NAO cobre, e diz isso no proprio
 * cabecalho, e a semantica do Lua: isso depende do interpretador do servidor,
 * e nenhum duble consegue prova-la.
 *
 * E o mesmo ponto cego do R2: `fetch` de servidor ignora CORS, entao o teste
 * em Node passava enquanto o navegador era bloqueado. Aqui o equivalente seria
 * um Lua que roda na cabeca de quem escreveu e falha no Upstash.
 *
 * Exercita as funcoes de `@aether/shared` — as MESMAS que rodam em producao —
 * e nao uma copia. Inclusive a serializacao dos argumentos, que transforma
 * tudo em texto e depende do `tonumber` do Lua para voltar a ser numero.
 *
 * Uso:
 *   npx dotenv -e .env -- npx tsx scripts/verificar-redis.mts
 */
import { randomBytes } from "node:crypto";
import {
  consumirTicketUnico,
  limitarJanelaDeslizante,
  readRedisConfig,
  redisEval,
  type RedisConfig,
} from "../packages/shared/src/index";

let passou = 0;
let falhou = 0;
const ok = (r: string, d = "") => {
  passou += 1;
  console.log(`  ok    ${r}${d ? ` — ${d}` : ""}`);
};
const falha = (r: string, d = "") => {
  falhou += 1;
  console.log(`  FALHA ${r}${d ? ` — ${d}` : ""}`);
};
const diz = (bom: boolean, r: string, d = "") => (bom ? ok(r, d) : falha(r, d));

/**
 * Sufixo aleatorio em toda chave: este script pode rodar contra o Redis de
 * producao, e nao pode encostar no contador de ninguem.
 */
const CORRIDA = randomBytes(6).toString("hex");
const chaves: string[] = [];

function chaveDeLimite(nome: string) {
  const k = `verificacao:${CORRIDA}:${nome}`;
  chaves.push(`ratelimit:${k}`);
  return k;
}

/** Quantos itens ha no conjunto da janela — para ver o que o Lua gravou. */
async function tamanhoDoConjunto(config: RedisConfig, chave: string) {
  const r = await redisEval(config, "return redis.call('ZCARD', KEYS[1])", [
    `ratelimit:${chave}`,
  ], []);
  return Number(r);
}

async function main() {
  const config = readRedisConfig();
  if (!config) {
    console.log(
      "Redis nao configurado no .env.\n\n" +
        "Faltam UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN. Sem elas o\n" +
        "app sobe igual e o contador cai para memoria — que na Vercel\n" +
        "serverless quase nao protege, porque cada funcao tem a sua.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(`Redis: ${config.url}\n`);

  // ---------------------------------------------------------------- janela

  console.log("A janela deslizante");

  const k1 = chaveDeLimite("limite");
  const JANELA = 60_000;
  const LIMITE = 3;
  const t0 = Date.now();

  let permitidos = 0;
  for (let i = 0; i < LIMITE; i += 1) {
    const r = await limitarJanelaDeslizante(config, k1, LIMITE, JANELA, t0 + i);
    if (r.ok) permitidos += 1;
  }
  diz(
    permitidos === LIMITE,
    "o Lua roda no interpretador do servidor",
    `${permitidos}/${LIMITE} permitidos`,
  );

  const excedente = await limitarJanelaDeslizante(config, k1, LIMITE, JANELA, t0 + 10);
  diz(!excedente.ok, "a tentativa alem do limite e recusada");
  diz(
    excedente.retryAfter >= 1 && excedente.retryAfter <= JANELA / 1000,
    "a espera devolvida faz sentido",
    `${excedente.retryAfter}s`,
  );

  /**
   * O DETALHE QUE MAIS FACIL SE QUEBRA: a tentativa recusada nao pode entrar
   * no conjunto. Se entrasse, insistir empurraria a liberacao para sempre
   * adiante — quem errou a senha ficaria trancado enquanto continuasse
   * tentando, e o sintoma pareceria "o rate limit esta funcionando".
   */
  for (let i = 0; i < 5; i += 1) {
    await limitarJanelaDeslizante(config, k1, LIMITE, JANELA, t0 + 20 + i);
  }
  const tamanho = await tamanhoDoConjunto(config, k1);
  diz(
    tamanho === LIMITE,
    "insistir NAO empurra a liberacao para a frente",
    `conjunto tem ${tamanho}, esperado ${LIMITE}`,
  );

  /**
   * A janela desliza. O relogio entra por parametro justamente para provar
   * isto sem dormir um minuto — dormir tornaria o script lento demais para
   * alguem rodar, e script que ninguem roda nao verifica nada.
   */
  const depois = await limitarJanelaDeslizante(
    config,
    k1,
    LIMITE,
    JANELA,
    t0 + JANELA + 1,
  );
  diz(depois.ok, "passada a janela, libera de novo");

  const k2 = chaveDeLimite("outra");
  const outra = await limitarJanelaDeslizante(config, k2, LIMITE, JANELA, t0);
  diz(outra.ok, "o limite de uma chave nao afeta a outra");

  // ---------------------------------------------------------------- ticket

  console.log("\nO consumo unico de ticket");

  const jti = `verificacao-${CORRIDA}`;
  chaves.push(`ticket:${jti}`);
  const TTL = 30_000;

  const primeiro = await consumirTicketUnico(config, jti, TTL);
  diz(primeiro, "o primeiro uso passa");

  const segundo = await consumirTicketUnico(config, jti, TTL);
  diz(!segundo, "o segundo uso e recusado");

  const ttl = Number(
    await redisEval(config, "return redis.call('PTTL', KEYS[1])", [`ticket:${jti}`], []),
  );
  diz(
    ttl > 0 && ttl <= TTL,
    "o ticket expira sozinho, sem faxina",
    `restam ${ttl}ms`,
  );

  /**
   * A PROVA DE ATOMICIDADE, que e a razao de o codigo usar Lua em vez de
   * GET seguido de SET. Dez consumos DISPARADOS JUNTOS do mesmo ticket: se a
   * operacao nao fosse atomica, mais de um leria "ainda nao usado" antes de
   * qualquer escrita e o replay estaria aberto.
   */
  const jtiCorrida = `verificacao-corrida-${CORRIDA}`;
  chaves.push(`ticket:${jtiCorrida}`);
  const disputas = await Promise.all(
    Array.from({ length: 10 }, () => consumirTicketUnico(config, jtiCorrida, TTL)),
  );
  const vencedores = disputas.filter(Boolean).length;
  diz(
    vencedores === 1,
    "dez consumos simultaneos, e exatamente UM vence",
    `venceram ${vencedores}`,
  );

  console.log(`\n${passou} passaram, ${falhou} falharam`);
  if (falhou > 0) process.exitCode = 1;
}

main()
  .catch((erro) => {
    console.error("\nerro:", erro instanceof Error ? erro.message : erro);
    console.log(
      "\nSe falou em autenticacao, confira UPSTASH_REDIS_REST_TOKEN.\n" +
        "Se falou em host, confira UPSTASH_REDIS_REST_URL (com https://).",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    // Faxina: o script nao pode deixar chave para tras num Redis de producao.
    const config = readRedisConfig();
    if (!config || chaves.length === 0) return;
    await redisEval(
      config,
      "for i, k in ipairs(KEYS) do redis.call('DEL', k) end return 1",
      chaves,
      [],
    ).catch(() => undefined);
  });
