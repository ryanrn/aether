import type { Metadata } from "next";
import { VERSAO_DOS_TERMOS } from "@aether/shared";

export const metadata: Metadata = { title: "Política de Conteúdo" };

export default function ConteudoPage() {
  return (
    <>
      <h1>Política de Conteúdo</h1>
      <p className="lede">
        O que não é permitido no AETHER, como denunciar e como aplicamos as
        regras. Última atualização material: {VERSAO_DOS_TERMOS}.
      </p>

      <h2>Conteúdo proibido</h2>
      <p>Não é permitido publicar, enviar ou compartilhar:</p>
      <ul>
        <li>
          <strong>Exploração sexual infantil</strong> em qualquer forma. Esse
          conteúdo é removido, a conta é encerrada e o caso é reportado às
          autoridades.
        </li>
        <li>
          <strong>Assédio, ameaças e incitação</strong> — atacar, intimidar ou
          organizar ataques a uma pessoa ou grupo; incitar violência ou
          autolesão.
        </li>
        <li>
          <strong>Discurso de ódio</strong> — desumanizar ou promover violência
          contra pessoas por raça, etnia, origem, religião, deficiência,
          gênero, identidade de gênero ou orientação sexual.
        </li>
        <li>
          <strong>Conteúdo sexual não consensual</strong> — incluindo imagens
          íntimas divulgadas sem consentimento.
        </li>
        <li>
          <strong>Spam e enganação</strong> — propaganda em massa, esquemas,
          phishing, malware, ou manipulação coordenada.
        </li>
        <li>
          <strong>Atividade ilegal</strong> — venda de drogas, armas, dados
          roubados; fraude; violação de direitos autorais.
        </li>
        <li>
          <strong>Falsa identidade</strong> — se passar por outra pessoa,
          marca ou membro da equipe do AETHER.
        </li>
      </ul>

      <h2>Conteúdo adulto</h2>
      <p>
        Durante o beta, conteúdo sexual explícito e gore não são permitidos em
        nenhum canal, mesmo entre adultos. Isso pode mudar com canais marcados
        para maiores de idade e verificação apropriada.
      </p>

      <h2>Como denunciar</h2>
      <p>
        Use o botão <strong>Denunciar</strong> no menu de uma mensagem ou no
        perfil de um usuário. Descreva o que aconteceu. Denúncias são revisadas
        pela equipe; abuso do sistema de denúncias (denúncias falsas em massa)
        também é violação.
      </p>

      <h2>Como aplicamos</h2>
      <p>
        Conforme a gravidade e a reincidência, as medidas vão de aviso a{" "}
        <strong>remoção de conteúdo</strong>,{" "}
        <strong>silenciamento global</strong> (a conta lê mas não envia
        mensagens, por tempo determinado ou indefinido) e{" "}
        <strong>encerramento da conta</strong>. Casos de conteúdo ilegal não
        passam por aviso.
      </p>
    </>
  );
}
