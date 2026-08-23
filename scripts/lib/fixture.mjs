/**
 * Pre-condicoes dos scripts de verificacao.
 *
 * Por que existe: os scripts usam os usuarios de seed (`ryan` dono, `joao`
 * membro) num servidor real. Moderar de verdade — expulsar ou banir o `joao`
 * enquanto testa — quebra essa suposicao, e o resultado eram QUINZE falhas
 * espalhadas em vez de uma frase dizendo o que aconteceu.
 *
 * Um conjunto de testes que falha de forma obscura quando o cenario muda gasta
 * mais tempo do que economiza. Aqui a checagem acontece antes de tudo e diz
 * exatamente o que fazer.
 */

export async function requireSeedFixture(prisma) {
  const owner = await prisma.user.findUnique({ where: { username: "ryan" } });
  const member = await prisma.user.findUnique({ where: { username: "joao" } });

  if (!owner || !member) {
    fail("Usuarios de seed nao encontrados.", "npm run db:seed");
  }

  const server = await prisma.server.findFirst({ where: { ownerId: owner.id } });
  if (!server) {
    fail("Servidor de seed nao encontrado.", "npm run db:seed");
  }

  const banned = await prisma.ban.findUnique({
    where: { serverId_userId: { serverId: server.id, userId: member.id } },
  });
  if (banned) {
    fail(
      `O usuario de teste "joao" esta BANIDO de "${server.name}".`,
      'Revogue o banimento em Configuracoes > Banimentos, ou rode:\n' +
        "  npx dotenv -e .env -- node scripts/restore-fixture.mjs",
    );
  }

  const membership = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId: server.id, userId: member.id } },
  });
  if (!membership) {
    fail(
      `O usuario de teste "joao" nao e mais membro de "${server.name}".`,
      "Provavelmente foi expulso durante um teste de moderacao. Restaure com:\n" +
        "  npx dotenv -e .env -- node scripts/restore-fixture.mjs",
    );
  }

  const defaultRole = await prisma.role.findFirst({
    where: { serverId: server.id, isDefault: true },
    select: { id: true },
  });
  if (!defaultRole) {
    fail("Cargo padrao nao encontrado no servidor de seed.", "npm run db:seed");
  }

  return { owner, member, server, membership, defaultRole };
}

/**
 * Quantos clientes ja estao conectados ao gateway antes do teste comecar.
 *
 * Por que importa: a presenca conta por USUARIO, nao por socket. Se o "joao"
 * ja estiver conectado por uma aba do navegador, o `server:join` do script nao
 * o torna presente — ele ja era — e o gateway, corretamente, nao anuncia nada.
 * As assercoes de "ficar online" e "ficar offline" passam a descrever a aba
 * aberta, nao o codigo.
 *
 * Isto NAO bloqueia o teste, de proposito: barrar as outras quarenta assercoes
 * por causa de duas seria trocar um resultado enganoso por nenhum resultado.
 * Quem chama usa o retorno para PULAR as assercoes afetadas e dizer isso em
 * voz alta — o mesmo idioma que este projeto ja usa para caso sem cenario.
 *
 * Devolve 0 quando o gateway esta fora do ar: isso e problema do proprio
 * teste, que tem mensagem propria para o caso.
 */
export async function connectedClients(baseUrl) {
  const { get } = baseUrl.startsWith("https:")
    ? await import("node:https")
    : await import("node:http");

  try {
    /**
     * `http.get` com `agent: false` em vez de `fetch`: o fetch do Node devolve
     * o socket a um pool com keep-alive, e um process.exit() logo em seguida
     * derruba o libuv no Windows com assercao nativa (UV_HANDLE_CLOSING) — o
     * script morreria com codigo 127 em vez do codigo de falha real.
     */
    const health = await new Promise((resolve, reject) => {
      const request = get(
        `${baseUrl}/health`,
        { agent: false, timeout: 4000 },
        (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            resolve(null);
            return;
          }
          let raw = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (raw += chunk));
          response.on("end", () => {
            try {
              resolve(JSON.parse(raw));
            } catch {
              resolve(null);
            }
          });
        },
      );
      request.on("timeout", () => request.destroy(new Error("timeout")));
      request.on("error", reject);
    });

    return typeof health?.sockets === "number" ? health.sockets : 0;
  } catch {
    return 0;
  }
}

/** Aviso padrao quando ha cliente alheio conectado. */
/** Mesma forma do "-- ... teste nao rodou" que os scripts ja usam. */
export function skipped(label, why) {
  console.log(`  --    ${label}: ${why}`);
}

export function warnBusyGateway(sockets) {
  if (sockets <= 0) return;
  console.log("");
  console.log(
    `  aviso: ${sockets} cliente(s) ja conectado(s) ao gateway (aba do app aberta?).`,
  );
  console.log("         Assercoes que dependem de ninguem mais estar online serao PULADAS.");
  console.log("         Feche as abas do app e rode de novo para cobertura completa.");
}

function fail(problem, remedy) {
  console.log(`\n${problem}\n${remedy}\n`);
  process.exit(1);
}
