const MENSAGEM_REFERENCIA_INVALIDA =
  "Registro relacionado informado não existe no sistema.";

const MENSAGEM_SEM_PERMISSAO =
  "Usuário não possui permissão para acessar este recurso";

const MENSAGEM_STORAGE_INDISPONIVEL =
  "Serviço de armazenamento indisponível. Tente novamente mais tarde.";

const ehStorageIndisponivel = (erro) =>
  erro.name === "StorageConfiguracaoError" ||
  (erro.name === "StorageError" && erro.codigo !== "STORAGE_PARAMETRO_INVALIDO");

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
  return erro.message ? [erro.message] : undefined;
};

export const tratarRespostaErro = (
  res,
  erro,
  {
    mensagemPadrao = "Erro interno do servidor",
    mensagemReferenciaInvalida = MENSAGEM_REFERENCIA_INVALIDA,
  } = {}
) => {
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

  if (erro.name === "SequelizeUniqueConstraintError") {
    return responderErro(res, 409, "Email já cadastrado");
  }

  if (
    erro.name === "SequelizeValidationError" ||
    erro.name === "ValidacaoError"
  ) {
    return responderErro(
      res,
      400,
      mensagemPadrao !== "Erro interno do servidor"
        ? mensagemPadrao
        : erro.message || "Dados inválidos",
      extrairErros(erro)
    );
  }

  if (erro.name === "SequelizeForeignKeyConstraintError") {
    return responderErro(res, 400, mensagemReferenciaInvalida);
  }

  const status = erro.status || erro.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return responderErro(res, status, erro.message, erro.erros);
  }

  console.error(erro);

  if (ehStorageIndisponivel(erro)) {
    return responderErro(res, 503, MENSAGEM_STORAGE_INDISPONIVEL);
  }

  return responderErro(res, 500, mensagemPadrao);
};

const errorHandler = (erro, req, res, next) => {
  if (res.headersSent) {
    return next(erro);
  }

  return tratarRespostaErro(res, erro);
};

export default errorHandler;
