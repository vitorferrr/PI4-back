import { Router } from "express";

import authController from "../controllers/authController.js";
import { autenticarLogout } from "../middlewares/authMiddleware.js";

const router = Router();
router.post("/login", authController.login);
router.post("/signup", authController.signup);
router.post("/logout", autenticarLogout, authController.logout);

export default router;