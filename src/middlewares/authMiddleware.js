import jwt from "jsonwebtoken";
import { responderErro } from "./errorHandler.js";

const autenticar = (req, res, next) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization) {
      return responderErro(res, 401, "Token não informado");
    }

    const [tipo, token] = authorization.split(" ");

    if (tipo !== "Bearer" || !token) {
      return responderErro(res, 401, "Token inválido");
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    req.usuario = payload;

    next();
  } catch (erro) {
    console.error(erro);

    return responderErro(res, 401, "Token inválido ou expirado");
  }
};

export default autenticar;