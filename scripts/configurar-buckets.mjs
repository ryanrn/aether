/**
 * Alinha os buckets do Supabase Storage com as regras que o codigo aplica.
 *
 * POR QUE PRECISA: o bucket recusa tipo e tamanho NA ORIGEM, antes do nosso
 * codigo ver qualquer coisa. Aceitar GIF de 10 MB no servidor sem mexer aqui
 * faz o envio falhar com uma recusa do Supabase — e o sintoma seria "o avatar
 * animado nao funciona", sem nada apontando para a configuracao do bucket.
 *
 * E o mesmo desenho do `configurar-cors-r2.mjs`: a regra vive no codigo, o
 * script empurra para o servico. Configurar pelo painel funciona uma vez e
 * ninguem lembra depois de qual era o valor nem por que.
 *
 * OS DOIS BUCKETS TEM REGRAS DIFERENTES, de proposito:
 *   - `avatars`      aceita GIF e vai a 10 MB (avatar animado do Olimpo Pro)
 *   - `server-icons` fica em 2 MB sem GIF: ninguem pediu icone animado, e ele
 *                    aparece na barra lateral de todo mundo o tempo todo
 *
 * Uso:
 *   npx dotenv -e .env -- node scripts/configurar-buckets.mjs
 *   npx dotenv -e .env -- node scripts/configurar-buckets.mjs --ver
 */
const URL_BASE = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const CHAVE = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Espelha `AVATAR_*` e `SERVER_ICON_*` de @aether/shared. */
const MB = 1024 * 1024;
const DESEJADO = {
  avatars: {
    public: true,
    file_size_limit: 10 * MB,
    allowed_mime_types: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  },
  "server-icons": {
    public: true,
    file_size_limit: 2 * MB,
    allowed_mime_types: ["image/png", "image/jpeg", "image/webp"],
  },
};

async function chamar(caminho, init = {}) {
  const r = await fetch(`${URL_BASE}/storage/v1${caminho}`, {
    ...init,
    headers: {
      authorization: `Bearer ${CHAVE}`,
      apikey: CHAVE,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const texto = await r.text();
  let corpo;
  try {
    corpo = JSON.parse(texto);
  } catch {
    corpo = texto;
  }
  return { ok: r.ok, status: r.status, corpo };
}

function descrever(b) {
  const limite = b.file_size_limit
    ? `${Math.round(b.file_size_limit / MB)}MB`
    : "sem limite";
  const tipos = b.allowed_mime_types ? b.allowed_mime_types.join(", ") : "qualquer";
  return `${limite} | ${tipos}`;
}

async function ver() {
  const { ok, corpo } = await chamar("/bucket");
  if (!ok) {
    console.log("nao consegui listar os buckets:", corpo);
    process.exitCode = 1;
    return;
  }
  for (const b of corpo) {
    console.log(`  ${b.name.padEnd(14)} publico:${b.public}  ${descrever(b)}`);
  }
}

async function main() {
  if (!URL_BASE || !CHAVE) {
    console.log("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente no .env");
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes("--ver")) {
    console.log("Como estao hoje:");
    return ver();
  }

  console.log("Antes:");
  await ver();
  console.log("");

  let falhou = 0;
  for (const [nome, regras] of Object.entries(DESEJADO)) {
    const r = await chamar(`/bucket/${nome}`, {
      method: "PUT",
      body: JSON.stringify(regras),
    });
    if (r.ok) {
      console.log(`  ok    ${nome} -> ${descrever(regras)}`);
    } else {
      falhou += 1;
      console.log(`  FALHA ${nome} — HTTP ${r.status}: ${JSON.stringify(r.corpo)}`);
    }
  }

  console.log("\nDepois:");
  await ver();

  if (falhou > 0) {
    console.log(
      "\nSe falou em permissao, confira se a chave e a SERVICE_ROLE (a anon\n" +
        "nao configura bucket). Da para fazer pelo painel:\n" +
        "  Storage -> o bucket -> Configuration",
    );
    process.exitCode = 1;
  }
}

main().catch((erro) => {
  console.error("erro:", erro.message);
  process.exitCode = 1;
});
