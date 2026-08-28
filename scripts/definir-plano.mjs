/**
 * Concede (ou tira) um plano de uma conta, a mao.
 *
 * ENQUANTO NAO HA COBRANCA, este script E a forma de virar alguem premium —
 * equipe, teste, cortesia. Quando entrar Stripe ou Mercado Pago, o webhook
 * deles vai escrever NA MESMA TABELA e este script continua servindo para o
 * que cobranca nenhuma resolve: dar acesso a quem nao vai pagar.
 *
 * Uso:
 *   npx dotenv -e .env -- node scripts/definir-plano.mjs ryan PRO
 *   npx dotenv -e .env -- node scripts/definir-plano.mjs ryan PLUS 30
 *   npx dotenv -e .env -- node scripts/definir-plano.mjs ryan FREE
 *
 * O terceiro argumento e por quantos DIAS vale. Sem ele, a concessao nao
 * vence — que e o certo para conta de equipe e o errado para teste de cliente,
 * entao pense antes de omitir.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TIERS = ["FREE", "PLUS", "PRO"];

async function main() {
  const [alvo, tierBruto, diasBruto] = process.argv.slice(2);

  if (!alvo || !tierBruto) {
    console.log("uso: node scripts/definir-plano.mjs <usuario|email> <FREE|PLUS|PRO> [dias]");
    process.exitCode = 1;
    return;
  }

  const tier = tierBruto.toUpperCase();
  if (!TIERS.includes(tier)) {
    console.log(`plano invalido: ${tierBruto}. Use um de: ${TIERS.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  /**
   * Aceita nome de usuario OU email, porque na hora de conceder voce tem um
   * dos dois na mao e nunca o id.
   */
  const usuario = await prisma.user.findFirst({
    where: { OR: [{ username: alvo }, { email: alvo }] },
    select: { id: true, username: true, displayName: true },
  });

  if (!usuario) {
    console.log(`nao achei ninguem com usuario ou email "${alvo}"`);
    process.exitCode = 1;
    return;
  }

  const dias = diasBruto ? Number(diasBruto) : null;
  if (diasBruto && (!Number.isFinite(dias) || dias <= 0)) {
    console.log(`dias invalido: ${diasBruto}`);
    process.exitCode = 1;
    return;
  }

  const expiraEm = dias
    ? new Date(Date.now() + dias * 24 * 60 * 60 * 1000)
    : null;

  await prisma.subscription.upsert({
    where: { userId: usuario.id },
    create: {
      userId: usuario.id,
      tier,
      expiraEm,
      concedidoPor: "script",
      motivo: dias ? `concessao manual por ${dias} dias` : "concessao manual",
    },
    update: {
      tier,
      expiraEm,
      concedidoPor: "script",
      motivo: dias ? `concessao manual por ${dias} dias` : "concessao manual",
      /**
       * Concessao a mao LIMPA o vinculo com o provedor.
       *
       * Sem isso, uma conta que ja foi paga ficaria com o id da assinatura
       * antiga colado nela, e o proximo webhook daquele provedor sobrescreveria
       * a concessao sem ninguem entender por que.
       */
      provedor: null,
      idExterno: null,
    },
  });

  const validade = expiraEm
    ? `ate ${expiraEm.toISOString().slice(0, 16).replace("T", " ")}`
    : "sem validade";
  console.log(
    `${usuario.displayName} (@${usuario.username}) -> ${tier}, ${validade}`,
  );

  if (tier === "FREE") {
    console.log(
      "  (a linha continua no banco, agora como FREE — o historico serve para\n" +
        "   oferecer renovacao depois)",
    );
  }
}

main()
  .catch((erro) => {
    console.error("falhou:", erro.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
