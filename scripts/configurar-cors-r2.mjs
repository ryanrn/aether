/**
 * Ensina o bucket a aceitar PUT do navegador.
 *
 * POR QUE PRECISA: o upload vai do NAVEGADOR direto para o R2, e isso e uma
 * requisicao de outra origem. Sem politica de CORS no bucket, o navegador
 * bloqueia antes de sair — e o erro que aparece e "falha de rede", sem status
 * nenhum, o que nao diz em lugar algum que foi CORS.
 *
 * Um teste em Node nunca pega isso: `fetch` de servidor nao faz preflight nem
 * respeita CORS. So o navegador de verdade revela.
 *
 * As origens sao as que podem enviar. Localhost fica de fora em producao — se
 * ficasse, qualquer pagina rodando na maquina de alguem poderia gravar no
 * nosso bucket com uma URL assinada roubada.
 *
 * Uso:
 *   npx dotenv -e .env -- node scripts/configurar-cors-r2.mjs
 *   npx dotenv -e .env -- node scripts/configurar-cors-r2.mjs --ver
 */
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from "@aws-sdk/client-s3";

const BUCKET = process.env.R2_BUCKET;
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

/**
 * De onde o envio pode partir.
 *
 * A URL publica do app entra a partir do ambiente; localhost so em
 * desenvolvimento. Nao ha curinga: `*` deixaria qualquer site na internet
 * usar uma URL assinada que vazasse.
 */
function origensPermitidas() {
  const lista = [];
  const app = process.env.NEXT_PUBLIC_APP_URL;
  if (app) {
    try {
      lista.push(new URL(app).origin);
    } catch {
      /* URL invalida no .env: ignora em vez de quebrar */
    }
  }
  if (process.env.NODE_ENV !== "production") {
    lista.push("http://localhost:3000", "http://127.0.0.1:3000");
  }
  return [...new Set(lista)];
}

async function ver() {
  try {
    const r = await s3.send(new GetBucketCorsCommand({ Bucket: BUCKET }));
    console.log("politica atual:");
    console.log(JSON.stringify(r.CORSRules, null, 2));
  } catch (erro) {
    console.log("nao consegui ler a politica:", erro.name);
    console.log("(bucket sem CORS configurado ainda tambem cai aqui)");
  }
}

async function main() {
  if (!BUCKET || !process.env.R2_ACCOUNT_ID) {
    console.log("R2 nao configurado no .env");
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes("--ver")) return ver();

  const origens = origensPermitidas();
  if (origens.length === 0) {
    console.log("nenhuma origem para permitir — falta NEXT_PUBLIC_APP_URL?");
    process.exitCode = 1;
    return;
  }

  console.log("origens que poderao enviar:");
  for (const o of origens) console.log(`  ${o}`);

  try {
    await s3.send(
      new PutBucketCorsCommand({
        Bucket: BUCKET,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: origens,
              /**
               * `PUT` para enviar e `GET`/`HEAD` para a pagina ler o arquivo.
               * Nao entra `DELETE`: apagar e coisa do servidor, com credencial,
               * e nunca do navegador.
               */
              AllowedMethods: ["PUT", "GET", "HEAD"],
              /**
               * `content-type` porque ele faz parte da assinatura e o
               * navegador o manda no preflight. Sem ele na lista, o preflight
               * falha e o PUT nem acontece.
               */
              AllowedHeaders: ["content-type"],
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
    console.log("\n  ok    politica aplicada");
    await ver();
  } catch (erro) {
    console.log(`\n  FALHA ao aplicar: ${erro.name} — ${erro.message}`);
    console.log(
      "\nSe for permissao, o token de API precisa ser de ADMIN do bucket\n" +
        "(Object Read & Write nao configura CORS). Da para fazer pelo painel:\n" +
        "  R2 -> o bucket -> Settings -> CORS Policy",
    );
    process.exitCode = 1;
  }
}

main().catch((erro) => {
  console.error("erro:", erro.message);
  process.exitCode = 1;
});
