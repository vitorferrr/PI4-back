import { responderErro } from "./errorHandler.js";

const autorizar = (...rolesPermitidas) => {
  return (req, res, next) => {
    if (!req.usuario) {
      return responderErro(res, 401, "Usuário não autenticado");
    }

    if (!rolesPermitidas.includes(req.usuario.role)) {
      return responderErro(
        res,
        403,
        "Usuário não possui permissão para acessar este recurso"
      );
    }

    next();
  };
};

export default autorizar;