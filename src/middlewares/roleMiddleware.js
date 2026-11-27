import AppError from "../utils/appError.js";

const autorizar = (...rolesPermitidas) => {
  return (req, res, next) => {
    if (!req.usuario) {
      return next(new AppError("Usuário não autenticado", 401));
    }

    if (!rolesPermitidas.includes(req.usuario.role)) {
      return next(
        new AppError("Usuário não possui permissão para acessar este recurso", 403)
      );
    }

    next();
  };
};

export default autorizar;
