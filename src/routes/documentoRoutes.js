import { Router } from "express";
import assinaturaController from "../controllers/assinaturaController.js";
import documentoController from "../controllers/documentoController.js";
import autenticar from "../middlewares/authMiddleware.js";
import autorizar from "../middlewares/roleMiddleware.js";
import validarId from "../middlewares/validarIdMiddleware.js";
import validate from "../middlewares/validate.js";
import { registrarAssinaturaSchema } from "../middlewares/validationSchemas.js";

const router = Router();

router.post(
  "/:id/assinaturas",
  autenticar,
  autorizar("fiscalizador"),
  validarId,
  validate(registrarAssinaturaSchema),
  assinaturaController.registrar
);

router.delete(
  "/:id/assinaturas/:assinaturaId",
  autenticar,
  autorizar("fiscalizador"),
  validarId,
  assinaturaController.remover
);

router.get(
  "/:id/pdf",
  autenticar,
  autorizar("admin", "gestor"),
  validarId,
  documentoController.linkPdf
);

router.post(
  "/:id/finalizar",
  autenticar,
  autorizar("fiscalizador"),
  validarId,
  assinaturaController.finalizar
);

export default router;
