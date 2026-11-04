import { Router } from "express";
import visitaController from "../controllers/visitaController.js";
import autenticar from "../middlewares/authMiddleware.js";
import autorizar from "../middlewares/roleMiddleware.js";

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
  visitaController.buscarPorId
);

router.put(
  "/:id/iniciar",
  autenticar,
  autorizar("admin", "gestor", "fiscalizador"),
  visitaController.iniciar
);

router.put(
  "/:id/concluir",
  autenticar,
  autorizar("admin", "gestor", "fiscalizador"),
  visitaController.concluir
);

export default router;