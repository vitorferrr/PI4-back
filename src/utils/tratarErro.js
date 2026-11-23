import { tratarRespostaErro } from "../middlewares/errorHandler.js";

const tratarErro = (
  res,
  erro,
  mensagem,
  mensagemReferenciaInvalida
) =>
  tratarRespostaErro(res, erro, {
    mensagemPadrao: mensagem,
    mensagemReferenciaInvalida,
  });

export default tratarErro;
