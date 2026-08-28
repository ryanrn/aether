"use client";

import { useState } from "react";
import {
  Sparkles,
  Gift,
  Check,
  Zap,
  Radio,
  Upload,
  Smile,
  Shield,
  Palette,
  Volume2,
  Tv,
  Crown,
  Heart,
  ChevronRight,
} from "lucide-react";
import { PLANS, type PlanTier } from "@aether/shared";
import { Button } from "@/components/ui/button";
import { SeloPlano } from "@/components/ui/selo-plano";
import { ComparisonTable } from "./comparison-table";
import { ResgatarChave } from "./resgatar-chave";
import { cn } from "@/lib/utils";

type TabId = "inicio" | "novidades" | "planos" | "comparar";

/**
 * A tela do Olimpo.
 *
 * TODO NUMERO VEM DE `packages/shared/plans.ts`. O desenho original trazia os
 * proprios — prometia 500 MB onde o plano da 250, e "ate 4K" onde o plano da
 * 1080p. Numa tela de venda isso nao e texto solto: e a diferenca entre o que
 * a pessoa compra e o que recebe, descoberta depois de pagar.
 *
 * NAO HA COMO COMPRAR AINDA, e a tela diz isso. Os cartoes de preco continuam
 * porque servem para decidir o valor, mas o botao nao finge levar a um
 * checkout que nao existe. O caminho que FUNCIONA — resgatar uma chave — esta
 * na mesma tela, e nao escondido nas configuracoes.
 */
export function PremiumShowcaseScreen({
  tierAtual = "FREE",
  expiraEm = null,
}: {
  tierAtual?: PlanTier;
  expiraEm?: string | null;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("inicio");
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "yearly">("monthly");
  const assinante = tierAtual !== "FREE";
  const rotulo = PLANS.PLUS.rotulo;

  const scrollToSection = (tab: TabId) => {
    setActiveTab(tab);
    const element = document.getElementById(tab);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div className="relative flex-1 flex flex-col h-full min-h-0 overflow-y-auto bg-base-950 text-ink-100 selection:bg-accent-500/30">
      {/* Top Header / Sub-navigation (Print 3) */}
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-base-800 bg-base-900/90 px-6 backdrop-blur-md">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 font-bold tracking-wide text-ink-100">
            <Crown className="h-5 w-5 text-accent-400" />
            <span className="font-brand text-lg uppercase">{rotulo}</span>
          </div>

          <nav className="hidden md:flex items-center gap-1">
            {[
              { id: "inicio", label: "Início" },
              { id: "novidades", label: "Novidades" },
              { id: "planos", label: "Planos" },
              { id: "comparar", label: "Comparar" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => scrollToSection(item.id as TabId)}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold rounded-md transition-colors",
                  activeTab === item.id
                    ? "bg-base-800 text-ink-100"
                    : "text-ink-300 hover:bg-base-850 hover:text-ink-100",
                )}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        {/*
          O canto onde ficavam "Presentear" e "Fazer Upgrade" agora mostra o
          ESTADO, que e a informacao que existe. Botao de comprar volta quando
          houver o que comprar.
        */}
        <div className="flex items-center gap-2">
          {assinante ? (
            <SeloPlano tier={tierAtual} />
          ) : (
            <span className="rounded-full border border-base-700 px-2.5 py-1 text-[11px] text-ink-400">
              Assinatura em breve
            </span>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col gap-12 pb-20">
        {/* HERO SECTION (Print 3) */}
        <section
          id="inicio"
          className="relative mx-4 mt-4 overflow-hidden rounded-2xl border border-base-750 bg-gradient-to-br from-[#2b1b4d] via-[#1a1738] to-[#111214] p-8 md:p-14 shadow-panel"
        >
          {/* Background Glows & Particles */}
          <div className="pointer-events-none absolute -right-20 -top-20 h-96 w-96 rounded-full bg-accent-500/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 left-1/3 h-80 w-80 rounded-full bg-purple-600/20 blur-3xl" />

          <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-10">
            <div className="flex flex-col items-center md:items-start text-center md:text-left gap-5 max-w-xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs font-bold text-purple-300">
                <Sparkles className="h-3.5 w-3.5 text-accent-300" />
                NOVA EXPERIÊNCIA PREMIUM
              </div>

              <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tight text-white leading-tight">
                {/*
                  Para quem JA assina, o titulo usa o rotulo do plano DELA, e
                  nao o do plano de entrada: dizer "Voce e Olimpo" a quem
                  comprou o Olimpo Pro apaga justamente o que ela pagou a mais.
                */}
                {assinante
                  ? `Você é ${PLANS[tierAtual].rotulo}`
                  : `Desbloqueie um mundo de vantagens com o ${rotulo}`}
              </h1>

              {/*
                A frase LE os limites em vez de afirmar numeros. Escrita a mao,
                ela envelhece no dia em que a tabela mudar — e a tela de venda e
                o pior lugar do app para um numero velho.
              */}
              <p className="text-sm md:text-base text-ink-200 leading-relaxed max-w-lg">
                Transmita em {PLANS.PLUS.alturaMax}p a {PLANS.PLUS.quadrosMax}fps,
                envie arquivos de até {Math.round(PLANS.PLUS.uploadMaxBytes / 1048576)} MB
                e apoie o desenvolvimento contínuo da comunidade.
              </p>

              <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 pt-2">
                {/*
                  NAO HA BOTAO DE COMPRAR porque nao ha como comprar.
                  Um "Inscrever-se agora" que abre uma janela sem checkout e
                  pior do que nao ter botao: a pessoa tenta, nao acontece nada,
                  e passa a duvidar do resto do app. Quando houver provedor de
                  pagamento, o botao volta aqui.
                */}
                {assinante ? (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-2.5">
                    <SeloPlano tier={tierAtual} />
                    <span className="text-[13px] text-ink-200">
                      {expiraEm
                        ? `Ativo até ${new Date(expiraEm).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}`
                        : "Ativo, sem data para acabar"}
                    </span>
                  </div>
                ) : (
                  <div className="w-full max-w-sm">
                    <p className="mb-2 text-left text-[12px] text-ink-300">
                      Tem uma chave? Resgate aqui.
                    </p>
                    <ResgatarChave />
                  </div>
                )}
              </div>

              <span className="text-[11px] text-ink-400">
                A assinatura ainda não está aberta — por enquanto o acesso vem
                por chave. Os preços abaixo são um estudo.
              </span>
            </div>

            {/* Visual Feature Badges Floating Showcase */}
            <div className="relative flex flex-col gap-3 w-full max-w-xs">
              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-base-900/80 p-3.5 backdrop-blur-md shadow-pop transform hover:-translate-y-1 transition-transform">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-500/20 text-accent-300">
                  <Upload className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-ink-100">Uploads de {Math.round(PLANS.PLUS.uploadMaxBytes / 1048576)} MB</h4>
                  <p className="text-[11px] text-ink-400 truncate">Compartilhe vídeos e arquivos pesados</p>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-base-900/80 p-3.5 backdrop-blur-md shadow-pop transform hover:-translate-y-1 transition-transform ml-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-500/20 text-purple-300">
                  <Tv className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-ink-100">Tela em {PLANS.PRO.alturaMax}p / {PLANS.PRO.quadrosMax} FPS</h4>
                  <p className="text-[11px] text-ink-400 truncate">Compartilhamento de tela ultra-nítido</p>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-base-900/80 p-3.5 backdrop-blur-md shadow-pop transform hover:-translate-y-1 transition-transform">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-500/20 text-green-300">
                  <Smile className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-ink-100">Emojis e Efeitos Globais</h4>
                  <p className="text-[11px] text-ink-400 truncate">Em construção</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION: NOVIDADES & DESTAQUES (Print 3) */}
        <section id="novidades" className="mx-4 flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-black uppercase tracking-wide text-ink-100">
              Novidades em Destaque
            </h2>
            <p className="text-xs text-ink-400">
              Recursos recém-chegados exclusivos para membros {rotulo}.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex flex-col justify-between rounded-xl border border-base-750 bg-base-900 p-5 hover:border-base-600 transition-colors">
              <div className="flex flex-col gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-500/15 text-accent-400">
                  <Palette className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-accent-400">Personalização</span>
                  <h3 className="text-sm font-bold text-ink-100 mt-0.5">Temas e Banners Especiais</h3>
                </div>
                <p className="text-xs text-ink-400 leading-relaxed">
                  Destaque seu perfil com banners animados, tags customizadas e temas visuais exclusivos.
                </p>
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-base-750 bg-base-900 p-5 hover:border-base-600 transition-colors">
              <div className="flex flex-col gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-500/15 text-purple-400">
                  <Zap className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-purple-400">Performance</span>
                  <h3 className="text-sm font-bold text-ink-100 mt-0.5">Áudio e Voz Hi-Fi</h3>
                </div>
                <p className="text-xs text-ink-400 leading-relaxed">
                  Taxa de bits de áudio estéreo em até 384 kbps para conversas e transmissões com qualidade de estúdio.
                </p>
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-base-750 bg-base-900 p-5 hover:border-base-600 transition-colors">
              <div className="flex flex-col gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-500/15 text-green-400">
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-green-400">Comunidades</span>
                  <h3 className="text-sm font-bold text-ink-100 mt-0.5">2 Impulsos de Servidor</h3>
                </div>
                <p className="text-xs text-ink-400 leading-relaxed">
                  Dê impulsos para o seu servidor favorito desbloquear mais slots de emojis, qualidade de streaming e customizações.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION: ESCOLHA SEU PLANO (Print 4) */}
        <section id="planos" className="mx-4 flex flex-col items-center gap-8 pt-6">
          <div className="flex flex-col items-center text-center gap-2">
            <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tight text-white">
              Escolha seu plano
            </h2>
            <p className="text-xs md:text-sm text-ink-300 max-w-md">
              Escolha a opção ideal para seu estilo de uso. Mude ou cancele quando quiser.
            </p>

            {/* Alternador Mensal / Anual */}
            <div className="mt-2 inline-flex items-center rounded-full bg-base-900 p-1 border border-base-750">
              <button
                type="button"
                onClick={() => setBillingPeriod("monthly")}
                className={cn(
                  "px-4 py-1.5 text-xs font-semibold rounded-full transition-all",
                  billingPeriod === "monthly"
                    ? "bg-accent-500 text-white shadow-sm"
                    : "text-ink-400 hover:text-ink-200",
                )}
              >
                Cobrança Mensal
              </button>
              <button
                type="button"
                onClick={() => setBillingPeriod("yearly")}
                className={cn(
                  "px-4 py-1.5 text-xs font-semibold rounded-full transition-all flex items-center gap-1.5",
                  billingPeriod === "yearly"
                    ? "bg-accent-500 text-white shadow-sm"
                    : "text-ink-400 hover:text-ink-200",
                )}
              >
                Cobrança Anual
                <span className="rounded-full bg-green-500/20 px-1.5 py-0.5 text-[9px] font-bold text-green-300">
                  -17%
                </span>
              </button>
            </div>
          </div>

          {/* Pricing Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl">
            {/* PLANO BÁSICO (Print 4) */}
            <div className="flex flex-col justify-between rounded-2xl border border-base-700 bg-base-900 p-6 md:p-8 hover:border-base-600 transition-all">
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-1">
                  <h3 className="text-lg font-black uppercase tracking-wide text-ink-100">
                    {PLANS.PLUS.rotulo}
                  </h3>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-3xl font-black text-white">
                      {billingPeriod === "monthly" ? "R$ 8,90" : "R$ 89,90"}
                    </span>
                    <span className="text-xs text-ink-400">
                      {billingPeriod === "monthly" ? "/mês" : "/ano"}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-3 border-t border-base-800 pt-5">
                  <div className="flex items-center gap-2.5 text-xs text-ink-200">
                    <Check className="h-4 w-4 text-signal-online shrink-0" />
                    <span>Uploads de até {Math.round(PLANS.PLUS.uploadMaxBytes / 1048576)} MB</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-xs text-ink-200">
                    <Check className="h-4 w-4 text-signal-online shrink-0" />
                    <span className="text-ink-400">Emojis em qualquer lugar (em construção)</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-xs text-ink-200">
                    <Check className="h-4 w-4 text-signal-online shrink-0" />
                    <span>Super-reações ilimitadas</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-xs text-ink-200">
                    <Check className="h-4 w-4 text-signal-online shrink-0" />
                    <span className="text-ink-400">Selo {rotulo} no perfil (em construção)</span>
                  </div>
                </div>
              </div>

              <div className="mt-8">
                <Button variant="secondary" size="md" disabled className="w-full font-bold">
                  Em breve
                </Button>
              </div>
            </div>

            {/* PLANO OLIMPO COMPLETO (Print 4) */}
            <div className="relative flex flex-col justify-between rounded-2xl border border-accent-500/50 bg-gradient-to-b from-[#282b52] via-base-900 to-base-900 p-6 md:p-8 shadow-[0_0_32px_-8px_rgba(88,101,242,0.4)]">
              <div className="absolute -top-3 right-6 rounded-full bg-accent-500 px-3 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-md">
                Em Alta
              </div>

              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Crown className="h-5 w-5 text-accent-400" />
                    <h3 className="text-lg font-black uppercase tracking-wide text-white">
                      {PLANS.PRO.rotulo}
                    </h3>
                  </div>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-3xl font-black text-white">
                      {billingPeriod === "monthly" ? "R$ 24,99" : "R$ 249,99"}
                    </span>
                    <span className="text-xs text-ink-300">
                      {billingPeriod === "monthly" ? "/mês" : "/ano"}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-3 border-t border-white/10 pt-5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-accent-300">
                    Tudo do Básico, além de:
                  </p>
                  <div className="flex items-center gap-2.5 text-xs text-ink-100 font-medium">
                    <Check className="h-4 w-4 text-signal-online shrink-0" />
                    <span>Uploads de até {Math.round(PLANS.PRO.uploadMaxBytes / 1048576 / 1024)} GB</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-xs text-ink-100 font-medium">
                    <Check className="h-4 w-4 text-signal-online shrink-0" />
                    <span>Tela em {PLANS.PRO.alturaMax}p a {PLANS.PRO.quadrosMax}fps</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-xs text-ink-100 font-medium">
                    <Check className="h-4 w-4 text-signal-online shrink-0" />
                    <span>2 Impulsos de Servidor inclusos</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-xs text-ink-100 font-medium">
                    <Check className="h-4 w-4 text-signal-online shrink-0" />
                    <span>Perfis, avatares animados e banners por servidor</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-xs text-ink-100 font-medium">
                    <Check className="h-4 w-4 text-signal-online shrink-0" />
                    <span>Limite estendido de 4.000 caracteres por mensagem</span>
                  </div>
                </div>
              </div>

              <div className="mt-8">
                <Button
                  variant="primary"
                  size="md"
                  disabled
                  className="w-full font-bold"
                >
                  Em breve
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION: COMPARE NOSSOS PLANOS (Print 4) */}
        <section id="comparar" className="mx-4 flex flex-col items-center gap-6 pt-10">
          <div className="flex flex-col items-center text-center gap-2">
            <h2 className="text-xl md:text-2xl font-black uppercase tracking-tight text-white">
              Compare nossos planos
            </h2>
            <p className="text-xs text-ink-400 max-w-lg">
              Veja lado a lado todos os limites e vantagens exclusivas.
            </p>
          </div>

          <div className="w-full max-w-4xl">
            <ComparisonTable tierAtual={tierAtual} />
          </div>
        </section>
      </div>

      {/* Modal de Assinatura Interativo */}
    </div>
  );
}
