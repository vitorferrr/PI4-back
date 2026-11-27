import { Router } from "express";
import { usuarioController } from "../controllers/index.js";
import {
  atualizarUsuarioSchema,
  autenticar,
  autorizar,
  criarUsuarioSchema,
  listarUsuariosSchema,
  validarId,
  validate,
} from "../middlewares/index.js";

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

router.post(
  "/:id/reenviar-senha",
  autenticar,
  autorizar("admin"),
  validarId,
  usuarioController.reenviarSenha
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