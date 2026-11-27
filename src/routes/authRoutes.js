import { Router } from "express";

import { authController } from "../controllers/index.js";
import {
  authLimiterMiddleware,
  autenticarLogout,
  loginSchema,
  signupSchema,
  validate,
} from "../middlewares/index.js";

const router = Router();
router.post(
  "/login",
  authLimiterMiddleware,
  validate(loginSchema),
  authController.login
);
router.post("/signup", validate(signupSchema), authController.signup);
router.post("/logout", autenticarLogout, authController.logout);
// Sem autenticar: o access token já pode estar vencido; a identidade vem do
// próprio refresh token.
router.post("/refresh", authController.refresh);

export default router;
