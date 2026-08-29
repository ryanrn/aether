/** Contrato que toda fonte de evento cumpre — a live de verdade e o simulador. */
import type { RawEvent } from "../types.ts";

export type SourceState = "connecting" | "connected" | "offline" | "stopped";

export interface EventSource {
  readonly label: string;
  state(): SourceState;
  start(): void;
  stop(): Promise<void>;
}

export interface SourceOptions {
  emit: (event: RawEvent) => void;
  onState: (state: SourceState, detail?: string) => void;
}
