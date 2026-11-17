import { Router } from "express";
import questionarioController from "../controllers/questionarioController.js";
import autenticar from "../middlewares/authMiddleware.js";
import autorizar from "../middlewares/roleMiddleware.js";
import validarId from "../middlewares/validarIdMiddleware.js";

const router = Router();

router.get(
  "/questionario",
  autenticar,
  autorizar("admin", "gestor", "fiscalizador"),
  questionarioController.listar
);

router.post(
  "/visitas/:id/respostas",
  autenticar,
  autorizar("fiscalizador"),
  validarId,
  questionarioController.salvarRespostas
);

export default router;