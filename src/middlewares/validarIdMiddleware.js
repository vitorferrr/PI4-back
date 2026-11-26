import AppError from "../utils/appError.js";

const ID_MAXIMO = 2147483647;

export const validarParametroId = (nomeParametro = "id") => (req, res, next) => {
  const valor = req.params[nomeParametro];

  if (!/^[1-9]\d*$/.test(valor) || Number(valor) > ID_MAXIMO) {
    return next(new AppError("Id inválido", 400));
  }

  next();
};

export const validarIdParametro = validarParametroId;

const validarId = validarParametroId("id");

export default validarId;
