import jwt from "jsonwebtoken";
import Sequelize from "sequelize";
import { responderErro } from "./errorHandler.js";
import authService from "../services/authService.js";

const bancoIndisponivel = (erro) =>
  erro instanceof Sequelize.ConnectionError || erro instanceof Sequelize.TimeoutError;

const criarAutenticacao = ({ aoEncontrarSessaoEncerrada, aoEncontrarTokenVencido }) => async (req, res, next) => {
  const authorization = req.headers.authorization;

  if (!authorization) {
    return responderErro(res, 401, "Token não informado");
  }

  const [tipo, token] = authorization.split(" ");

  if (tipo !== "Bearer" || !token) {
    return responderErro(res, 401, "Token inválido");
  }

  let payload;

  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (erro) {
    if (erro.name === "TokenExpiredError" && aoEncontrarTokenVencido) {
      return aoEncontrarTokenVencido(res);
    }

    console.error(erro);

    return responderErro(res, 401, "Token inválido ou expirado");
  }

  if (payload.jti) {
    let revogado;

    try {
      revogado = await authService.tokenRevogado(payload.jti);
    } catch (erro) {
      console.error("Falha ao conferir o token revogado:", erro);

      return bancoIndisponivel(erro)
        ? responderErro(res, 503, "Banco de dados indisponível")
        : responderErro(res, 500, "Erro interno do servidor");
    }

    if (revogado) {
      return aoEncontrarSessaoEncerrada(res);
    }
  }

  req.usuario = payload;

  return next();
};

const autenticar = criarAutenticacao({
  aoEncontrarSessaoEncerrada: (res) => responderErro(res, 401, "Sessão encerrada"),
});

const sessaoJaTerminada = (res) => res.status(204).send();

export const autenticarLogout = criarAutenticacao({
  aoEncontrarSessaoEncerrada: sessaoJaTerminada,
  aoEncontrarTokenVencido: sessaoJaTerminada,
});

export default autenticar;
