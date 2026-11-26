import { Router } from "express";
import questionarioController from "../controllers/questionarioController.js";
import autenticar from "../middlewares/authMiddleware.js";
import autorizar from "../middlewares/roleMiddleware.js";
import validarId from "../middlewares/validarIdMiddleware.js";
import validate from "../middlewares/validate.js";
import {
  atualizarPerguntaSchema,
  criarPerguntaSchema,
} from "../middlewares/validationSchemas.js";

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
