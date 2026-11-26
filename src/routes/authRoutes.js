import { Router } from "express";

import authController from "../controllers/authController.js";
import { autenticarLogout } from "../middlewares/authMiddleware.js";
import validate from "../middlewares/validate.js";
import { loginSchema, signupSchema } from "../middlewares/validationSchemas.js";

const router = Router();
router.post("/login", validate(loginSchema), authController.login);
router.post("/signup", validate(signupSchema), authController.signup);
router.post("/logout", autenticarLogout, authController.logout);

export default router;
