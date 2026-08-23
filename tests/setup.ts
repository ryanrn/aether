/**
 * Segredo fixo para a suite.
 *
 * Assinatura e verificacao de token nao podem depender do .env da maquina de
 * quem roda: no CI ele nao existe, e na maquina do dev um segredo diferente
 * faria o teste passar ou falhar por motivo alheio ao codigo.
 */
process.env.AUTH_SECRET =
  "suite-unitaria-segredo-fixo-com-mais-de-32-caracteres";
