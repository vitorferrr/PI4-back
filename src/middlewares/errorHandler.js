import { ZodError } from "zod";
import AppError from "../utils/appError.js";
import {
  criarErroHttp,
  responderErro,
  tratarRespostaErro,
} from "../utils/tratarErro.js";

export { criarErroHttp, responderErro, tratarRespostaErro };

const mensagemDoZod = (erro) =>
  [...new Set((erro.issues || erro.errors || []).map((e) => e.message))].join("; ");

const registrarErroDoServidor = (erro) => {
  if (process.env.NODE_ENV === "test") return;

  if (process.env.NODE_ENV !== "production") {
    console.error(erro.stack);
  } else {
    console.error(`${erro.name || "Error"}: ${erro.message}`);
  }
};

const errorHandler = (erro, req, res, next) => {
  if (res.headersSent) {
    return next(erro);
  }

  if (erro instanceof ZodError || erro.name === "ZodError") {
    return responderErro(res, 400, mensagemDoZod(erro));
  }

  if (erro instanceof AppError) {
    if (erro.statusCode >= 500 || !erro.isOperational) {
      registrarErroDoServidor(erro);
    }
    return responderErro(res, erro.statusCode, erro.message);
  }

  if (erro.name === "SequelizeValidationError") {
    const erros = (erro.errors || []).map((e) => e.message);
    return responderErro(res, 400, erros.length > 0 ? erros.join(", ") : erro.message);
  }

  if (erro.name === "SequelizeDatabaseError" && erro.original?.code === "22P02") {
    return responderErro(
      res,
      400,
      "Identificador (ID) fornecido possui formato inválido."
    );
  }

  if (erro.name === "SequelizeDatabaseError" && erro.original?.code === "22001") {
    return responderErro(
      res,
      400,
      "Um ou mais campos excedem o tamanho máximo permitido."
    );
  }

  if (
    erro.type === "entity.too.large" ||
    erro.status === 413 ||
    erro.statusCode === 413
  ) {
    return responderErro(
      res,
      413,
      "O corpo da requisição deve ter no máximo 1 MB"
    );
  }

  return tratarRespostaErro(res, erro);
};

export default errorHandler;
