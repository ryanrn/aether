// Diagnostico local do arquivo de ambiente. Nao imprime senha nenhuma.
const fs = require("node:fs");
const path = require("node:path");

const file = process.argv[2] || ".env";
const full = path.resolve(process.cwd(), file);

if (!fs.existsSync(full)) {
  console.log(`${file}: NAO EXISTE`);
  process.exit(0);
}

const text = fs.readFileSync(full, "utf8");
const get = (key) => {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*"?([^"\\r\\n]*)"?`, "m"));
  return match ? match[1] : null;
};

function describeUrl(key) {
  const raw = get(key);
  if (!raw) return console.log(`${key}: AUSENTE`);
  if (raw.includes("SUA_SENHA")) return console.log(`${key}: placeholder nao substituido`);
  try {
    const u = new URL(raw);
    const senha = decodeURIComponent(u.password || "");
    const precisaEncode = /[@:/?#\[\]%&= ]/.test(senha);
    console.log(`${key}:`);
    console.log(`  usuario : ${u.username}`);
    console.log(`  host    : ${u.hostname}`);
    console.log(`  porta   : ${u.port}`);
    console.log(`  db      : ${u.pathname.replace("/", "")}`);
    console.log(`  query   : ${u.search || "(vazia)"}`);
    console.log(`  senha   : ${senha.length} chars, precisa de URL-encode: ${precisaEncode}`);
  } catch (error) {
    console.log(`${key}: URL malformada (${error.message})`);
  }
}

console.log(`arquivo: ${file}\n`);
describeUrl("DATABASE_URL");
console.log("");
describeUrl("DIRECT_URL");
console.log("");
const secret = get("AUTH_SECRET");
console.log(`AUTH_SECRET: ${secret ? `${secret.length} chars` : "AUSENTE"}`);
