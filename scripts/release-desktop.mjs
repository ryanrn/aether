/**
 * Publica uma versao do app de desktop, sem os dois tropecos conhecidos.
 *
 * Uso:
 *   npm run release:desktop            # publica de vez
 *   npm run release:desktop -- --draft # deixa em rascunho para conferir antes
 *
 * ------------------------------------------------------------------
 * TROPECO 1 — "GitHub Personal Access Token is not set"
 *
 * O `git push` usa as credenciais do Git; o `electron-builder` sobe por API e
 * so enxerga a variavel `GH_TOKEN`. Quem roda o release direto num terminal
 * limpo builda 111 MB, assina tudo, e SO ENTAO descobre que nao tem como
 * enviar. Aqui o token sai do `gh auth token` e vai pelo ambiente do processo
 * filho — nunca aparece na tela nem no historico do shell.
 *
 * ------------------------------------------------------------------
 * TROPECO 2 — dois rascunhos com a mesma tag
 *
 * O `electron-builder` agenda UM PUBLISHER POR ARTEFATO. O `.exe` e o
 * `.blockmap` ficam prontos quase juntos, os dois publishers perguntam "a
 * release v0.1.X existe?" no mesmo instante, os dois ouvem "nao", e os dois
 * criam. O log mostra `creating GitHub release` duas vezes e o resultado sao
 * dois rascunhos: um com o instalador e o `latest.yml`, outro com so o
 * `.blockmap`.
 *
 * Isso e perigoso, e nao so bagunca: `gh release edit vX --draft=false`
 * resolve POR TAG. Se ele pegar o rascunho do `.blockmap`, sai uma release
 * sem instalador e o auto-update de todo mundo quebra.
 *
 * A cura e tirar a corrida: se a release JA EXISTE quando o build termina,
 * os dois publishers encontram a mesma e sobem no lugar certo. Por isso o
 * rascunho e criado aqui ANTES de chamar o electron-builder.
 * ------------------------------------------------------------------
 */
import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";

const RepoDeReleases = { owner: "ryanrn", repo: "aether-releases" };
const NOME = `${RepoDeReleases.owner}/${RepoDeReleases.repo}`;

const manterRascunho = process.argv.includes("--draft");

function morrer(mensagem, dica) {
  console.error(`\n✖ ${mensagem}`);
  if (dica) console.error(`  ${dica}`);
  process.exit(1);
}

/** `gh` sem herdar stdout, para a saida nao poluir o log do release. */
function gh(args, { permitirFalha = false } = {}) {
  const r = spawnSync("gh", args, { encoding: "utf8" });
  if (r.error) {
    morrer(
      "nao encontrei o `gh` (GitHub CLI).",
      "Instale em https://cli.github.com e rode `gh auth login`.",
    );
  }
  if (r.status !== 0 && !permitirFalha) {
    morrer(`falhou: gh ${args.join(" ")}`, (r.stderr || "").trim());
  }
  return { ok: r.status === 0, saida: (r.stdout || "").trim() };
}

// 1. versao — a fonte da verdade e o package.json do desktop
const versao = JSON.parse(
  readFileSync("apps/desktop/package.json", "utf8"),
).version;
const tag = `v${versao}`;

/**
 * 2. As notas da versao.
 *
 * MESMA FONTE da tela "Veja o que mudou" que o app abre no primeiro boot
 * (`apps/web/src/lib/novidades.ts`). Se o corpo da release no GitHub fosse
 * escrito a mao aqui, as duas divergiriam na primeira pressa — e a tela e o
 * site diriam coisas diferentes sobre a mesma versao.
 *
 * Sem entrada, a release nao sai. Publicar sem nota nao "quase funciona":
 * entrega uma tela de novidades vazia para todo mundo que atualizar.
 */
const ROTULOS = {
  recurso: "Novo recurso",
  performance: "Performance",
  correcao: "Correcoes",
  seguranca: "Seguranca",
};

function notasDaVersao(v) {
  const caminho = "apps/web/src/lib/novidades.json";
  let dados;
  try {
    dados = JSON.parse(readFileSync(caminho, "utf8"));
  } catch (erro) {
    morrer(`nao consegui ler ${caminho}.`, String(erro?.message ?? erro));
  }
  const entrada = dados[v];
  if (!entrada || !entrada.itens?.length) {
    morrer(
      `nao ha entrada para ${v} em ${caminho}.`,
      "Escreva o que mudou ANTES de publicar — e desse arquivo que sai tanto o " +
        'corpo da release quanto a tela "Veja o que mudou" dentro do app.',
    );
  }
  const linhas = entrada.itens.map(
    (i) => `- **${ROTULOS[i.categoria] ?? "Novo recurso"}** — ${i.texto}`,
  );
  return [entrada.resumo, "", ...linhas].join("\n");
}

const notas = notasDaVersao(versao);

// 3. token — falha ANTES de buildar, nao depois
let token;
try {
  token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
} catch {
  morrer(
    "o `gh` nao esta autenticado.",
    "Rode `gh auth login` — precisa do escopo `repo`.",
  );
}
if (!token) morrer("`gh auth token` devolveu vazio.");

console.log(`→ publicando ${tag} em ${NOME}`);

/**
 * 4. Recusar sobrescrever uma versao ja publicada.
 *
 * Republicar a mesma tag entrega um instalador diferente com o mesmo numero
 * de versao — quem ja atualizou nunca recebe a correcao, porque para o
 * updater ele ja esta na ultima. O certo e subir a versao no package.json.
 */
const jaExiste = gh(
  ["release", "view", tag, "--repo", NOME, "--json", "isDraft,url"],
  { permitirFalha: true },
);
if (jaExiste.ok) {
  const { isDraft, url } = JSON.parse(jaExiste.saida);
  if (!isDraft) {
    morrer(
      `${tag} ja esta PUBLICADA (${url}).`,
      "Suba a versao em apps/desktop/package.json — republicar a mesma tag " +
        "deixa quem ja atualizou sem receber a correcao.",
    );
  }
  console.log(`  rascunho de ${tag} ja existe, reaproveitando`);
} else {
  // 5. O rascunho nasce AQUI. E isto que impede os dois publishers de criarem
  //    um cada. Ver "TROPECO 2" no topo.
  gh([
    "release",
    "create",
    tag,
    "--repo",
    NOME,
    "--draft",
    "--title",
    versao,
    "--notes",
    notas,
  ]);
  console.log(`  rascunho ${tag} criado (evita a corrida dos publishers)`);
}

// 6. build + upload
const build = spawnSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "release", "--workspace=@aether/desktop"],
  { stdio: "inherit", env: { ...process.env, GH_TOKEN: token } },
);
if (build.status !== 0) {
  morrer(
    "o electron-builder falhou.",
    `O rascunho ${tag} ficou em https://github.com/${NOME}/releases — ` +
      "apague-o ou rode de novo depois de corrigir.",
  );
}

/**
 * 7. Conferir que os TRES arquivos subiram antes de tirar do rascunho.
 *
 * `latest.yml` e o que cada app baixa para saber que ha versao nova: sem ele
 * a release existe e ninguem atualiza. O `.blockmap` permite baixar so o
 * delta em vez dos 111 MB — sem ele atualiza, mas pesado.
 */
const detalhe = JSON.parse(
  gh(["release", "view", tag, "--repo", NOME, "--json", "assets,url"]).saida,
);
const nomes = detalhe.assets.map((a) => a.name);
const faltando = ["Aether-Setup.exe", "latest.yml"].filter(
  (n) => !nomes.includes(n),
);
if (faltando.length > 0) {
  morrer(
    `a release ficou incompleta: falta ${faltando.join(", ")}.`,
    `Deixei em RASCUNHO de proposito. Confira ${detalhe.url}`,
  );
}
if (!nomes.includes("Aether-Setup.exe.blockmap")) {
  console.warn(
    "  aviso: sem .blockmap — atualiza, mas baixando o instalador inteiro.",
  );
}
console.log(`  assets: ${nomes.join(", ")}`);

// 8. tirar do rascunho, POR ID (a tag pode ser ambigua se sobrou algum
//    rascunho velho de uma tentativa anterior)
if (manterRascunho) {
  console.log(`\n✓ ${tag} pronta em RASCUNHO: ${detalhe.url}`);
  console.log("  Para publicar: rode de novo sem --draft.");
  process.exit(0);
}

const id = JSON.parse(
  gh([
    "api",
    `repos/${NOME}/releases`,
    "--jq",
    `[.[] | select(.tag_name=="${tag}")] | map(.id)`,
  ]).saida,
);
if (id.length !== 1) {
  morrer(
    `achei ${id.length} releases com a tag ${tag}.`,
    "Nao vou adivinhar qual publicar — resolva em " +
      `https://github.com/${NOME}/releases`,
  );
}
gh(["api", "--method", "PATCH", `repos/${NOME}/releases/${id[0]}`, "-F", "draft=false"]);

console.log(`\n✓ ${tag} publicada: ${detalhe.url}`);
console.log("  O auto-update dos apps instalados pega nas proximas horas.");
