/**
 * O R2 esta configurado e funcionando?
 *
 * Roda o ciclo inteiro contra o bucket de verdade: assina um envio, envia,
 * confere o tamanho, le pela URL publica e apaga. Se qualquer passo falhar,
 * diz QUAL — porque "nao consegui enviar" pode ser credencial errada, bucket
 * errado, token sem permissao de escrita ou URL publica desligada, e cada um
 * desses se conserta num lugar diferente.
 *
 * Uso:
 *   npx dotenv -e .env -- node scripts/verificar-r2.mjs
 */
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let passou = 0;
let falhou = 0;

function ok(rotulo, detalhe = "") {
  passou += 1;
  console.log(`  ok    ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
}
function falha(rotulo, detalhe = "") {
  falhou += 1;
  console.log(`  FALHA ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
}

async function main() {
  console.log("\nConfiguracao");

  const faltando = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "R2_PUBLIC_URL",
  ].filter((nome) => !process.env[nome]);

  if (faltando.length > 0) {
    falha("variaveis presentes no .env", `faltam: ${faltando.join(", ")}`);
    console.log(
      "\nCrie o bucket e o token no painel da Cloudflare e adicione as\n" +
        "variaveis no .env DA RAIZ. Sem elas nao ha o que testar.",
    );
    console.log(`\n${passou} passaram, ${falhou} falharam`);
    process.exitCode = 1;
    return;
  }
  ok("variaveis presentes no .env");

  const bucket = process.env.R2_BUCKET;
  const publicUrl = process.env.R2_PUBLIC_URL.replace(/\/+$/, "");
  const cliente = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  const chave = `teste/verificacao-${Date.now()}.txt`;
  const conteudo = Buffer.from(
    `verificacao do R2 em ${new Date().toISOString()}\n`,
    "utf8",
  );

  console.log("\nO ciclo de um anexo");

  // 1. assinar, do mesmo jeito que a aplicacao assina
  let urlAssinada;
  try {
    urlAssinada = await getSignedUrl(
      cliente,
      new PutObjectCommand({
        Bucket: bucket,
        Key: chave,
        ContentType: "text/plain",
        ContentLength: conteudo.length,
      }),
      { expiresIn: 600 },
    );
    ok("assinar a URL de envio");
  } catch (erro) {
    falha("assinar a URL de envio", erro.message);
    console.log(`\n${passou} passaram, ${falhou} falharam`);
    process.exitCode = 1;
    return;
  }

  // 2. enviar SEM credencial, como o navegador faz
  try {
    const r = await fetch(urlAssinada, {
      method: "PUT",
      headers: {
        "content-type": "text/plain",
        "content-length": String(conteudo.length),
      },
      body: conteudo,
    });
    if (r.ok) {
      ok("enviar pela URL assinada, sem credencial");
    } else {
      falha(
        "enviar pela URL assinada",
        `HTTP ${r.status} — o token tem permissao de ESCRITA neste bucket?`,
      );
    }
  } catch (erro) {
    falha("enviar pela URL assinada", erro.message);
  }

  // 3. o tamanho assinado e mesmo obrigatorio?
  try {
    const r = await fetch(urlAssinada, {
      method: "PUT",
      headers: { "content-type": "text/plain", "content-length": "5" },
      body: Buffer.from("XXXXX"),
    });
    if (r.ok) {
      falha(
        "recusar envio de tamanho diferente do assinado",
        "o R2 ACEITOU outro tamanho — o teto por plano nao valeria nada",
      );
    } else {
      ok("recusar envio de tamanho diferente do assinado", `HTTP ${r.status}`);
    }
  } catch {
    ok("recusar envio de tamanho diferente do assinado", "recusado na conexao");
  }

  // 4. conferir o que chegou
  try {
    const head = await cliente.send(
      new HeadObjectCommand({ Bucket: bucket, Key: chave }),
    );
    if (head.ContentLength === conteudo.length) {
      ok("conferir o tamanho no R2", `${head.ContentLength} bytes`);
    } else {
      falha(
        "conferir o tamanho no R2",
        `${head.ContentLength} != ${conteudo.length}`,
      );
    }
  } catch (erro) {
    falha("conferir o tamanho no R2", erro.message);
  }

  // 5. ler pela URL publica — e o que os outros usuarios vao fazer
  try {
    const r = await fetch(`${publicUrl}/${chave}`);
    if (r.ok) {
      const texto = await r.text();
      if (texto === conteudo.toString("utf8")) {
        ok("ler pela URL publica");
      } else {
        falha("ler pela URL publica", "conteudo diferente do enviado");
      }
    } else {
      falha(
        "ler pela URL publica",
        `HTTP ${r.status} — o Public Development URL esta ligado no bucket?`,
      );
    }
  } catch (erro) {
    falha("ler pela URL publica", erro.message);
  }

  // 6. apagar, para o teste nao deixar lixo
  try {
    await cliente.send(new DeleteObjectCommand({ Bucket: bucket, Key: chave }));
    ok("apagar o objeto");
  } catch (erro) {
    falha("apagar o objeto", erro.message);
  }

  console.log(`\n${passou} passaram, ${falhou} falharam`);
  if (falhou > 0) process.exitCode = 1;
}

main().catch((erro) => {
  console.error("erro inesperado:", erro);
  process.exitCode = 1;
});
