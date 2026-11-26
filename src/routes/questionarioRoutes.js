import { Router } from "express";
import questionarioController from "../controllers/questionarioController.js";
import autenticar from "../middlewares/authMiddleware.js";
import autorizar from "../middlewares/roleMiddleware.js";
import validarId from "../middlewares/validarIdMiddleware.js";

const router = Router();

router.get(
  "/",
  autenticar,
  autorizar("admin", "gestor", "fiscalizador"),
  questionarioController.listar
);

router.get(
  "/:id",
  autenticar,
  autorizar("admin"),
  validarId,
  questionarioController.buscarPorId
);

router.post(
  "/",
  autenticar,
  autorizar("admin"),
  questionarioController.criar
);

router.put(
  "/:id",
  autenticar,
  autorizar("admin"),
  validarId,
  questionarioController.atualizar
);

router.delete(
  "/:id",
  autenticar,
  autorizar("admin"),
  validarId,
  questionarioController.remover
);

export default router;
