import { describe, expect, it } from "vitest";
// @ts-expect-error — modulo do desktop e JavaScript puro, sem tipos
import picker from "../../apps/desktop/src/picker.js";

const { decidirComPrefs } = picker;

/**
 * A memoria de "o som do compartilhamento falhou".
 *
 * Isto existe por causa de uma armadilha REAL da primeira versao: UMA falha
 * gravava `withAudio: false` para sempre. Quem trocasse de fone, plugasse o
 * cabo ou consertasse a configuracao continuava compartilhando mudo — sem
 * nenhuma pista do motivo, ate achar a caixinha escondida no seletor.
 *
 * A regra que precisa valer: a falha e lembrada COM o aparelho em que
 * aconteceu, e deixa de valer quando o aparelho muda.
 *
 * Testamos a funcao PURA de proposito. A versao anterior deste arquivo dublava
 * o Electron e o sistema de arquivos e falhava em tudo — porque o que estava
 * sendo exercitado era o duble, nao a regra. Separar a decisao do disco foi o
 * conserto, e nao um detalhe de teste.
 */

const FONE = "Alto-falantes (PRO X 2 LIGHTSPEED) (046d:0af7)";
const ONBOARD = "Alto-falantes (High Definition Audio Device)";

const falhaNo = (dispositivo: string) => ({
  withAudio: false,
  falha: {
    dispositivo,
    quando: "2026-08-23T19:00:00.000Z",
    erro: "NotReadableError: Could not start audio source",
  },
});

describe("decidirComPrefs", () => {
  it("sem historico, o som vem LIGADO — e o que a maioria espera", () => {
    expect(decidirComPrefs({}, FONE).withAudio).toBe(true);
    expect(decidirComPrefs(undefined, FONE).withAudio).toBe(true);
  });

  it("quem desmarcou na mao continua desmarcado", () => {
    expect(decidirComPrefs({ withAudio: false }, FONE).withAudio).toBe(false);
  });

  it("depois de falhar, fica desligado NAQUELE aparelho", () => {
    const decisao = decidirComPrefs(falhaNo(FONE), FONE);
    expect(decisao.withAudio).toBe(false);
    expect(decisao.falha?.dispositivo).toBe(FONE);
  });

  /**
   * O teste que existe por causa da armadilha. Trocar de saida tem de valer
   * uma tentativa nova: a falha era do aparelho, nao da pessoa.
   */
  it("TROCAR de aparelho volta a tentar o som sozinho", () => {
    const decisao = decidirComPrefs(falhaNo(FONE), ONBOARD);
    expect(decisao.withAudio).toBe(true);
    expect(decisao.falha).toBeNull();
  });

  it("e manda APAGAR a marca, nao so ignora-la", () => {
    const decisao = decidirComPrefs(falhaNo(FONE), ONBOARD);
    // `prefsNovas` sem `falha` e o que faz a marca sumir do disco. Sem isso,
    // voltar ao aparelho antigo ressuscitaria uma falha ja superada.
    expect(decisao.prefsNovas).toEqual({ withAudio: true });
  });

  /**
   * Conservador de proposito: sem saber o aparelho de agora, nao inventamos
   * otimismo. O custo de errar aqui e a captura INTEIRA falhar, video junto.
   */
  it("sem saber o aparelho atual, a falha continua valendo", () => {
    const decisao = decidirComPrefs(falhaNo(FONE), null);
    expect(decisao.withAudio).toBe(false);
    expect(decisao.prefsNovas).toBeNull();
  });

  it("no mesmo aparelho nao fica gravando a cada abertura do seletor", () => {
    expect(decidirComPrefs(falhaNo(FONE), FONE).prefsNovas).toBeNull();
  });

  it("o motivo volta junto, para a tela poder explicar", () => {
    const decisao = decidirComPrefs(falhaNo(FONE), FONE);
    expect(decisao.falha?.erro).toContain("Could not start audio source");
    expect(decisao.falha?.quando).toBe("2026-08-23T19:00:00.000Z");
  });
});
