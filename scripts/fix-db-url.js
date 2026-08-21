/**
 * Corrige DATABASE_URL/DIRECT_URL que foram coladas com a senha crua:
 * extrai a senha como esta e aplica percent-encoding.
 * Nao imprime a senha.
 */
const fs = require("node:fs");
const path = require("node:path");

const envPath = path.resolve(process.cwd(), ".env");
let text = fs.readFileSync(envPath, "utf8");

const pattern = /^(DATABASE_URL|DIRECT_URL)\s*=\s*"?postgresql:\/\/([^:]+):(.*)@([^@"\r\n]+)"?$/gm;
let changed = 0;

text = text.replace(pattern, (full, key, user, rawPassword, rest) => {
  if (/%[0-9A-Fa-f]{2}/.test(rawPassword)) return full; // ja encodada
  const encoded = encodeURIComponent(rawPassword);
  if (encoded === rawPassword) return full;
  changed += 1;
  return `${key}="postgresql://${user}:${encoded}@${rest}"`;
});

if (changed === 0) {
  console.log("Nada a corrigir: as senhas ja estao escapadas.");
} else {
  fs.writeFileSync(envPath, text);
  console.log(`${changed} URL(s) corrigida(s) com percent-encoding.`);
}
