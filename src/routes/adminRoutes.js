import { Router } from "express";
import adminController from "../controllers/adminController.js";
import autenticar from "../middlewares/authMiddleware.js";
import autorizar from "../middlewares/roleMiddleware.js";
import validate from "../middlewares/validate.js";
import { listarVisitasSchema } from "../middlewares/validationSchemas.js";

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
