import type { Metadata } from "next";
import { VERSAO_DOS_TERMOS } from "@aether/shared";
import {
  DocumentoLegal,
  LinkLegal,
} from "@/components/marketing/documento-legal";

export const metadata: Metadata = { title: "Termos de Uso" };

const INDICE = [
  { id: "o-que-e", rotulo: "1 · O que é o AETHER" },
  { id: "sua-conta", rotulo: "2 · Sua conta" },
  { id: "uso-aceitavel", rotulo: "3 · Uso aceitável" },
  { id: "moderacao", rotulo: "4 · Moderação" },
  { id: "seu-conteudo", rotulo: "5 · Seu conteúdo" },
  { id: "encerramento", rotulo: "6 · Encerramento" },
  { id: "responsabilidade", rotulo: "7 · Responsabilidade" },
  { id: "mudancas", rotulo: "8 · Mudanças" },
  { id: "contato", rotulo: "9 · Contato" },
];

export default function TermosPage() {
  return (
    <DocumentoLegal
      titulo="Termos de Uso"
      lede={`Ao criar uma conta ou usar o AETHER, você concorda com estes termos. Última atualização material: ${VERSAO_DOS_TERMOS}.`}
      indice={INDICE}
    >
      <h2 id="o-que-e">1. O que é o AETHER</h2>
      <p>
        O AETHER é uma plataforma de comunicação em tempo real (voz, tela e
        texto), em fase <strong>beta</strong>. O serviço é oferecido{" "}
        <strong>“no estado em que se encontra”</strong>, sem garantia de
        disponibilidade, e pode mudar, ficar indisponível ou ser descontinuado a
        qualquer momento durante o beta.
      </p>

      <h2 id="sua-conta">2. Sua conta</h2>
      <ul>
        <li>
          Você precisa ter <strong>13 anos ou mais</strong>. Entre 13 e 18, o uso
          deve ter consentimento de quem é responsável por você.
        </li>
        <li>
          Você é responsável pela atividade da sua conta e por manter a senha
          segura. Avise-nos se suspeitar de acesso indevido.
        </li>
        <li>
          Uma pessoa, uma conta. Contas criadas em massa ou por automação para
          burlar limites ou moderação serão removidas.
        </li>
      </ul>

      <h2 id="uso-aceitavel">3. Uso aceitável</h2>
      <p>Você concorda em não usar o AETHER para:</p>
      <ul>
        <li>
          publicar conteúdo ilegal, ou que a{" "}
          <LinkLegal href="/conteudo">Política de Conteúdo</LinkLegal> proíbe;
        </li>
        <li>assediar, ameaçar, perseguir ou incitar violência contra alguém;</li>
        <li>
          enviar spam, correntes, ou usar o serviço para distribuir malware ou
          phishing;
        </li>
        <li>
          fingir ser outra pessoa ou organização, ou deturpar sua ligação com
          alguém;
        </li>
        <li>
          sobrecarregar, sondar ou tentar burlar a infraestrutura, os limites de
          uso ou os mecanismos de segurança.
        </li>
      </ul>

      <h2 id="moderacao">4. Moderação</h2>
      <p>
        Podemos remover conteúdo, suspender ou encerrar contas que violem estes
        termos ou a Política de Conteúdo, com ou sem aviso prévio conforme a
        gravidade. Denúncias podem ser feitas dentro do app. Conteúdo que
        aparente exploração sexual infantil é removido e reportado às autoridades
        competentes.
      </p>

      <h2 id="seu-conteudo">5. Seu conteúdo</h2>
      <p>
        O conteúdo que você envia continua seu. Você nos concede uma licença
        limitada para armazenar, processar e transmitir esse conteúdo apenas para
        operar o serviço (por exemplo, entregar sua mensagem a quem está no
        canal). Não vendemos seu conteúdo nem o usamos para treinar modelos.
      </p>

      <h2 id="encerramento">6. Encerramento</h2>
      <p>
        Você pode apagar sua conta a qualquer momento nas configurações. Podemos
        encerrar contas por violação destes termos. Ao encerrar, seus dados são
        tratados conforme a{" "}
        <LinkLegal href="/privacidade">Política de Privacidade</LinkLegal>.
      </p>

      <h2 id="responsabilidade">7. Limitação de responsabilidade</h2>
      <p>
        Na medida permitida por lei, o AETHER não se responsabiliza por danos
        indiretos, perda de dados ou lucros cessantes decorrentes do uso — ou da
        impossibilidade de uso — de um serviço em beta.
      </p>

      <h2 id="mudancas">8. Mudanças</h2>
      <p>
        Podemos atualizar estes termos. Mudanças materiais serão comunicadas no
        app, e o uso continuado após o aviso significa aceite da nova versão.
      </p>

      <h2 id="contato">9. Contato</h2>
      <p>
        Dúvidas sobre estes termos: <strong>suporte@aether.app</strong> (a
        definir).
      </p>
    </DocumentoLegal>
  );
}
