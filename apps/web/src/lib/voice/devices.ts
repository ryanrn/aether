"use client";

/**
 * Escolha do microfone.
 *
 * Duas coisas que nao sao obvias sobre dispositivos no navegador:
 *
 * 1. Os NOMES so aparecem depois de a pessoa ter concedido acesso ao
 *    microfone alguma vez. Antes disso, `enumerateDevices` devolve entradas
 *    com label vazia — por isso a lista fora de uma call mostra rotulos
 *    genericos em vez de mentir com nomes inventados.
 *
 * 2. O id do dispositivo NAO e estavel entre navegadores nem entre perfis, e
 *    pode mudar quando o aparelho e desconectado. Guardamos a preferencia, mas
 *    tratamos "sumiu" como caso normal: cai no padrao do sistema em vez de
 *    ficar sem audio.
 */

const STORAGE_KEY = "aether:microphone";

export interface AudioDevice {
  deviceId: string;
  label: string;
}

export async function listMicrophones(): Promise<AudioDevice[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "audioinput")
      // `default` e `communications` sao apelidos do mesmo aparelho no Windows;
      // manter os dois faria a lista repetir a mesma entrada.
      .filter((device) => device.deviceId !== "communications")
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Microfone ${index + 1}`,
      }));
  } catch {
    return [];
  }
}

export function readPreferredMicrophone(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Modo privado ou armazenamento bloqueado: seguir sem preferencia.
    return null;
  }
}

export function savePreferredMicrophone(deviceId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (deviceId) window.localStorage.setItem(STORAGE_KEY, deviceId);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Preferencia nao persistida nao impede usar o dispositivo agora.
  }
}
