import rateLimit from "express-rate-limit";
import AppError from "../utils/appError.js";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

const createLimiter = ({ limit, message, windowMs = FIFTEEN_MINUTES_MS, ...options }) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: true,
    validate: { trustProxy: false },
    ...options,
    handler: (req, res, next) => next(new AppError(message, 429)),
  });

export const limiterMiddleware = createLimiter({
  limit: 500,
  message: "Muitas requisições originadas deste IP. Tente novamente em 15 minutos.",
});

export const authLimiterMiddleware = createLimiter({
  limit: 5,
  skipSuccessfulRequests: true,
  message: "Muitas tentativas de autenticação originadas deste IP. Tente novamente em 15 minutos.",
});
