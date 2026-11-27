import jwt from "jsonwebtoken";
import Sequelize from "sequelize";
import { env } from "../config/index.js";
import { AppError } from "../utils/index.js";
import { authService } from "../services/index.js";

const bancoIndisponivel = (erro) =>
  erro instanceof Sequelize.ConnectionError || erro instanceof Sequelize.TimeoutError;

// aceitarTokenVencido / aceitarSessaoEncerrada: usados só no logout. A assinatura
// continua sendo conferida (o jwt.verify checa a assinatura antes da validade).
const criarAutenticacao = ({
  aoEncontrarSessaoEncerrada,
  aceitarTokenVencido = false,
  aceitarSessaoEncerrada = false,
}) => async (req, res, next) => {
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
    payload = jwt.verify(token, env.JWT_SECRET, { ignoreExpiration: aceitarTokenVencido });
  } catch (erro) {
    console.error(erro);

    return next(new AppError("Token inválido ou expirado", 401));
  }

  if (payload.jti && !aceitarSessaoEncerrada) {
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

// DT-38: o access token dura só 15 min, então a maior parte dos logouts chega com
// ele vencido (ou já encerrado por um logout anterior). Mesmo assim o pedido segue
// para o controller, que revoga o refresh token enviado no corpo; antes, a resposta
// era 204 direto e o refresh continuava valendo por 30 dias.
export const autenticarLogout = criarAutenticacao({
  aceitarTokenVencido: true,
  aceitarSessaoEncerrada: true,
});

export default autenticar;
