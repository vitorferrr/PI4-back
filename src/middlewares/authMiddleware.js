import jwt from "jsonwebtoken";
import { responderErro } from "./errorHandler.js";
import authService from "../services/authService.js";

const autenticar = async (req, res, next) => {
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
    console.error(erro);

    return responderErro(res, 401, "Token inválido ou expirado");
  }

  if (payload.jti) {
    try {
      if (await authService.tokenRevogado(payload.jti)) {
        return responderErro(res, 401, "Sessão encerrada");
      }
    } catch (erro) {
      console.error("Falha ao conferir o token revogado:", erro.message);

      return responderErro(res, 503, "Banco de dados indisponível");
    }
  }

  req.usuario = payload;

  return next();
};

export default autenticar;