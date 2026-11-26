import { Router } from "express";
import { questionarioController } from "../controllers/index.js";
import {
  atualizarPerguntaSchema,
  autenticar,
  autorizar,
  criarPerguntaSchema,
  validarId,
  validate,
} from "../middlewares/index.js";

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
  validate(criarPerguntaSchema),
  questionarioController.criar
);

router.put(
  "/:id",
  autenticar,
  autorizar("admin"),
  validarId,
  validate(atualizarPerguntaSchema),
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
