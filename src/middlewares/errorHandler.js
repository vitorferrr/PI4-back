const MENSAGEM_REFERENCIA_INVALIDA =
  "Registro relacionado informado não existe no sistema.";

const MENSAGEM_SEM_PERMISSAO =
  "Usuário não possui permissão para acessar este recurso";

export const criarErroHttp = (status, mensagem, erros) => {
  const erro = new Error(mensagem);
  erro.status = status;
  if (erros) {
    erro.erros = erros;
  }
  return erro;
};

export const responderErro = (res, status, mensagem, erros) => {
  const corpo = { mensagem };
  if (Array.isArray(erros) && erros.length > 0) {
    corpo.erros = erros;
  }
  return res.status(status).json(corpo);
};

const extrairErros = (erro) => {
  if (Array.isArray(erro.erros)) {
    return erro.erros;
  }
  if (Array.isArray(erro.errors)) {
    return erro.errors.map((e) => e.message ?? String(e));
  }
  return undefined;
};

const errorHandler = (erro, req, res, next) => {
  if (res.headersSent) {
    return next(erro);
  }

  if (erro instanceof SyntaxError && erro.status === 400 && "body" in erro) {
    return responderErro(res, 400, "JSON inválido no corpo da requisição");
  }

  if (
    erro.name === "AutenticacaoError" ||
    erro.name === "JsonWebTokenError" ||
    erro.name === "TokenExpiredError" ||
    erro.status === 401
  ) {
    return responderErro(
      res,
      401,
      erro.message || "Token inválido ou expirado"
    );
  }

  if (
    erro.name === "AutorizacaoError" ||
    erro.name === "PermissaoError" ||
    erro.status === 403
  ) {
    return responderErro(res, 403, erro.message || MENSAGEM_SEM_PERMISSAO);
  }

  if (
    erro.name === "SequelizeValidationError" ||
    erro.name === "SequelizeUniqueConstraintError" ||
    erro.name === "ValidacaoError"
  ) {
    return responderErro(
      res,
      400,
      erro.message || "Dados inválidos",
      extrairErros(erro)
    );
  }

  if (erro.name === "SequelizeForeignKeyConstraintError") {
    return responderErro(res, 400, MENSAGEM_REFERENCIA_INVALIDA);
  }

  const status = erro.status || erro.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return responderErro(res, status, erro.message, extrairErros(erro));
  }

  console.error(erro);

  return responderErro(res, 500, "Erro interno do servidor");
};

export default errorHandler;
