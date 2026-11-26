import { ZodError } from "zod";
import AppError from "../utils/appError.js";
import {
  criarErroHttp,
  responderErro,
  tratarRespostaErro,
} from "../utils/tratarErro.js";

export { criarErroHttp, responderErro, tratarRespostaErro };

const SECOES_REQUISICAO = ["body", "params", "query"];

const formatarErrosZod = (erro) =>
  (erro.issues || erro.errors || []).map((e) => {
    const caminho = (e.path || []).filter(
      (parte, indice) => !(indice === 0 && SECOES_REQUISICAO.includes(parte))
    );
    const prefixo = caminho.length > 0 ? `${caminho.join(".")}: ` : "";
    return { campo: prefixo, mensagem: e.message };
  });

const errorHandler = (erro, req, res, next) => {
  if (res.headersSent) {
    return next(erro);
  }

  const isDev = process.env.NODE_ENV !== "production";
  const isTest = process.env.NODE_ENV === "test";

  if (!isTest) {
    if (isDev) {
      console.error(erro.stack);
    } else {
      console.error(`${erro.name || "Error"}: ${erro.message}`);
    }
  }

  if (erro instanceof ZodError || erro.name === "ZodError") {
    const problemas = formatarErrosZod(erro);
    const mensagens = [...new Set(problemas.map((p) => p.mensagem))];
    const erros = problemas.map((p) => `${p.campo}${p.mensagem}`);
    return responderErro(res, 400, mensagens.join("; "), erros);
  }

  if (erro instanceof AppError) {
    return responderErro(res, erro.statusCode, erro.message);
  }

  if (erro.name === "SequelizeValidationError") {
    const erros = (erro.errors || []).map((e) => e.message);
    return responderErro(
      res,
      400,
      erros.length > 0 ? erros.join(", ") : erro.message,
      erros
    );
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
