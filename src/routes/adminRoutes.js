import { Router } from "express";
import { adminController } from "../controllers/index.js";
import { autenticar, autorizar, listarVisitasSchema, validate } from "../middlewares/index.js";

const router = Router();

router.get(
  "/dados-gerais",
  autenticar,
  autorizar("admin"),
  adminController.dadosGerais
);

router.get(
  "/exportar",
  autenticar,
  autorizar("admin"),
  validate(listarVisitasSchema),
  adminController.exportar
);

export default router;
