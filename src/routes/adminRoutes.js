import { Router } from "express";
import adminController from "../controllers/adminController.js";
import autenticar from "../middlewares/authMiddleware.js";
import autorizar from "../middlewares/roleMiddleware.js";

const router = Router();

router.get(
  "/dados-gerais",
  autenticar,
  autorizar("admin"),
  adminController.dadosGerais
);

export default router;
