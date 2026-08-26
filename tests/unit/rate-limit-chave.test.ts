import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de codigo-fonte: nenhum limitador do gateway pode ser chaveado pela
 * CONEXAO.
 *
 * POR QUE UM TESTE QUE LE O FONTE, e nao um teste de comportamento.
 *
 * O bug real era `limiter.take(socket.id)`. O limitador em si estava certo — a
 * unidade passava em todos os testes, e continuaria passando. O erro estava no
 * ARGUMENTO, e para provar isso por comportamento seria preciso subir o
 * gateway, autenticar duas conexoes com o mesmo cookie e contar mensagens
 * aceitas: um teste de integracao caro, lento, e que ninguem rodaria antes de
 * um commit apressado.
 *
 * A propriedade que importa e sintatica, entao a verificacao pode ser
 * sintatica. Este teste roda em milissegundos e falha exatamente quando alguem
 * reintroduz o bypass — inclusive num handler que ainda nem existe.
 *
 * O QUE ELE NAO COBRE: alguem pode escrever `const chave = socket.id` e passar
 * `chave`. Uma guarda de fonte pega o descuido, nao a burla deliberada. Como o
 * risco aqui e descuido — foi um descuido que criou o bug —, o alcance serve.
 */

const HANDLERS = join(process.cwd(), "apps/realtime/src/handlers");

const ARQUIVOS = ["messages.ts", "voice.ts", "presence.ts"];

describe("chave dos limitadores do gateway", () => {
  for (const arquivo of ARQUIVOS) {
    it(`${arquivo} nao chaveia rate limit por socket`, () => {
      const fonte = readFileSync(join(HANDLERS, arquivo), "utf8");

      /**
       * `.take(socket.id)` e `.forget(socket.id)` em qualquer limitador.
       * `forget` entra junto porque era o segundo bypass: limpar no disconnect
       * fazia de reconectar um jeito de zerar o balde.
       */
      const porSocket = fonte.match(/\.(take|forget)\(\s*socket\.id\s*\)/g);

      expect(porSocket, `use userId como chave, nao socket.id`).toBeNull();
    });
  }

  it("todo take() encontrado usa userId", () => {
    /**
     * O espelho do teste acima: aquele prova a ausencia do errado, este prova
     * a presenca do certo. Sem ele, apagar todos os limites tambem passaria —
     * zero chamadas com `socket.id` e zero protecao dao o mesmo resultado.
     */
    const chamadas = ARQUIVOS.flatMap((arquivo) => {
      const fonte = readFileSync(join(HANDLERS, arquivo), "utf8");
      return [...fonte.matchAll(/\w*[Ll]imiter\.take\(([^)]*)\)/g)].map(
        (m) => `${arquivo}: ${m[1]}`,
      );
    });

    // Os quatro limites que existem hoje: chat, fala, entrada em voz e presenca.
    expect(chamadas.length).toBeGreaterThanOrEqual(4);
    for (const chamada of chamadas) {
      expect(chamada).toMatch(/userId$/);
    }
  });
});
