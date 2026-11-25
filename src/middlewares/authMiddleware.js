import jwt from "jsonwebtoken";
import authService from "../services/authService.js";

const autenticar = async (req, res, next) => {
  const authorization = req.headers.authorization;

  if (!authorization) {
    return res.status(401).json({
      mensagem: "Token não informado",
    });
  }

  const [tipo, token] = authorization.split(" ");

  if (tipo !== "Bearer" || !token) {
    return res.status(401).json({
      mensagem: "Token inválido",
    });
  }

  let payload;

  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (erro) {
    console.error(erro);

    return res.status(401).json({
      mensagem: "Token inválido ou expirado",
    });
  }

  if (payload.jti) {
    try {
      if (await authService.tokenRevogado(payload.jti)) {
        return res.status(401).json({
          mensagem: "Sessão encerrada",
        });
      }
    } catch (erro) {
      console.error("Falha ao conferir o token revogado:", erro.message);

      return res.status(503).json({
        mensagem: "Banco de dados indisponível",
      });
    }
  }

  req.usuario = payload;

  return next();
};

export default autenticar;
