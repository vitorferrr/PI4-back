import { Router } from "express";
import { assinaturaController, documentoController } from "../controllers/index.js";
import {
  autenticar,
  autorizar,
  registrarAssinaturaSchema,
  validarId,
  validate,
} from "../middlewares/index.js";

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
