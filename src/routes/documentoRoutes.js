import { Router } from "express";
import assinaturaController from "../controllers/assinaturaController.js";
import autenticar from "../middlewares/authMiddleware.js";
import autorizar from "../middlewares/roleMiddleware.js";
import validarId from "../middlewares/validarIdMiddleware.js";

const router = Router();

router.post(
  "/:id/assinaturas",
  autenticar,
  autorizar("fiscalizador"),
  validarId,
  assinaturaController.registrar
);

router.delete(
  "/:id/assinaturas/:assinaturaId",
  autenticar,
  autorizar("fiscalizador"),
  validarId,
  assinaturaController.remover
);

router.post(
  "/:id/finalizar",
  autenticar,
  autorizar("fiscalizador"),
  validarId,
  assinaturaController.finalizar
);

export default router;
