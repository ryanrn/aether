/**
 * Reescreve DATABASE_URL e DIRECT_URL no .env a partir da senha CRUA do
 * Postgres, aplicando percent-encoding automaticamente.
 *
 * Motivo: senhas geradas pelo Supabase costumam ter caracteres (@ / ? # & = %)
 * que quebram a URL de conexao se coladas sem encode. Este script evita isso.
 *
 * Uso (na raiz do projeto):
 *   npm run db:password -- "sua-senha-crua-aqui"
 */
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_REF = "yrdyydyldkqhvawevyxu";
const POOLER_HOST = "aws-0-sa-east-1.pooler.supabase.com";

const senha = process.argv[2];
if (!senha) {
  console.error('Uso: npm run db:password -- "sua-senha"');
  process.exit(1);
}

const envPath = path.resolve(process.cwd(), ".env");
if (!fs.existsSync(envPath)) {
  console.error(".env nao encontrado. Copie o .env.example primeiro.");
  process.exit(1);
}

const encoded = encodeURIComponent(senha);
const user = `postgres.${PROJECT_REF}`;

const pooled = `postgresql://${user}:${encoded}@${POOLER_HOST}:6543/postgres?pgbouncer=true&connection_limit=1`;
const direct = `postgresql://${user}:${encoded}@${POOLER_HOST}:5432/postgres`;

let text = fs.readFileSync(envPath, "utf8");
const replaceLine = (key, value) => {
  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^${key}\\s*=.*$`, "m");
  text = pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
};

replaceLine("DATABASE_URL", pooled);
replaceLine("DIRECT_URL", direct);
fs.writeFileSync(envPath, text);

console.log("DATABASE_URL e DIRECT_URL atualizadas.");
console.log(`  usuario : ${user}`);
console.log(`  host    : ${POOLER_HOST} (6543 pooled / 5432 direto)`);
console.log(`  senha   : ${senha.length} chars${encoded !== senha ? " (com caracteres especiais, ja escapados)" : ""}`);
console.log("\nAgora rode:  npm run db:deploy");
