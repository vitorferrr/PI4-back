import { Router } from "express";
import usuarioController from "../controllers/usuarioController.js";
import autenticar from "../middlewares/authMiddleware.js";
import autorizar from "../middlewares/roleMiddleware.js";
import validarId from "../middlewares/validarIdMiddleware.js";
import {
  validarAtualizacaoUsuario,
  validarCriacaoUsuario,
} from "../middlewares/validationMiddleware.js";

const router = Router();


router.post(
  "/",
  autenticar,
  autorizar("admin"),
  validarCriacaoUsuario,
  usuarioController.criar
);

router.get(
  "/",
  autenticar,
  autorizar("admin", "gestor"),
  usuarioController.listar
);

router.put(
  "/:id",
  autenticar,
  autorizar("admin"),
  validarId,
  validarAtualizacaoUsuario,
  usuarioController.atualizar
);

router.patch(
  "/:id/aprovar",
  autenticar,
  autorizar("admin"),
  validarId,
  usuarioController.aprovar
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