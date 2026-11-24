import {
  criarErroHttp,
  responderErro,
  tratarRespostaErro,
} from "../utils/tratarErro.js";

export { criarErroHttp, responderErro, tratarRespostaErro };

const errorHandler = (erro, req, res, next) => {
  if (res.headersSent) {
    return next(erro);
  }

  return tratarRespostaErro(res, erro);
};

export default errorHandler;
