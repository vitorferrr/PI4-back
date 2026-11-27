import jwt from "jsonwebtoken";
import Sequelize from "sequelize";
import { responderErro } from "./errorHandler.js";
import authService from "../services/authService.js";

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
    return responderErro(res, 401, "Token não informado");
  }

  const [tipo, token] = authorization.split(" ");

  if (tipo !== "Bearer" || !token) {
    return responderErro(res, 401, "Token inválido");
  }

  let payload;

  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: aceitarTokenVencido });
  } catch (erro) {
    console.error(erro);

    return responderErro(res, 401, "Token inválido ou expirado");
  }

  if (payload.jti && !aceitarSessaoEncerrada) {
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

// DT-38: o access token dura só 15 min, então a maior parte dos logouts chega com
// ele vencido (ou já encerrado por um logout anterior). Mesmo assim o pedido segue
// para o controller, que revoga o refresh token enviado no corpo; antes, a resposta
// era 204 direto e o refresh continuava valendo por 30 dias.
export const autenticarLogout = criarAutenticacao({
  aceitarTokenVencido: true,
  aceitarSessaoEncerrada: true,
});

export default autenticar;
