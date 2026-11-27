import jwt from "jsonwebtoken";
import Sequelize from "sequelize";
import { env } from "../config/index.js";
import { AppError } from "../utils/index.js";
import { authService } from "../services/index.js";

const bancoIndisponivel = (erro) =>
  erro instanceof Sequelize.ConnectionError || erro instanceof Sequelize.TimeoutError;

const criarAutenticacao = ({ aoEncontrarSessaoEncerrada, aoEncontrarTokenVencido }) => async (req, res, next) => {
  const authorization = req.headers.authorization;

  if (!authorization) {
    return next(new AppError("Token não informado", 401));
  }

  const [tipo, token] = authorization.split(" ");

  if (tipo !== "Bearer" || !token) {
    return next(new AppError("Token inválido", 401));
  }

  let payload;

  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch (erro) {
    if (erro.name === "TokenExpiredError" && aoEncontrarTokenVencido) {
      return aoEncontrarTokenVencido(res, next);
    }

    console.error(erro);

    return next(new AppError("Token inválido ou expirado", 401));
  }

  if (payload.jti) {
    let revogado;

    try {
      revogado = await authService.tokenRevogado(payload.jti);
    } catch (erro) {
      console.error("Falha ao conferir o token revogado:", erro);

      return next(
        bancoIndisponivel(erro)
          ? new AppError("Banco de dados indisponível", 503)
          : new AppError("Erro interno do servidor", 500)
      );
    }

    if (revogado) {
      return aoEncontrarSessaoEncerrada(res, next);
    }
  }

  req.usuario = payload;

  return next();
};

const autenticar = criarAutenticacao({
  aoEncontrarSessaoEncerrada: (res, next) => next(new AppError("Sessão encerrada", 401)),
});

const sessaoJaTerminada = (res) => res.status(204).send();

export const autenticarLogout = criarAutenticacao({
  aoEncontrarSessaoEncerrada: sessaoJaTerminada,
  aoEncontrarTokenVencido: sessaoJaTerminada,
});

export default autenticar;
