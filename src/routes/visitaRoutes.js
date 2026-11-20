import { Router } from "express";
import visitaController from "../controllers/visitaController.js";
import questionarioController from "../controllers/questionarioController.js";
import autenticar from "../middlewares/authMiddleware.js";
import autorizar from "../middlewares/roleMiddleware.js";
import validarId from "../middlewares/validarIdMiddleware.js";

const router = Router();

router.post(
  "/",
  autenticar,
  autorizar("admin", "gestor"),
  visitaController.criar
);

router.get(
  "/",
  autenticar,
  autorizar("admin", "gestor", "fiscalizador"),
  visitaController.listar
);

router.get(
  "/:id",
  autenticar,
  autorizar("admin", "gestor", "fiscalizador"),
  validarId,
  visitaController.buscarPorId
);

router.patch(
  "/:id/iniciar",
  autenticar,
  autorizar("admin", "gestor", "fiscalizador"),
  validarId,
  visitaController.iniciar
);

router.patch(
  "/:id/concluir",
  autenticar,
  autorizar("admin", "gestor", "fiscalizador"),
  validarId,
  visitaController.concluir
);

router.post(
  "/:id/respostas",
  autenticar,
  autorizar("fiscalizador"),
  validarId,
  questionarioController.salvarRespostas
);

export default router;