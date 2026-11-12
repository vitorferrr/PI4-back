import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import jwt from "jsonwebtoken";
import usuarioRoutes from "../routes/usuarioRoutes.js";
import usuarioService from "../services/usuarioService.js";

vi.mock("../services/usuarioService.js", () => ({
  default: {
    criar: vi.fn(),
    listar: vi.fn(),
    buscarPorId: vi.fn(),
    atualizar: vi.fn(),
    remover: vi.fn(),
  },
}));

const SEGREDO = "segredo-de-teste";
const usuarioFalso = { id: 1, nome: "Bia", email: "bia@exemplo.com", role: "fiscalizador" };

let servidor;
let urlBase;

const tokenDe = (role, id = 1) => jwt.sign({ id, role }, SEGREDO);

const requisitar = (metodo, caminho, role, corpo) =>
  fetch(`${urlBase}${caminho}`, {
    method: metodo,
    headers: {
      "Content-Type": "application/json",
      ...(role && { Authorization: `Bearer ${tokenDe(role)}` }),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", SEGREDO);

  const app = express();
  app.use(express.json());
  app.use("/usuarios", usuarioRoutes);

  await new Promise((resolve) => {
    servidor = app.listen(0, resolve);
  });
  urlBase = `http://127.0.0.1:${servidor.address().port}/usuarios`;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => servidor.close(resolve));
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.values(usuarioService).forEach((metodo) => metodo.mockResolvedValue(usuarioFalso));
});

const rotas = [
  ["POST", "", "criar", ["admin"], ["gestor", "fiscalizador"]],
  ["GET", "", "listar", ["admin", "gestor"], ["fiscalizador"]],
  ["GET", "/1", "buscarPorId", ["admin"], ["gestor", "fiscalizador"]],
  ["PUT", "/1", "atualizar", ["admin"], ["gestor", "fiscalizador"]],
  ["DELETE", "/1", "remover", ["admin"], ["gestor", "fiscalizador"]],
];

describe.each(rotas)("%s /usuarios%s", (metodo, caminho, funcaoService, permitidos, bloqueados) => {
  const corpo = metodo === "POST" || metodo === "PUT" ? { nome: "Bia" } : undefined;

  it.each(permitidos)("permite acesso para %s", async (role) => {
    const resposta = await requisitar(metodo, caminho, role, corpo);

    expect(resposta.status).toBeLessThan(300);
    expect(usuarioService[funcaoService]).toHaveBeenCalledTimes(1);
  });

  it.each(bloqueados)("responde 403 para %s sem chamar o service", async (role) => {
    const resposta = await requisitar(metodo, caminho, role, corpo);

    expect(resposta.status).toBe(403);
    expect(await resposta.json()).toEqual({
      mensagem: "Usuário não possui permissão para acessar este recurso",
    });
    expect(usuarioService[funcaoService]).not.toHaveBeenCalled();
  });

  it("responde 401 sem token e não chama o service", async () => {
    const resposta = await requisitar(metodo, caminho, undefined, corpo);

    expect(resposta.status).toBe(401);
    expect(usuarioService[funcaoService]).not.toHaveBeenCalled();
  });
});
