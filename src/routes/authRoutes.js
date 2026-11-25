import { Router } from "express";

import authController from "../controllers/authController.js";
import autenticar from "../middlewares/authMiddleware.js";

const router = Router();
router.post("/login", authController.login);
router.post("/signup", authController.signup);
router.post("/logout", autenticar, authController.logout);

export default router;