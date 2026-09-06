import type { Metadata } from "next";
import { VERSAO_DOS_TERMOS } from "@aether/shared";
import { DocumentoLegal } from "@/components/marketing/documento-legal";

export const metadata: Metadata = { title: "Política de Privacidade" };

const INDICE = [
  { id: "coletamos", rotulo: "1 · O que coletamos" },
  { id: "por-que", rotulo: "2 · Por que usamos" },
  { id: "com-quem", rotulo: "3 · Com quem compartilhamos" },
  { id: "retencao", rotulo: "4 · Retenção" },
  { id: "direitos", rotulo: "5 · Seus direitos (LGPD)" },
  { id: "seguranca", rotulo: "6 · Segurança" },
  { id: "criancas", rotulo: "7 · Crianças" },
  { id: "mudancas", rotulo: "8 · Mudanças" },
];

export default function PrivacidadePage() {
  return (
    <DocumentoLegal
      titulo="Política de Privacidade"
      lede={`O que o AETHER coleta, por que, com quem compartilha e quais são seus direitos. Última atualização material: ${VERSAO_DOS_TERMOS}.`}
      indice={INDICE}
    >
      <h2 id="coletamos">1. O que coletamos</h2>
      <ul>
        <li>
          <strong>Conta:</strong> nome de usuário, nome de exibição, e-mail,
          senha (guardada apenas como hash), foto de perfil se você enviar.
        </li>
        <li>
          <strong>Conteúdo:</strong> mensagens, anexos e reações que você envia;
          quem está em quais servidores e canais.
        </li>
        <li>
          <strong>Uso e diagnóstico:</strong> horário de acesso, endereço IP
          (guardado como hash na sessão), agente do navegador, e registros de
          erro para depuração.
        </li>
        <li>
          <strong>Voz e tela:</strong> o áudio e o vídeo trafegam entre você e o
          servidor de mídia; <strong>não gravamos</strong> chamadas.
        </li>
        <li>
          <strong>Conexões opcionais:</strong> se você liga Spotify, Steam,
          Twitch ou Riot, guardamos o identificador da conta e — quando o serviço
          usa OAuth — tokens <strong>cifrados</strong>.
        </li>
      </ul>

      <h2 id="por-que">2. Por que usamos</h2>
      <p>
        Para operar o serviço (entregar mensagens, autenticar você, exibir
        presença), manter a segurança (rate limiting, detecção de abuso), atender
        denúncias, e corrigir defeitos. Não usamos seus dados para publicidade e
        não os vendemos.
      </p>

      <h2 id="com-quem">3. Com quem compartilhamos</h2>
      <p>
        Usamos provedores de infraestrutura que processam dados em nosso nome:
      </p>
      <ul>
        <li>
          <strong>Vercel</strong> — hospedagem do app web;
        </li>
        <li>
          <strong>Fly.io</strong> — o gateway de tempo real;
        </li>
        <li>
          <strong>Supabase</strong> — banco de dados e armazenamento de imagens;
        </li>
        <li>
          <strong>Cloudflare R2</strong> — armazenamento de anexos;
        </li>
        <li>
          <strong>LiveKit</strong> — transporte de voz e tela;
        </li>
        <li>
          <strong>Upstash</strong> — cache e estado de presença;
        </li>
        <li>
          <strong>Resend</strong> — envio de e-mail (confirmação, redefinição de
          senha);
        </li>
        <li>
          <strong>Cloudflare Turnstile</strong> — verificação anti-robô no
          cadastro;
        </li>
        <li>
          <strong>Sentry</strong> — registro de erros (sem conteúdo de mensagem,
          sem senha, sem e-mail em claro).
        </li>
      </ul>
      <p>
        Também podemos divulgar dados quando exigido por lei ou para proteger
        direitos, a segurança de pessoas, ou investigar abuso.
      </p>

      <h2 id="retencao">4. Retenção</h2>
      <p>
        Dados de conta e conteúdo ficam enquanto sua conta existir. Registros de
        erro e diagnóstico têm retenção curta. Anexos órfãos (autorizados e nunca
        enviados numa mensagem) são apagados após 24 horas.
      </p>

      <h2 id="direitos">5. Seus direitos (LGPD)</h2>
      <p>
        Você pode acessar, corrigir e apagar seus dados. A exclusão da conta
        remove seu perfil e desassocia seu conteúdo; mensagens em canais podem
        permanecer de forma anônima para não quebrar o histórico de conversa de
        terceiros. Para exercer esses direitos:{" "}
        <strong>privacidade@aether.app</strong> (a definir). Uma tela de
        exportar/apagar dados no app está no roteiro.
      </p>

      <h2 id="seguranca">6. Segurança</h2>
      <p>
        Senhas são guardadas com <strong>scrypt</strong>; tokens de terceiros são
        cifrados (AES-256-GCM); o tráfego é por HTTPS/WSS. Nenhum sistema é 100%
        seguro — avise-nos de qualquer vulnerabilidade em{" "}
        <strong>seguranca@aether.app</strong> (a definir).
      </p>

      <h2 id="criancas">7. Crianças</h2>
      <p>
        O AETHER não é destinado a menores de 13 anos. Se soubermos que uma conta
        pertence a alguém abaixo dessa idade, ela será removida.
      </p>

      <h2 id="mudancas">8. Mudanças</h2>
      <p>
        Avisaremos no app sobre mudanças materiais nesta política.
      </p>
    </DocumentoLegal>
  );
}
