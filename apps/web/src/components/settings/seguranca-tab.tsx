"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import QRCode from "qrcode";
import { AetherIcon } from "@/components/ui/aether-icon";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, FieldError, Input } from "@/components/ui/field";
import { copiarTexto } from "@/lib/clipboard";
import {
  confirmarConfiguracaoTotpAction,
  desativarTotpAction,
  estadoTotpAction,
  iniciarConfiguracaoTotpAction,
  regenerarCodigosDeBackupAction,
} from "@/server/actions/totp";
import type { EstadoTotp } from "@/server/services/totp";

/**
 * Autenticacao de dois fatores (TOTP, RFC 6238) — configuracao pela propria
 * pessoa.
 *
 * O SEGREDO SO APARECE UMA VEZ, durante a configuracao (`configurando`
 * abaixo) — depois de confirmado, a tela nunca mais pede o segredo de volta
 * do servidor; so o estado (ativo/inativo, quantos codigos de backup sobram).
 * Mesma regra dos codigos de backup: aparecem uma vez, na ativacao ou ao
 * gerar de novo, e depois so existem com quem guardou.
 */
export function SegurancaTab() {
  const [carregando, setCarregando] = useState(true);
  const [estado, setEstado] = useState<EstadoTotp | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function recarregar() {
    const r = await estadoTotpAction();
    if (r.ok) {
      setEstado(r.data);
      setErro(null);
    } else {
      setErro(r.error);
    }
    setCarregando(false);
  }

  useEffect(() => {
    void recarregar();
  }, []);

  // --- configuracao (ativar / continuar configuracao pendente) ---
  const [configurando, setConfigurando] = useState<{
    segredoBase32: string;
    otpauthUri: string;
  } | null>(null);
  const [iniciando, startIniciar] = useTransition();

  function comecarConfiguracao() {
    setErro(null);
    startIniciar(async () => {
      const r = await iniciarConfiguracaoTotpAction();
      if (!r.ok) {
        setErro(r.error);
        return;
      }
      setConfigurando(r.data);
    });
  }

  // --- codigos de backup mostrados uma vez (ativacao ou regeneracao) ---
  const [codigosNovos, setCodigosNovos] = useState<string[] | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-line bg-base-850 p-5">
        <div className="flex items-start gap-3">
          <AetherIcon
            name="shield-check"
            className="mt-0.5 h-5 w-5 shrink-0 text-accent-400"
          />
          <div>
            <h2 className="text-[14px] font-semibold text-ink-100">
              Autenticacao de dois fatores
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-400">
              Alem da senha, um codigo de 6 digitos do seu aplicativo
              autenticador (Google Authenticator, Authy, 1Password...) a cada
              login.
            </p>
          </div>
        </div>

        {erro ? <p className="mt-4 text-[13px] text-signal-dnd">{erro}</p> : null}

        {carregando ? (
          <p className="mt-4 text-[13px] text-ink-500">Carregando…</p>
        ) : configurando ? (
          <PassoDeConfirmacao
            dados={configurando}
            onCancelar={() => setConfigurando(null)}
            onConfirmado={(codigosDeBackup) => {
              setConfigurando(null);
              setCodigosNovos(codigosDeBackup);
              void recarregar();
            }}
          />
        ) : estado?.habilitado ? (
          <PainelAtivo
            estado={estado}
            onMudou={(novoEstado) => setEstado(novoEstado)}
            onNovosCodigos={setCodigosNovos}
          />
        ) : (
          <div className="mt-4">
            <p className="mb-3 text-[13px] text-ink-400">
              {estado?.configurado
                ? "Uma configuracao foi comecada mas nao terminou. Comece de novo — o segredo antigo, se nao confirmado, deixa de valer."
                : "Esta desativado nesta conta."}
            </p>
            <Button variant="primary" onClick={comecarConfiguracao} disabled={iniciando}>
              <AetherIcon name="shield" className="h-4 w-4" />
              {iniciando ? "Preparando…" : "Ativar 2FA"}
            </Button>
          </div>
        )}
      </section>

      {codigosNovos ? (
        <CodigosDeBackupModal
          codigos={codigosNovos}
          onFechar={() => setCodigosNovos(null)}
        />
      ) : null}
    </div>
  );
}

/** QR + segredo manual + campo de confirmacao — o unico momento em que o segredo aparece. */
function PassoDeConfirmacao({
  dados,
  onCancelar,
  onConfirmado,
}: {
  dados: { segredoBase32: string; otpauthUri: string };
  onCancelar: () => void;
  onConfirmado: (codigosDeBackup: string[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copiado, setCopiado] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, startConfirmar] = useTransition();

  useEffect(() => {
    if (canvasRef.current) {
      void QRCode.toCanvas(canvasRef.current, dados.otpauthUri, { width: 176, margin: 1 });
    }
  }, [dados.otpauthUri]);

  function copiarSegredo() {
    void copiarTexto(dados.segredoBase32).then((ok) => {
      if (!ok) return;
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    });
  }

  function confirmar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    startConfirmar(async () => {
      const r = await confirmarConfiguracaoTotpAction(codigo);
      if (!r.ok) {
        setErro(r.error);
        return;
      }
      onConfirmado(r.data.codigosDeBackup);
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex flex-col items-start gap-4 sm:flex-row">
        <canvas
          ref={canvasRef}
          className="shrink-0 rounded-md border border-line bg-white p-2"
        />
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-[13px] text-ink-300">
            Escaneie com o aplicativo autenticador. Sem camera a mao? Digite o
            codigo manualmente:
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-sm border border-line-strong bg-base-950 px-3 py-2 font-mono text-[13px] tracking-wide text-ink-100">
              {dados.segredoBase32}
            </code>
            <button
              type="button"
              onClick={copiarSegredo}
              className="flex shrink-0 items-center gap-1.5 rounded-sm border border-line-strong bg-base-800 px-3 py-2 text-[12px] font-medium text-ink-200 transition-colors hover:bg-base-750"
            >
              <AetherIcon name={copiado ? "clipboard-check" : "copy"} className="h-3.5 w-3.5" />
              {copiado ? "Copiado" : "Copiar"}
            </button>
          </div>
        </div>
      </div>

      <form onSubmit={confirmar} className="flex flex-col gap-3 border-t border-line-soft pt-4">
        <Field label="Codigo do autenticador" required>
          <Input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            inputMode="numeric"
            autoFocus
            placeholder="000000"
            aria-invalid={erro !== null}
          />
        </Field>
        <FieldError>{erro}</FieldError>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={confirmando}>
            {confirmando ? "Confirmando…" : "Confirmar e ativar"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancelar} disabled={confirmando}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}

function PainelAtivo({
  estado,
  onMudou,
  onNovosCodigos,
}: {
  estado: EstadoTotp;
  onMudou: (novoEstado: EstadoTotp) => void;
  onNovosCodigos: (codigos: string[]) => void;
}) {
  const [acao, setAcao] = useState<"desativar" | "regenerar" | null>(null);

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded-md border border-signal-online/30 bg-signal-online/10 px-3 py-2">
        <AetherIcon name="shield-check" className="h-4 w-4 text-signal-online" />
        <p className="text-[13px] font-medium text-signal-online">2FA ativo</p>
      </div>

      <p className="text-[13px] text-ink-400">
        <strong className="text-ink-200">
          {estado.codigosDeBackupRestantes}
        </strong>{" "}
        {estado.codigosDeBackupRestantes === 1
          ? "codigo de backup restante."
          : "codigos de backup restantes."}{" "}
        Servem para entrar se voce perder o acesso ao autenticador.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setAcao("regenerar")}>
          <AetherIcon name="refresh" className="h-4 w-4" />
          Gerar novos codigos de backup
        </Button>
        <Button variant="danger" onClick={() => setAcao("desativar")}>
          Desativar 2FA
        </Button>
      </div>

      {acao ? (
        <SenhaParaAcaoModal
          acao={acao}
          onFechar={() => setAcao(null)}
          onDesativado={() =>
            onMudou({ configurado: false, habilitado: false, codigosDeBackupRestantes: 0 })
          }
          onRegenerado={(codigos) => {
            onNovosCodigos(codigos);
            onMudou({ ...estado, codigosDeBackupRestantes: codigos.length });
          }}
        />
      ) : null}
    </div>
  );
}

/** Pede a senha de novo — desativar ou revelar novos codigos de backup reduz
 * ou repete a proteção da conta, e a sessao sozinha nao basta para isso. */
function SenhaParaAcaoModal({
  acao,
  onFechar,
  onDesativado,
  onRegenerado,
}: {
  acao: "desativar" | "regenerar";
  onFechar: () => void;
  onDesativado: () => void;
  onRegenerado: (codigos: string[]) => void;
}) {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [executando, startExecutar] = useTransition();

  function confirmar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    startExecutar(async () => {
      if (acao === "desativar") {
        const r = await desativarTotpAction(senha);
        if (!r.ok) {
          setErro(r.error);
          return;
        }
        onDesativado();
      } else {
        const r = await regenerarCodigosDeBackupAction(senha);
        if (!r.ok) {
          setErro(r.error);
          return;
        }
        onRegenerado(r.data.codigosDeBackup);
      }
      onFechar();
    });
  }

  return (
    <Modal
      open
      onClose={onFechar}
      title={acao === "desativar" ? "Desativar 2FA" : "Gerar novos codigos de backup"}
      className="max-w-[380px]"
    >
      <form onSubmit={confirmar} className="flex flex-col gap-3">
        <p className="text-[13px] leading-relaxed text-ink-300">
          {acao === "desativar"
            ? "Sua conta fica so com a senha. Digite a senha para confirmar."
            : "Os codigos antigos deixam de valer, mesmo os que nunca foram usados. Digite a senha para confirmar."}
        </p>
        <Field label="Senha" required>
          <Input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoFocus
            autoComplete="current-password"
            aria-invalid={erro !== null}
          />
        </Field>
        <FieldError>{erro}</FieldError>
        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onFechar} disabled={executando}>
            Cancelar
          </Button>
          <Button type="submit" variant="danger" disabled={executando}>
            {executando ? "Confirmando…" : "Confirmar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Os codigos aparecem UMA vez — nem ativar de novo nem regenerar os trazem de volta. */
function CodigosDeBackupModal({
  codigos,
  onFechar,
}: {
  codigos: string[];
  onFechar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const [salvei, setSalvei] = useState(false);

  function copiarTodos() {
    void copiarTexto(codigos.join("\n")).then((ok) => {
      if (!ok) return;
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    });
  }

  return (
    <Modal
      open
      onClose={() => {
        /* so fecha pelo botao de confirmacao — ver `salvei` abaixo */
      }}
      title="Seus codigos de backup"
      className="max-w-[420px]"
    >
      <p className="text-[13px] leading-relaxed text-ink-300">
        Guarde num lugar seguro. Cada um entra na conta UMA vez, no lugar do
        codigo do autenticador — util se voce perder o acesso a ele. Depois de
        fechar esta tela, eles nao aparecem de novo.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 rounded-md border border-line-strong bg-base-950 p-3 font-mono text-[13px] text-ink-100">
        {codigos.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>

      <button
        type="button"
        onClick={copiarTodos}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-sm border border-line-strong bg-base-800 px-3 py-2 text-[12px] font-medium text-ink-200 transition-colors hover:bg-base-750"
      >
        <AetherIcon name={copiado ? "clipboard-check" : "copy"} className="h-3.5 w-3.5" />
        {copiado ? "Copiado" : "Copiar todos"}
      </button>

      <label className="mt-4 flex items-center gap-2 text-[13px] text-ink-300">
        <input
          type="checkbox"
          checked={salvei}
          onChange={(e) => setSalvei(e.target.checked)}
        />
        Ja guardei estes codigos
      </label>

      <div className="mt-4 flex justify-end">
        <Button variant="primary" onClick={onFechar} disabled={!salvei}>
          Concluir
        </Button>
      </div>
    </Modal>
  );
}
