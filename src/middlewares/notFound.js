import { AppError } from "../utils/index.js";

const notFoundMiddleware = (req, res, next) => {
  next(new AppError(`Rota ${req.originalUrl} não encontrada no servidor.`, 404));
};

export default notFoundMiddleware;
