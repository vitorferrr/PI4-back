import { Router } from "express";
import usuarioController from "../controllers/usuarioController.js";
import autenticar from "../middlewares/authMiddleware.js";
import autorizar from "../middlewares/roleMiddleware.js";
import validarId from "../middlewares/validarIdMiddleware.js";
import validate from "../middlewares/validate.js";
import {
  atualizarUsuarioSchema,
  criarUsuarioSchema,
  listarUsuariosSchema,
} from "../middlewares/validationSchemas.js";

const router = Router();


router.post(
  "/",
  autenticar,
  autorizar("admin"),
  validate(criarUsuarioSchema),
  usuarioController.criar
);

router.get(
  "/",
  autenticar,
  autorizar("admin", "gestor"),
  validate(listarUsuariosSchema),
  usuarioController.listar
);

router.put(
  "/:id",
  autenticar,
  autorizar("admin"),
  validarId,
  validate(atualizarUsuarioSchema),
  usuarioController.atualizar
);

router.patch(
  "/:id/aprovar",
  autenticar,
  autorizar("admin"),
  validarId,
  usuarioController.aprovar
);

router.patch(
  "/:id/reprovar",
  autenticar,
  autorizar("admin"),
  validarId,
  usuarioController.reprovar
);

router.delete(
  "/:id",
  autenticar,
  autorizar("admin"),
  validarId,
  usuarioController.remover
);

router.get(
  "/:id",
  autenticar,
  autorizar("admin"),
  validarId,
  usuarioController.buscarPorId
);

export default router;