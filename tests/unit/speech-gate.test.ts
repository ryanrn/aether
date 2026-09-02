import { describe, expect, it, vi } from "vitest";
import { createSpeechGate } from "../../apps/web/src/lib/voice/speech-gate";

/**
 * A porta de fala e o que decide quando a bordinha de "falando" acende.
 *
 * O que importa provar:
 *  - ATAQUE IMEDIATO (ja aquecido): uma unica amostra acima do limiar abre.
 *    A versao antiga do detector nao tinha isto puro, e falas curtas nao
 *    acendiam nada.
 *  - RELEASE com folga: pausas curtas entre palavras nao apagam.
 *  - PISO ADAPTATIVO: ruido de fundo constante (ventilador, mixer) NAO conta
 *    como fala; voz acima desse ruido conta na hora.
 */

function coletar(warmupSamples = 0) {
  const eventos: boolean[] = [];
  const gate = createSpeechGate({
    onChange: (s) => eventos.push(s),
    warmupSamples,
  });
  return { gate, eventos };
}

/** Empurra `n` amostras de silencio para o aquecimento passar. */
function aquecer(gate: ReturnType<typeof createSpeechGate>, n = 8) {
  for (let i = 0; i < n; i += 1) gate.push(0.002, i * 30);
}

describe("createSpeechGate", () => {
  it("abre na PRIMEIRA amostra de fala depois de aquecido (ataque imediato)", () => {
    const { gate, eventos } = coletar(6);
    aquecer(gate);
    gate.push(0.05, 1000);
    expect(eventos).toEqual([true]);
  });

  it("nao abre durante o aquecimento, mesmo com energia alta", () => {
    const { gate, eventos } = coletar(6);
    gate.push(0.05, 0);
    gate.push(0.05, 30);
    expect(eventos).toEqual([]);
  });

  it("nao abre em sala silenciosa quando a energia fica no piso", () => {
    const { gate, eventos } = coletar(6);
    for (let t = 0; t < 2000; t += 30) gate.push(0.002, t);
    expect(eventos).toEqual([]);
  });

  it("nao apaga durante uma pausa curta entre palavras", () => {
    const { gate, eventos } = coletar(0);
    gate.push(0.06, 0);
    gate.push(0.001, 100); // pausa de 100ms (< release de 220)
    gate.push(0.06, 150);
    expect(eventos).toEqual([true]);
  });

  it("apaga depois de o silencio persistir alem do release", () => {
    const { gate, eventos } = coletar(0);
    gate.push(0.06, 0);
    gate.push(0.001, 100);
    gate.push(0.001, 400);
    expect(eventos).toEqual([true, false]);
  });

  it("ruido de fundo constante nao dispara, mas voz acima dele dispara", () => {
    const { gate, eventos } = coletar(6);
    // Ruido de fundo estavel em 0,02 (acima do piso absoluto de 0,009).
    for (let t = 0; t < 2000; t += 30) gate.push(0.02, t);
    expect(eventos).toEqual([]);
    // Voz claramente acima do ruido aprendido.
    gate.push(0.12, 2000);
    expect(eventos).toEqual([true]);
  });

  it("silence() forca o fechamento imediato (mute) e volta a reagir depois", () => {
    const { gate, eventos } = coletar(0);
    gate.push(0.08, 0);
    gate.silence();
    expect(eventos).toEqual([true, false]);
    gate.push(0.08, 500);
    expect(eventos).toEqual([true, false, true]);
  });

  it("nao repete onChange enquanto o estado nao muda", () => {
    const onChange = vi.fn();
    const gate = createSpeechGate({ onChange, warmupSamples: 0 });
    gate.push(0.08, 0);
    gate.push(0.09, 30);
    gate.push(0.08, 60);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
