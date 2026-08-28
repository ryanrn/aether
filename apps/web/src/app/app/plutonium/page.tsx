import { redirect } from "next/navigation";

/**
 * Rota antiga, mantida so para nao quebrar link.
 *
 * O desenho chegou com `/app/plutonium` e a pagina de verdade mora em
 * `/app/vip`. Duas rotas para a mesma tela e o mesmo problema da tabela
 * duplicada, so que em endereco: uma delas recebe manutencao e a outra
 * apodrece, e ninguem sabe qual e qual — aqui, a copia nem lia o plano da
 * pessoa, entao quem entrasse por ela apareceria como gratuito mesmo sendo
 * assinante.
 *
 * Redireciona em vez de sumir porque o endereco pode ter sido colado em algum
 * lugar. Quando o nome definitivo do plano for escolhido, esta rota morre.
 */
export default function PlutoniumPage() {
  redirect("/app/vip");
}
