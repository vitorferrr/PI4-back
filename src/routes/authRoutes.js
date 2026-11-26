import { Router } from "express";

import authController from "../controllers/authController.js";
import { autenticarLogout } from "../middlewares/authMiddleware.js";

const router = Router();
router.post("/login", authController.login);
router.post("/signup", authController.signup);
router.post("/logout", autenticarLogout, authController.logout);
// Sem autenticar: o access token já pode estar vencido; a identidade vem do
// próprio refresh token.
router.post("/refresh", authController.refresh);

export default router;