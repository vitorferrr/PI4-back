import { Router } from "express";
import questionarioController from "../controllers/questionarioController.js";
import autenticar from "../middlewares/authMiddleware.js";
import autorizar from "../middlewares/roleMiddleware.js";

const router = Router();

router.get(
  "/",
  autenticar,
  autorizar("admin", "gestor", "fiscalizador"),
  questionarioController.listar
);

export default router;
