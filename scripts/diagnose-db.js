/**
 * Diagnostica a senha atual em DATABASE_URL sem revela-la:
 * diz se ela parece ja estar percent-encoded ou se contem caracteres crus
 * que quebram a URL de conexao.
 */
const fs = require("node:fs");
const path = require("node:path");

const envPath = path.resolve(process.cwd(), ".env");
const text = fs.readFileSync(envPath, "utf8");
const match = text.match(/^DATABASE_URL\s*=\s*"?postgresql:\/\/([^:]+):(.*)@([^@"\r\n]+)"?$/m);

if (!match) {
  console.log("Nao consegui interpretar DATABASE_URL.");
  process.exit(0);
}

const [, user, rawPassword, rest] = match;
const looksEncoded = /%[0-9A-Fa-f]{2}/.test(rawPassword);
const problematic = [...new Set(rawPassword.split("").filter((c) => "@:/?#[]&= ".includes(c)))];

console.log(`usuario         : ${user}`);
console.log(`resto da URL    : ${rest}`);
console.log(`senha (tamanho) : ${rawPassword.length} chars`);
console.log(`parece encodada : ${looksEncoded}`);
console.log(
  `caracteres crus problematicos: ${problematic.length ? problematic.join(" ") : "nenhum"}`,
);
console.log(
  `\nConclusao: ${
    problematic.length
      ? "a senha tem caracteres que precisam de escape — rode  npm run db:password -- \"senha-crua\""
      : "a senha esta sintaticamente ok; se a autenticacao falha, ela nao confere com a do banco (resete no dashboard)"
  }`,
);
