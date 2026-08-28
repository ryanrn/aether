"use client";

import { useState } from "react";
import { X, Sparkles, Gift, Check, ShieldCheck, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComparisonTable } from "./comparison-table";
import { cn } from "@/lib/utils";

export interface PlutoniumModalProps {
  open: boolean;
  onClose: () => void;
  onSelectPlan?: (plan: "monthly" | "yearly", currency: "BRL" | "USD", recipient: "self" | "gift") => void;
}

/**
 * Modal completo de Assinatura Premium (Plutonium / Aether Pro).
 * Baseado com fidelidade milimétrica nos prints 1 e 2.
 */
export function PlutoniumModal({ open, onClose, onSelectPlan }: PlutoniumModalProps) {
  const [recipient, setRecipient] = useState<"self" | "gift">("self");
  const [currency, setCurrency] = useState<"BRL" | "USD">("BRL");
  const [selectedBilling, setSelectedBilling] = useState<"monthly" | "yearly">("yearly");

  if (!open) return null;

  const prices = {
    BRL: {
      monthly: "R$ 24,99",
      monthlyPeriod: "por mês",
      yearly: "R$ 249,99",
      yearlyPeriod: "por ano",
      yearlyDiscount: "ECONOMIZE 17%",
    },
    USD: {
      monthly: "$ 4.99",
      monthlyPeriod: "per month",
      yearly: "$ 49.99",
      yearlyPeriod: "per year",
      yearlyDiscount: "SAVE 17%",
    },
  };

  const currentPrice = prices[currency];

  const handleCheckout = (billing: "monthly" | "yearly") => {
    setSelectedBilling(billing);
    if (onSelectPlan) {
      onSelectPlan(billing, currency, recipient);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in-fast">
      <div
        className={cn(
          "relative flex flex-col w-full max-w-[620px] max-h-[90vh] overflow-hidden rounded-xl",
          "border border-base-700 bg-base-900 shadow-pop text-ink-100",
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="premium-title"
      >
        {/* Botão Fechar no Topo Direito */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-1.5 rounded-full text-ink-400 hover:text-ink-100 hover:bg-base-800 transition-colors"
          aria-label="Fechar"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Conteúdo Rolável */}
        <div className="overflow-y-auto px-6 py-7 flex flex-col gap-6">
          {/* Cabeçalho */}
          <div className="flex flex-col items-center text-center gap-2 pt-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-accent-400" />
              <h2 id="premium-title" className="text-xl font-bold tracking-tight text-ink-100">
                Aether Plutonium
              </h2>
            </div>
            <p className="text-[13px] text-ink-300 max-w-[440px] leading-relaxed">
              Desbloqueie limites maiores e recursos exclusivos enquanto apoia uma plataforma de comunicação independente.
            </p>
          </div>

          {/* Seletores: Para mim / Como presente & Moeda */}
          <div className="flex flex-col items-center gap-3">
            {/* Destinatário */}
            <div className="inline-flex rounded-md p-1 bg-base-950 border border-base-800">
              <button
                type="button"
                onClick={() => setRecipient("self")}
                className={cn(
                  "px-4 py-1.5 text-xs font-medium rounded transition-all",
                  recipient === "self"
                    ? "bg-base-800 text-ink-100 shadow-sm"
                    : "text-ink-400 hover:text-ink-200",
                )}
              >
                Para mim
              </button>
              <button
                type="button"
                onClick={() => setRecipient("gift")}
                className={cn(
                  "px-4 py-1.5 text-xs font-medium rounded transition-all flex items-center gap-1.5",
                  recipient === "gift"
                    ? "bg-base-800 text-ink-100 shadow-sm"
                    : "text-ink-400 hover:text-ink-200",
                )}
              >
                <Gift className="w-3.5 h-3.5" />
                Como presente
              </button>
            </div>

            {/* Alternador de Moeda */}
            <div className="inline-flex rounded-md p-1 bg-base-950 border border-base-800">
              <button
                type="button"
                onClick={() => setCurrency("BRL")}
                className={cn(
                  "px-3 py-1 text-[11px] font-medium rounded transition-all",
                  currency === "BRL"
                    ? "bg-base-800 text-ink-100"
                    : "text-ink-400 hover:text-ink-200",
                )}
              >
                Moeda local BRL
              </button>
              <button
                type="button"
                onClick={() => setCurrency("USD")}
                className={cn(
                  "px-3 py-1 text-[11px] font-medium rounded transition-all",
                  currency === "USD"
                    ? "bg-base-800 text-ink-100"
                    : "text-ink-400 hover:text-ink-200",
                )}
              >
                Padrão USD
              </button>
            </div>
          </div>

          {/* Card de Informações de Pagamento (BRL) */}
          {currency === "BRL" && (
            <div className="rounded-lg border border-base-750 bg-base-950/60 p-4 text-[12px] text-ink-300 flex flex-col gap-2">
              <div className="flex items-center gap-2 font-semibold text-ink-100">
                <ShieldCheck className="w-4 h-4 text-accent-400" />
                <span>Finalizar compra da assinatura em BRL</span>
              </div>
              <p className="leading-relaxed">
                Os cartões podem manter o preço em BRL após uma rápida verificação do Stripe, mas o cartão deve ter sido emitido no Brasil.
              </p>
              <p className="leading-relaxed">
                O Pix pode pular a etapa de verificação do cartão quando o Stripe oferecer Pix recorrente para sua compra.
              </p>
              <p className="leading-relaxed">
                Se Pix não estiver disponível ou você preferir o preço padrão, você pode mudar para USD a qualquer momento.
              </p>
            </div>
          )}

          {/* Cards de Preço / Planos (Mensal vs Anual) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Plano Mensal */}
            <div
              className={cn(
                "relative flex flex-col justify-between p-5 rounded-xl border transition-all duration-150",
                "bg-base-850 border-base-700 hover:border-base-600",
              )}
            >
              <div className="flex flex-col items-center text-center gap-1.5 mb-5">
                <span className="text-sm font-semibold text-ink-200">Mensal</span>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-2xl font-black tracking-tight text-ink-100">
                    {currentPrice.monthly}
                  </span>
                </div>
                <span className="text-xs text-ink-400">{currentPrice.monthlyPeriod}</span>
              </div>

              <Button
                variant="primary"
                size="md"
                onClick={() => handleCheckout("monthly")}
                className="w-full font-semibold"
              >
                Selecionar
              </Button>
            </div>

            {/* Plano Anual (Destaque / Mais Popular) */}
            <div
              className={cn(
                "relative flex flex-col justify-between p-5 rounded-xl border transition-all duration-150",
                "bg-gradient-to-b from-[#5865f2] to-[#4752c4] border-[#7983f5]/50 shadow-[0_0_24px_-8px_rgba(88,101,242,0.6)]",
              )}
            >
              {/* Badge Superior */}
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-base-950 shadow-md">
                Mais Popular
              </div>

              <div className="flex flex-col items-center text-center gap-1.5 mb-5 pt-1">
                <span className="text-sm font-semibold text-white/90">Anual</span>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-2xl font-black tracking-tight text-white">
                    {currentPrice.yearly}
                  </span>
                </div>
                <span className="text-xs text-white/75">{currentPrice.yearlyPeriod}</span>

                {/* Tag de Economia */}
                <div className="mt-1 inline-flex items-center rounded-md bg-black/25 px-2.5 py-1 text-[11px] font-bold tracking-wide text-white">
                  {currentPrice.yearlyDiscount}
                </div>
              </div>

              <Button
                variant="secondary"
                size="md"
                onClick={() => handleCheckout("yearly")}
                className="w-full bg-white text-base-950 hover:bg-white/90 font-bold border-transparent shadow-md"
              >
                Atualizar agora
              </Button>
            </div>
          </div>

          {/* Termos e Rodapé Legal */}
          <div className="text-[10.5px] leading-relaxed text-ink-500 text-center border-t border-base-800 pt-4 flex flex-col gap-1.5">
            <p>
              Ao comprar, você concorda com nossos{" "}
              <a href="#" className="text-accent-400 hover:underline">
                Termos de serviço
              </a>{" "}
              e{" "}
              <a href="#" className="text-accent-400 hover:underline">
                Política de privacidade
              </a>
              . Reembolsos self-service disponíveis em até 5 dias após o pagamento, uma vez a cada 90 dias.
            </p>
            <p className="text-[11px] font-medium text-ink-400 flex items-center justify-center gap-1 mt-1">
              Role para baixo para ver todos os benefícios incluídos no Plutonium
              <ChevronDown className="w-3.5 h-3.5 animate-bounce" />
            </p>
          </div>

          {/* Tabela de Comparação de Benefícios (Print 2) */}
          <div className="flex flex-col gap-3 pt-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-ink-300 text-center">
              Benefícios e Comparativo
            </h3>
            <ComparisonTable />
          </div>

          {/* Footer de Chamada para Ação Final */}
          <div className="flex flex-col items-center gap-3 pt-4 border-t border-base-800 text-center">
            <h4 className="text-sm font-bold text-ink-100">Pronto para fazer um upgrade?</h4>
            <div className="flex gap-2.5 w-full max-w-[360px]">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleCheckout("monthly")}
                className="flex-1 text-xs"
              >
                Mensal {currentPrice.monthly}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleCheckout("yearly")}
                className="flex-1 text-xs"
              >
                Anual {currentPrice.yearly}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
