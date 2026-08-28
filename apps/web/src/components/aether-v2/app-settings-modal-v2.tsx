"use client";

import { useState } from "react";
import {
  X,
  User,
  Shield,
  Bell,
  Sparkles,
  CreditCard,
  Mic,
  Palette,
  Eye,
  Monitor,
  Search,
  CheckCircle2,
  ChevronRight,
  Edit3,
  Crown,
  KeyRound,
  Laptop,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MicrophoneTest } from "@/components/aether-design-v2";
import { cn } from "@/lib/utils";

export interface AppSettingsModalV2Props {
  open: boolean;
  onClose: () => void;
  user?: {
    displayName: string;
    username: string;
    email?: string;
    phone?: string;
    avatarUrl?: string | null;
  };
}

type SettingsSection =
  | "conta"
  | "seguranca"
  | "olimpo"
  | "voz"
  | "aparencia"
  | "notificacoes";

export function AppSettingsModalV2({
  open,
  onClose,
  user = {
    displayName: "ryu",
    username: "ryanzin",
    email: "ryu@aether.gg",
    phone: "+55 11 99999-1118",
  },
}: AppSettingsModalV2Props) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("conta");
  const [searchQuery, setSearchQuery] = useState("");
  const [showEmail, setShowEmail] = useState(false);
  const [showPhone, setShowPhone] = useState(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in-fast">
      <div
        className={cn(
          "relative flex h-[85vh] w-[92vw] max-w-[1024px] overflow-hidden rounded-2xl",
          "border border-base-750 bg-base-950 shadow-pop text-ink-100",
        )}
      >
        {/* Sidebar Esquerda das Configurações (Print 4) */}
        <aside className="flex w-64 shrink-0 flex-col border-r border-base-800 bg-base-900 p-4 select-none">
          {/* Card Resumido do Usuário no Topo */}
          <div className="flex items-center gap-3 pb-3 border-b border-base-800 mb-3">
            <div className="h-10 w-10 shrink-0 rounded-full bg-base-800 flex items-center justify-center font-bold text-white text-sm overflow-hidden">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.displayName} className="h-full w-full object-cover" />
              ) : (
                <span>{user.displayName.slice(0, 2).toUpperCase()}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-xs text-ink-100 truncate">{user.displayName}</p>
              <button
                type="button"
                onClick={() => setActiveSection("conta")}
                className="text-[11px] text-accent-400 hover:underline flex items-center gap-1 mt-0.5"
              >
                <span>Editar perfil</span>
                <Edit3 className="h-2.5 w-2.5" />
              </button>
            </div>
          </div>

          {/* Campo de Busca Interna */}
          <div className="relative mb-3">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar"
              className="h-8 w-full rounded-md bg-base-950 pl-8 pr-2 text-xs text-ink-100 placeholder:text-ink-500 border border-base-800 focus:border-base-700 focus:outline-none"
            />
          </div>

          {/* Navegação de Seções */}
          <div className="flex-1 overflow-y-auto flex flex-col gap-4 pr-1">
            {/* GRUPO CONTA */}
            <div className="flex flex-col gap-0.5">
              <span className="px-2 text-[10.5px] font-bold uppercase tracking-wider text-ink-400">
                Conta
              </span>
              <button
                type="button"
                onClick={() => setActiveSection("conta")}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-xs font-semibold transition-colors",
                  activeSection === "conta"
                    ? "bg-base-800 text-ink-100"
                    : "text-ink-300 hover:bg-base-850 hover:text-ink-100",
                )}
              >
                <User className="h-4 w-4" />
                <span>Informações da conta</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveSection("seguranca")}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-xs font-semibold transition-colors",
                  activeSection === "seguranca"
                    ? "bg-base-800 text-ink-100"
                    : "text-ink-300 hover:bg-base-850 hover:text-ink-100",
                )}
              >
                <Shield className="h-4 w-4" />
                <span>Senha e segurança</span>
              </button>
            </div>

            {/* GRUPO COBRANÇA */}
            <div className="flex flex-col gap-0.5">
              <span className="px-2 text-[10.5px] font-bold uppercase tracking-wider text-ink-400">
                Cobrança
              </span>
              <button
                type="button"
                onClick={() => setActiveSection("olimpo")}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-xs font-semibold transition-colors",
                  activeSection === "olimpo"
                    ? "bg-base-800 text-accent-300 font-bold"
                    : "text-ink-300 hover:bg-base-850 hover:text-accent-300",
                )}
              >
                <Crown className="h-4 w-4 text-accent-400" />
                <span>Olimpo</span>
              </button>
            </div>

            {/* GRUPO EXPERIÊNCIA */}
            <div className="flex flex-col gap-0.5">
              <span className="px-2 text-[10.5px] font-bold uppercase tracking-wider text-ink-400">
                Experiência
              </span>
              <button
                type="button"
                onClick={() => setActiveSection("voz")}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-xs font-semibold transition-colors",
                  activeSection === "voz"
                    ? "bg-base-800 text-ink-100"
                    : "text-ink-300 hover:bg-base-850 hover:text-ink-100",
                )}
              >
                <Mic className="h-4 w-4" />
                <span>Voz e vídeo</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveSection("aparencia")}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-xs font-semibold transition-colors",
                  activeSection === "aparencia"
                    ? "bg-base-800 text-ink-100"
                    : "text-ink-300 hover:bg-base-850 hover:text-ink-100",
                )}
              >
                <Palette className="h-4 w-4" />
                <span>Aparência</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Conteúdo Principal Direito das Configurações (Print 4) */}
        <main className="relative flex-1 overflow-y-auto p-8 bg-base-950">
          {/* Botão Fechar no Topo Direito com ESC indicator */}
          <div className="absolute top-6 right-6 flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-base-700 bg-base-900 text-ink-300 hover:border-base-600 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
            <span className="text-[10px] font-mono text-ink-500 font-bold uppercase">
              ESC
            </span>
          </div>

          {/* SEÇÃO CONTA (Print 4) */}
          {activeSection === "conta" && (
            <div className="flex flex-col gap-8 max-w-xl">
              <div>
                <h2 className="text-xl font-bold text-ink-100">Informações da conta</h2>
              </div>

              {/* Card de Informações */}
              <div className="flex flex-col gap-3 rounded-xl border border-base-800 bg-base-900 p-5">
                {/* Nome de Usuário */}
                <div className="flex items-center justify-between py-2 border-b border-base-850">
                  <div className="flex flex-col">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-ink-400">
                      Nome de usuário
                    </span>
                    <span className="text-sm font-semibold text-ink-100 mt-0.5">
                      {user.username}
                    </span>
                  </div>
                  <Button variant="secondary" size="sm" className="font-semibold text-xs">
                    Editar
                  </Button>
                </div>

                {/* E-mail */}
                <div className="flex items-center justify-between py-2 border-b border-base-850">
                  <div className="flex flex-col">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-ink-400">
                      E-mail
                    </span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-sm font-semibold text-ink-100">
                        {showEmail ? user.email : "************@gmail.com"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowEmail(!showEmail)}
                        className="text-xs text-accent-400 hover:underline"
                      >
                        {showEmail ? "Ocultar" : "Mostrar"}
                      </button>
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" className="font-semibold text-xs">
                    Editar
                  </Button>
                </div>

                {/* Telefone */}
                <div className="flex items-center justify-between py-2">
                  <div className="flex flex-col">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-ink-400">
                      Telefone
                    </span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-sm font-semibold text-ink-100">
                        {showPhone ? user.phone : "***********1118"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowPhone(!showPhone)}
                        className="text-xs text-accent-400 hover:underline"
                      >
                        {showPhone ? "Ocultar" : "Mostrar"}
                      </button>
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" className="font-semibold text-xs">
                    Editar
                  </Button>
                </div>
              </div>

              {/* Status da Conta (Print 4) */}
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-bold text-ink-100">Status da Conta</h3>
                <div className="flex items-center justify-between rounded-xl border border-base-800 bg-base-900 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-signal-online/15 text-signal-online">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-ink-100">Sua conta está toda em ordem</p>
                      <p className="text-[11px] text-ink-400">Obrigado por respeitar as diretrizes da comunidade do Aether.</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-ink-500" />
                </div>
              </div>
            </div>
          )}

          {/* SEÇÃO VOZ E VÍDEO (Com o Teste de Microfone Integrado) */}
          {activeSection === "voz" && (
            <div className="flex flex-col gap-6 max-w-xl">
              <div>
                <h2 className="text-xl font-bold text-ink-100">Voz e vídeo</h2>
                <p className="text-xs text-ink-400 mt-1">
                  Configure seus dispositivos de entrada e saída.
                </p>
              </div>

              {/* Componente de Teste de Microfone v2 */}
              <div className="rounded-xl border border-base-800 bg-base-900 p-5">
                <MicrophoneTest />
              </div>
            </div>
          )}

          {/* SEÇÃO OLIMPO */}
          {activeSection === "olimpo" && (
            <div className="flex flex-col gap-6 max-w-xl">
              <div>
                <h2 className="text-xl font-bold text-ink-100 flex items-center gap-2">
                  <Crown className="h-5 w-5 text-accent-400" />
                  Aether Olimpo
                </h2>
                <p className="text-xs text-ink-400 mt-1">
                  Gerencie sua assinatura e vantagens premium.
                </p>
              </div>

              <div className="rounded-xl border border-accent-500/40 bg-gradient-to-br from-[#282b52] to-base-900 p-6 flex flex-col gap-4">
                <h3 className="text-base font-bold text-white">Você é um membro Olimpo!</h3>
                <p className="text-xs text-ink-200">
                  Aproveite uploads de 500 MB, streaming em 4K, avatares animados e muito mais.
                </p>
                <Button variant="primary" size="sm" className="w-fit font-bold">
                  Gerenciar Assinatura
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
